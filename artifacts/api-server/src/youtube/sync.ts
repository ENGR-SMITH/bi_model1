// ---------------------------------------------------------------------------
// Channel analytics sync engine (Phase 3, §9.1). Runs per CONNECTED channel:
//
//   1. Catalog sync — crawl the linked channel's uploads playlist, upsert the
//      `nexet_channel_videos` catalog, count newly-published uploads.
//   2. Metrics sync  — incremental daily snapshots (channel + per-video) from
//      the YouTube Analytics API into `nexet_*_daily_metrics` (only missing
//      days are fetched after the first backfill).
//   3. Report refresh — on-demand report caches (retention/traffic/demographics/
//      devices/revenue/subs) re-fetched only beyond `YT_REPORT_TTL_MINUTES`.
//   4. Anomaly rules  — v1 alerts (§14), deduped per (channel, rule, window),
//      delivered through the existing notification system.
//
// Every stage degrades to stored partials + an ERROR sync-state row instead of
// throwing to the caller; the UI surfaces "Last sync failed — retry".
// ---------------------------------------------------------------------------

import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  nexetChannelsTable,
  nexetChannelVideosTable,
  nexetChannelDailyMetricsTable,
  nexetVideoDailyMetricsTable,
  nexetAnalyticsReportsTable,
  nexetChannelSyncsTable,
  nexetChannelAlertsTable,
  nexetVideoNotificationsTable,
  type ChannelMetrics,
  type VideoMetrics,
  type NexetChannel,
} from "@workspace/db";
import { getChannelAccessToken } from "../channels/oauth";
import { emitToUser } from "../realtime";
import { logger } from "../lib/logger";
import { fetchYoutubeJson, normalizeReportRows, type YoutubeReportPayload } from "./client";

// ---------------------------------------------------------------------------
// Config (env, with §8.2 defaults)
// ---------------------------------------------------------------------------

function analyticsDays(): number {
  const raw = Number(process.env.YT_ANALYTICS_DAYS);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 90;
}

function reportTtlMs(): number {
  const raw = Number(process.env.YT_REPORT_TTL_MINUTES);
  return (Number.isFinite(raw) && raw >= 1 ? raw : 360) * 60 * 1000;
}

/**
 * How many videos one sync cycle refreshes. Each video costs one Analytics
 * report query, so this is the per-cycle quota bound: the default is sized for
 * the 10-minute cadence (144 cycles/day) to stay inside a 10k/day Analytics
 * budget with room to spare for the channel + report calls.
 *
 * It is a WINDOW, not a slice of the newest videos: `syncVideoMetrics` orders
 * by how stale a video's stored metrics are, so a channel with more videos
 * than this still has every one of them refreshed in turn. Raise it for a
 * small channel, lower it for a big one.
 */
function maxVideoQueries(): number {
  const raw = Number(process.env.YT_SYNC_MAX_VIDEO_QUERIES);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 60;
}

// ---------------------------------------------------------------------------
// Small date / duration helpers (all dates are YYYY-MM-DD strings — the shape
// the pg `date` columns and the Analytics API both speak).
// ---------------------------------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isoDurationToSeconds(duration: string | undefined): number | null {
  if (!duration) return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(duration);
  if (!match) return null;
  const [, h, m, s] = match;
  return (Number(h ?? 0) * 3600) + (Number(m ?? 0) * 60) + Number(s ?? 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Report parsing — YouTube's `{ columnHeaders, rows }` → metric objects keyed
// by our snake_case names (non-monetized nulls become absent keys).
// ---------------------------------------------------------------------------

const METRIC_KEY: Record<string, keyof VideoMetrics> = {
  views: "views",
  estimatedMinutesWatched: "watchTimeMinutes",
  averageViewDuration: "averageViewDurationSeconds",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  subscribersGained: "subscribersGained",
  subscribersLost: "subscribersLost",
  estimatedRevenue: "estimatedRevenueUsd",
  estimatedAdRevenue: "estimatedAdRevenueUsd",
  impressions: "impressions",
  impressionsClickThroughRate: "impressionsClickThroughRate",
  averageViewPercentage: "averageViewPercentage",
};

function rowsToMetrics(payload: YoutubeReportPayload): Array<{ day: string; metrics: Record<string, number> }> {
  const headers = payload.columnHeaders ?? [];
  const dayIndex = headers.findIndex((h) => h.name === "day");
  if (dayIndex === -1) return [];
  const out: Array<{ day: string; metrics: Record<string, number> }> = [];
  for (const row of payload.rows ?? []) {
    const metrics: Record<string, number> = {};
    headers.forEach((header, index) => {
      if (index === dayIndex) return;
      const key = METRIC_KEY[header.name];
      if (!key) return;
      const value = row[index];
      if (typeof value === "number" && Number.isFinite(value)) metrics[key] = value;
    });
    out.push({ day: String(row[dayIndex]), metrics });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. Catalog sync
// ---------------------------------------------------------------------------

interface PlaylistItem {
  id?: string;
  snippet?: {
    publishedAt?: string;
    title?: string;
    description?: string;
    thumbnails?: Record<string, { url?: string } | undefined>;
    defaultLanguage?: string;
    categoryId?: string;
    privacyStatus?: string;
    resourceId?: { videoId?: string };
    liveBroadcastContent?: string;
  };
  contentDetails?: { videoId?: string };
}

interface PlaylistItemsResponse {
  items?: PlaylistItem[];
  nextPageToken?: string;
}

interface VideoDetailsItem {
  id?: string;
  snippet?: { liveBroadcastContent?: string };
  contentDetails?: { duration?: string };
}

interface VideoDetailsResponse {
  items?: VideoDetailsItem[];
}

/** Upsert the channel's published-upload catalog. Returns new uploads seen. */
export async function syncCatalog(
  channelId: string,
  token: string,
  channelYoutubeId: string,
): Promise<number> {
  const mine = await fetchYoutubeJson<{ items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }>(
    "youtube/v3/channels",
    token,
    { part: "contentDetails", mine: "true" },
  );
  const uploadsPlaylistId = mine.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error("No uploads playlist found on the linked YouTube channel");
  }

  const existing = await db
    .select({ youtubeVideoId: nexetChannelVideosTable.youtubeVideoId })
    .from(nexetChannelVideosTable)
    .where(eq(nexetChannelVideosTable.channelId, channelId));
  const existingIds = new Set(existing.map((row) => row.youtubeVideoId));
  let newVideos = 0;

  let pageToken: string | undefined;
  let pages = 0;
  do {
    const page = await fetchYoutubeJson<PlaylistItemsResponse>("youtube/v3/playlistItems", token, {
      part: "snippet,contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: 50,
      ...(pageToken ? { pageToken } : {}),
    });
    pages += 1;

    const items = page.items ?? [];
    // contentDetails on playlistItems has no duration/live flag — enrich the
    // batch with one videos.list call per page (bounded, best-effort).
    const videoIds = items
      .map((item) => item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId)
      .filter((id): id is string => Boolean(id));
    const details = new Map<string, { durationSeconds: number | null; live: boolean }>();
    if (videoIds.length > 0) {
      try {
        const batch = await fetchYoutubeJson<VideoDetailsResponse>("youtube/v3/videos", token, {
          part: "snippet,contentDetails",
          id: videoIds.join(","),
        });
        for (const item of batch.items ?? []) {
          if (!item.id) continue;
          details.set(item.id, {
            durationSeconds: isoDurationToSeconds(item.contentDetails?.duration),
            live: item.snippet?.liveBroadcastContent === "live" || item.snippet?.liveBroadcastContent === "upcoming",
          });
        }
      } catch (error) {
        // Quota/transient on the enrichment call — catalog rows still land with
        // a LONG_FORM default; the next sync fills in real durations.
        logger.warn({ channelId, err: error }, "Video detail enrichment failed during catalog sync");
      }
    }

    for (const item of items) {
      const youtubeVideoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      if (!youtubeVideoId) continue;
      const detail = details.get(youtubeVideoId);
      const durationSeconds = detail?.durationSeconds ?? null;
      const contentKind = detail?.live ? "LIVE" : durationSeconds !== null && durationSeconds <= 180 ? "SHORT" : "LONG_FORM";
      const publishedAt = item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : null;
      const values = {
        title: item.snippet?.title ?? youtubeVideoId,
        description: item.snippet?.description ?? "",
        thumbnails: item.snippet?.thumbnails ?? {},
        publishedAt,
        durationSeconds,
        privacyStatus: item.snippet?.privacyStatus ?? null,
        categoryId: item.snippet?.categoryId ?? null,
        defaultLanguage: item.snippet?.defaultLanguage ?? null,
        contentKind,
        lastSyncedAt: new Date(),
      };
      await db
        .insert(nexetChannelVideosTable)
        .values({ id: randomUUID(), channelId, youtubeVideoId, ...values })
        .onConflictDoUpdate({
          target: [nexetChannelVideosTable.channelId, nexetChannelVideosTable.youtubeVideoId],
          set: values,
        });
      if (!existingIds.has(youtubeVideoId)) newVideos += 1;
    }

    pageToken = page.nextPageToken;
  } while (pageToken && pages < 20); // hard cap on playlist pages per sync

  return newVideos;
}

// ---------------------------------------------------------------------------
// 2. Metrics sync (incremental daily snapshots)
// ---------------------------------------------------------------------------

const CHANNEL_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost",
  "estimatedRevenue",
  "estimatedAdRevenue",
].join(",");

const VIDEO_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "likes",
  "comments",
  "shares",
  "estimatedRevenue",
  "estimatedAdRevenue",
  "impressions",
  "impressionsClickThroughRate",
].join(",");

/** The missing-day window [start, today], clamped to a single ≤90-day request. */
function missingWindow(dayColumn: unknown, latestDay: string | null): { startDate: string; endDate: string } {
  const today = todayStr();
  let startDate = latestDay ? addDays(latestDay, 1) : addDays(today, -(analyticsDays() - 1));
  if (startDate > today) return { startDate: today, endDate: today };
  if (startDate < addDays(today, -89)) startDate = addDays(today, -89); // Analytics API max range
  return { startDate, endDate: today };
}

/** Channel-level daily snapshots over the missing window. Returns rows stored. */
export async function syncChannelMetrics(
  channelId: string,
  token: string,
  channelYoutubeId: string,
): Promise<number> {
  const [maxRow] = await db
    .select({ maxDay: sql<string>`max(${nexetChannelDailyMetricsTable.day})` })
    .from(nexetChannelDailyMetricsTable)
    .where(eq(nexetChannelDailyMetricsTable.channelId, channelId));
  const { startDate, endDate } = missingWindow(nexetChannelDailyMetricsTable.day, maxRow?.maxDay ?? null);
  if (startDate > endDate) return 0;

  const payload = await fetchYoutubeJson<YoutubeReportPayload>("youtubeAnalytics/v2/reports", token, {
    ids: `channel==${channelYoutubeId}`,
    startDate,
    endDate,
    metrics: CHANNEL_METRICS,
    dimensions: "day",
    sort: "day",
  });

  let stored = 0;
  for (const { day, metrics } of rowsToMetrics(payload)) {
    if (day < startDate || day > endDate) continue;
    await db
      .insert(nexetChannelDailyMetricsTable)
      .values({ channelId, day, metrics, source: "youtube" })
      .onConflictDoUpdate({
        target: [nexetChannelDailyMetricsTable.channelId, nexetChannelDailyMetricsTable.day],
        set: { metrics, source: "youtube" },
      });
    stored += 1;
  }
  return stored;
}

/**
 * Per-video daily snapshots, newest data first but every video in turn.
 *
 * Ordering is by how stale a video's stored metrics are (its latest snapshot
 * day), not by publish date: each cycle refreshes the videos that have gone
 * longest without one, so the window rotates through the whole catalog and a
 * channel with hundreds of uploads still sees all of them updated instead of
 * only the newest slice. Never-synced videos (no metrics at all) come first.
 */
export async function syncVideoMetrics(
  channelId: string,
  token: string,
  channelYoutubeId: string,
): Promise<number> {
  const videos = await db
    .select({ video: nexetChannelVideosTable })
    .from(nexetChannelVideosTable)
    .leftJoin(
      nexetVideoDailyMetricsTable,
      eq(nexetVideoDailyMetricsTable.videoRowId, nexetChannelVideosTable.id),
    )
    .where(eq(nexetChannelVideosTable.channelId, channelId))
    .groupBy(nexetChannelVideosTable.id)
    .orderBy(sql`max(${nexetVideoDailyMetricsTable.day}) asc nulls first`)
    .limit(maxVideoQueries())
    .then((rows) => rows.map((row) => row.video));

  let stored = 0;
  for (const video of videos) {
    const [maxRow] = await db
      .select({ maxDay: sql<string>`max(${nexetVideoDailyMetricsTable.day})` })
      .from(nexetVideoDailyMetricsTable)
      .where(eq(nexetVideoDailyMetricsTable.videoRowId, video.id));
    const { startDate, endDate } = missingWindow(nexetVideoDailyMetricsTable.day, maxRow?.maxDay ?? null);
    if (startDate > endDate) continue;

    try {
      const payload = await fetchYoutubeJson<YoutubeReportPayload>("youtubeAnalytics/v2/reports", token, {
        ids: `channel==${channelYoutubeId}`,
        startDate,
        endDate,
        metrics: VIDEO_METRICS,
        dimensions: "day",
        filters: `video==${video.youtubeVideoId}`,
        sort: "day",
      });
      for (const { day, metrics } of rowsToMetrics(payload)) {
        if (day < startDate || day > endDate) continue;
        await db
          .insert(nexetVideoDailyMetricsTable)
          .values({ videoRowId: video.id, day, metrics })
          .onConflictDoUpdate({
            target: [nexetVideoDailyMetricsTable.videoRowId, nexetVideoDailyMetricsTable.day],
            set: { metrics },
          });
        stored += 1;
      }
    } catch (error) {
      // Quota/transient on one video — keep going; the sync-state row is
      // marked ERROR by the caller so the UI surfaces a retry.
      logger.warn({ channelId, videoId: video.youtubeVideoId, err: error }, "Video metrics sync failed");
    }
  }
  return stored;
}

// ---------------------------------------------------------------------------
// 3. Report cache refresh (only beyond YT_REPORT_TTL_MINUTES)
// ---------------------------------------------------------------------------

type ReportKind = "RETENTION" | "TRAFFIC" | "PLAYBACK_LOCATION" | "DEMOGRAPHICS" | "DEVICES" | "REVENUE" | "SUBS";

interface ReportConfig {
  kind: ReportKind;
  metrics: string;
  dimensions: string;
  days: number;
  /** Channel-level (SUBS) instead of per-video. */
  channelLevel?: boolean;
}

const REPORT_CONFIGS: ReportConfig[] = [
  { kind: "RETENTION", metrics: "averageViewPercentage", dimensions: "elapsedVideoTimeRatio", days: 28 },
  { kind: "TRAFFIC", metrics: "views", dimensions: "insightTrafficSourceType", days: 90 },
  { kind: "PLAYBACK_LOCATION", metrics: "views", dimensions: "insightPlaybackLocationType", days: 90 },
  { kind: "DEMOGRAPHICS", metrics: "viewerPercentage", dimensions: "ageGroup,gender", days: 90 },
  { kind: "DEVICES", metrics: "views", dimensions: "deviceType", days: 90 },
  { kind: "REVENUE", metrics: "estimatedRevenue,estimatedAdRevenue,estimatedCpm,estimatedRpm", dimensions: "day", days: 90 },
  { kind: "SUBS", metrics: "subscribersGained,subscribersLost", dimensions: "day", days: 90, channelLevel: true },
];

async function refreshOneReport(
  channelId: string,
  videoRowId: string | null,
  youtubeVideoId: string | undefined,
  config: ReportConfig,
  periodStart: string,
  periodEnd: string,
  token: string,
  channelYoutubeId: string,
): Promise<boolean> {
  const conditions = [
    eq(nexetAnalyticsReportsTable.channelId, channelId),
    videoRowId === null
      ? isNull(nexetAnalyticsReportsTable.videoRowId)
      : eq(nexetAnalyticsReportsTable.videoRowId, videoRowId),
    eq(nexetAnalyticsReportsTable.kind, config.kind),
    eq(nexetAnalyticsReportsTable.periodStart, periodStart),
    eq(nexetAnalyticsReportsTable.periodEnd, periodEnd),
  ];
  const [existing] = await db
    .select({ id: nexetAnalyticsReportsTable.id, fetchedAt: nexetAnalyticsReportsTable.fetchedAt })
    .from(nexetAnalyticsReportsTable)
    .where(and(...conditions))
    .limit(1);
  if (existing && Date.now() - existing.fetchedAt.getTime() < reportTtlMs()) return false;

  const params: Record<string, string | number> = {
    ids: `channel==${channelYoutubeId}`,
    startDate: periodStart,
    endDate: periodEnd,
    metrics: config.metrics,
    dimensions: config.dimensions,
  };
  if (youtubeVideoId) params.filters = `video==${youtubeVideoId}`;

  const payload = await fetchYoutubeJson<YoutubeReportPayload>("youtubeAnalytics/v2/reports", token, params);
  const rows = normalizeReportRows(payload);

  if (existing) {
    await db
      .update(nexetAnalyticsReportsTable)
      .set({ payload: rows, fetchedAt: new Date() })
      .where(eq(nexetAnalyticsReportsTable.id, existing.id));
  } else {
    await db.insert(nexetAnalyticsReportsTable).values({
      id: randomUUID(),
      channelId,
      videoRowId,
      kind: config.kind,
      periodStart,
      periodEnd,
      payload: rows,
      fetchedAt: new Date(),
    });
  }
  return true;
}

/** Refresh stale/missing report caches for the default windows. */
export async function refreshStaleReports(
  channelId: string,
  token: string,
  channelYoutubeId: string,
): Promise<number> {
  const today = todayStr();
  const videos = await db
    .select()
    .from(nexetChannelVideosTable)
    .where(eq(nexetChannelVideosTable.channelId, channelId))
    .orderBy(desc(nexetChannelVideosTable.publishedAt))
    .limit(maxVideoQueries());

  let refreshed = 0;
  for (const config of REPORT_CONFIGS) {
    const periodStart = addDays(today, -(config.days - 1));
    if (config.channelLevel) {
      try {
        if (await refreshOneReport(channelId, null, undefined, config, periodStart, today, token, channelYoutubeId)) refreshed += 1;
      } catch (error) {
        logger.warn({ channelId, kind: config.kind, err: error }, "Channel report refresh failed");
      }
      continue;
    }
    for (const video of videos) {
      try {
        if (await refreshOneReport(channelId, video.id, video.youtubeVideoId, config, periodStart, today, token, channelYoutubeId)) refreshed += 1;
      } catch (error) {
        logger.warn({ channelId, kind: config.kind, videoId: video.youtubeVideoId, err: error }, "Video report refresh failed");
      }
    }
  }
  return refreshed;
}

// ---------------------------------------------------------------------------
// 4. Anomaly rules (§14) — fire once per (channel, rule, window), notify the
//    owner through the existing nexetVideoNotifications system.
// ---------------------------------------------------------------------------

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

async function fireAlert(channel: NexetChannel, rule: string, periodStart: string, message: string, deepLink: string): Promise<void> {
  const inserted = await db
    .insert(nexetChannelAlertsTable)
    .values({ id: randomUUID(), channelId: channel.id, rule, message, periodStart })
    .onConflictDoNothing({
      target: [nexetChannelAlertsTable.channelId, nexetChannelAlertsTable.rule, nexetChannelAlertsTable.periodStart],
    })
    .returning({ id: nexetChannelAlertsTable.id });
  if (inserted.length === 0) return; // already fired for this window

  const [notification] = await db
    .insert(nexetVideoNotificationsTable)
    .values({
      id: randomUUID(),
      recipientId: channel.ownerId,
      category: "channel-analytics",
      title: "Channel analytics alert",
      body: message,
      deepLink,
    })
    .returning();
  emitToUser(channel.ownerId, "notification.new", { ...notification, source: "creators" });
  logger.info({ channelId: channel.id, rule }, "Channel analytics alert fired");
}

/** Rule 1 — weekly watch-time drop ≥ 15% vs the previous 7-day window. */
async function ruleWatchTimeDrop(channel: NexetChannel, today: string): Promise<void> {
  const weekStart = addDays(today, -6);
  const prevWeekStart = addDays(today, -13);
  const rows = await db
    .select({ day: nexetChannelDailyMetricsTable.day, metrics: nexetChannelDailyMetricsTable.metrics })
    .from(nexetChannelDailyMetricsTable)
    .where(
      and(
        eq(nexetChannelDailyMetricsTable.channelId, channel.id),
        gte(nexetChannelDailyMetricsTable.day, prevWeekStart),
        lte(nexetChannelDailyMetricsTable.day, today),
      ),
    );
  let current = 0;
  let previous = 0;
  for (const row of rows) {
    const minutes = row.metrics.watchTimeMinutes ?? 0;
    if (row.day >= weekStart) current += minutes;
    else previous += minutes;
  }
  if (previous <= 0 || current > previous * 0.85) return;
  const dropPct = Math.round((1 - current / previous) * 100);
  await fireAlert(
    channel,
    "WATCH_TIME_DROP",
    weekStart,
    `Watch time dropped ${dropPct}% this week compared to the previous 7 days.`,
    `/creators-den/channels/${channel.id}/analytics`,
  );
}

/** Rule 2 — a video published ≤ 7 days ago ≥ 40% below the channel's median CTR or median AVD. */
async function ruleUnderperformingVideo(channel: NexetChannel, today: string): Promise<void> {
  const cutoff = addDays(today, -7);
  const videos = await db
    .select()
    .from(nexetChannelVideosTable)
    .where(eq(nexetChannelVideosTable.channelId, channel.id));
  if (videos.length === 0) return;

  const avgCtrByVideo = new Map<string, number>();
  const avgAvdByVideo = new Map<string, number>();
  for (const video of videos) {
    const rows = await db
      .select({ metrics: nexetVideoDailyMetricsTable.metrics })
      .from(nexetVideoDailyMetricsTable)
      .where(eq(nexetVideoDailyMetricsTable.videoRowId, video.id))
      .orderBy(desc(nexetVideoDailyMetricsTable.day))
      .limit(7);
    const ctrs: number[] = [];
    const avds: number[] = [];
    for (const row of rows) {
      if (row.metrics.impressionsClickThroughRate != null) ctrs.push(row.metrics.impressionsClickThroughRate);
      if (row.metrics.averageViewDurationSeconds != null) avds.push(row.metrics.averageViewDurationSeconds);
    }
    if (ctrs.length > 0) avgCtrByVideo.set(video.id, ctrs.reduce((a, b) => a + b, 0) / ctrs.length);
    if (avds.length > 0) avgAvdByVideo.set(video.id, avds.reduce((a, b) => a + b, 0) / avds.length);
  }

  const medianCtr = median([...avgCtrByVideo.values()]);
  const medianAvd = median([...avgAvdByVideo.values()]);

  for (const video of videos) {
    if (!video.publishedAt || video.publishedAt.getTime() < new Date(`${cutoff}T00:00:00Z`).getTime()) continue;
    const avgCtr = avgCtrByVideo.get(video.id);
    const avgAvd = avgAvdByVideo.get(video.id);
    const ctrBelow = Number.isFinite(medianCtr) && medianCtr > 0 && avgCtr != null && avgCtr <= medianCtr * 0.6;
    const avdBelow = Number.isFinite(medianAvd) && medianAvd > 0 && avgAvd != null && avgAvd <= medianAvd * 0.6;
    if (!ctrBelow && !avdBelow) continue;
    const what = ctrBelow && avdBelow ? "CTR and watch time" : ctrBelow ? "CTR" : "average watch time";
    await fireAlert(
      channel,
      "VIDEO_UNDERPERFORMING",
      video.publishedAt.toISOString().slice(0, 10),
      `“${video.title}” is underperforming: its ${what} is 40%+ below this channel's median for recent uploads.`,
      `/creators-den/channels/${channel.id}/analytics/videos/${video.id}`,
    );
  }
}

/** Rule 3 — no new published upload for ≥ 14 days. */
async function ruleUploadGap(channel: NexetChannel, today: string): Promise<void> {
  const gapStart = addDays(today, -13);
  const [newest] = await db
    .select({ publishedAt: nexetChannelVideosTable.publishedAt })
    .from(nexetChannelVideosTable)
    .where(eq(nexetChannelVideosTable.channelId, channel.id))
    .orderBy(desc(nexetChannelVideosTable.publishedAt))
    .limit(1);
  if (!newest?.publishedAt) return; // fresh channel with no uploads yet — not a gap
  if (newest.publishedAt.getTime() >= new Date(`${gapStart}T00:00:00Z`).getTime()) return;

  await fireAlert(
    channel,
    "UPLOAD_GAP",
    gapStart,
    `No new uploads in over 14 days — your viewers may be waiting on content.`,
    `/creators-den/channels/${channel.id}/analytics`,
  );
}

/** Evaluate all v1 anomaly rules after a metrics sync. Never throws. */
export async function runAnomalyRules(channelId: string): Promise<void> {
  const [channel] = await db
    .select()
    .from(nexetChannelsTable)
    .where(eq(nexetChannelsTable.id, channelId))
    .limit(1);
  if (!channel) return;
  const today = todayStr();
  try {
    await ruleWatchTimeDrop(channel, today);
    await ruleUnderperformingVideo(channel, today);
    await ruleUploadGap(channel, today);
  } catch (error) {
    logger.error({ channelId, err: error }, "Anomaly rule evaluation failed");
  }
}

// ---------------------------------------------------------------------------
// Orchestration + sync state
// ---------------------------------------------------------------------------

export interface ChannelSyncResult {
  status: "IDLE" | "ERROR";
  error: string | null;
  newVideosSeen: number;
}

type SyncPatch = Partial<typeof nexetChannelSyncsTable.$inferInsert>;

async function upsertSyncRow(channelId: string, patch: SyncPatch): Promise<void> {
  await db
    .insert(nexetChannelSyncsTable)
    .values({ channelId, ...patch, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: nexetChannelSyncsTable.channelId,
      set: { ...patch, updatedAt: new Date() },
    });
}

/**
 * Run the full sync pipeline for one channel. Degrades to stored partials +
 * an ERROR sync-state row on failure — never throws to the caller.
 */
export async function runChannelSync(channelId: string): Promise<ChannelSyncResult> {
  const [channel] = await db
    .select()
    .from(nexetChannelsTable)
    .where(eq(nexetChannelsTable.id, channelId))
    .limit(1);
  if (!channel) return { status: "ERROR", error: "Channel not found", newVideosSeen: 0 };
  if (!channel.youtubeChannelId) {
    const error = "This channel is not linked to a YouTube channel yet";
    await upsertSyncRow(channelId, { status: "ERROR", error, newVideosSeen: 0 });
    return { status: "ERROR", error, newVideosSeen: 0 };
  }
  const token = await getChannelAccessToken(channelId);
  if (!token) {
    const error = "No active YouTube link — reconnect the channel";
    await upsertSyncRow(channelId, { status: "ERROR", error, newVideosSeen: 0 });
    return { status: "ERROR", error, newVideosSeen: 0 };
  }

  await upsertSyncRow(channelId, { status: "SYNCING", error: null });
  let newVideosSeen = 0;
  try {
    newVideosSeen = await syncCatalog(channelId, token, channel.youtubeChannelId);
    await upsertSyncRow(channelId, { lastVideoSyncAt: new Date(), newVideosSeen, error: null });

    try {
      await syncChannelMetrics(channelId, token, channel.youtubeChannelId);
      await syncVideoMetrics(channelId, token, channel.youtubeChannelId);
      await upsertSyncRow(channelId, { lastMetricsSyncAt: new Date(), newVideosSeen, error: null });
    } catch (error) {
      const message = errorMessage(error);
      await upsertSyncRow(channelId, { status: "ERROR", error: message, newVideosSeen });
      logger.error({ channelId, err: error }, "Channel analytics metrics sync failed");
      return { status: "ERROR", error: message, newVideosSeen };
    }

    // Report refresh + anomaly rules never fail the sync — partials stay stored.
    try {
      await refreshStaleReports(channelId, token, channel.youtubeChannelId);
    } catch (error) {
      logger.warn({ channelId, err: error }, "Channel analytics report refresh failed");
    }
    await runAnomalyRules(channelId);

    await upsertSyncRow(channelId, { status: "IDLE", error: null, newVideosSeen });
    return { status: "IDLE", error: null, newVideosSeen };
  } catch (error) {
    const message = errorMessage(error);
    await upsertSyncRow(channelId, { status: "ERROR", error: message, newVideosSeen });
    logger.error({ channelId, err: error }, "Channel analytics sync failed");
    return { status: "ERROR", error: message, newVideosSeen };
  }
}