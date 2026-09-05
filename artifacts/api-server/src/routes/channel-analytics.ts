// ---------------------------------------------------------------------------
// Channel analytics routes (§11.3). All reads are DB-backed — the sync engine
// (src/youtube/sync.ts) writes the snapshot tables, and page loads never call
// YouTube. Reads require channel membership (owner or editor); the manual sync
// is owner-only and throttled ~1/min. Freshness is surfaced honestly via the
// sync-state row (lastSyncedAt / status / error / newVideosSeen).
//
// Path params are validated inline: Orval emits the path-params zod const for
// these operations under the same name as the generated query-params type, so
// the barrel only ships the type (see lib/api-zod/src/index.ts). The params
// are plain minLength-1 strings, so a tiny local check matches the contract.
// ---------------------------------------------------------------------------

import { getAuth } from "@clerk/express";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { Router, type IRouter, type Request } from "express";
import {
  db,
  tandemChannelsTable,
  tandemChannelVideosTable,
  tandemChannelDailyMetricsTable,
  tandemVideoDailyMetricsTable,
  tandemAnalyticsReportsTable,
  tandemChannelSyncsTable,
  type TandemChannelSync,
} from "@workspace/db";
import {
  GetChannelAnalyticsOverviewQueryParams,
  GetChannelAnalyticsOverviewResponse,
  ListChannelAnalyticsVideosQueryParams,
  ListChannelAnalyticsVideosResponse,
  GetChannelAnalyticsVideoQueryParams,
  GetChannelAnalyticsVideoResponse,
  GetChannelAnalyticsVideoReportQueryParams,
  GetChannelAnalyticsVideoReportResponse,
  RunChannelAnalyticsSyncResponse,
} from "@workspace/api-zod";
import { channelMembership } from "./channels";
import { runChannelSync } from "../youtube/sync";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const MANUAL_SYNC_THROTTLE_MS = 60_000;
const manualSyncAt = new Map<string, number>();

/** Test hook: clear the manual-sync throttle map between cases. */
export function resetAnalyticsSyncThrottle(): void {
  manualSyncAt.clear();
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Path params are minLength-1 strings; empty → 400. */
function pathParam(req: Request, name: "channelId" | "videoRowId"): string {
  const value = req.params[name];
  return typeof value === "string" ? value.trim() : "";
}

/** The caller's role on the channel, or null (also used for the 404 check). */
async function requireChannelMember(channelId: string, userId: string): Promise<{ role: "OWNER" | "EDITOR" } | null> {
  const [channel] = await db
    .select({ id: tandemChannelsTable.id })
    .from(tandemChannelsTable)
    .where(eq(tandemChannelsTable.id, channelId))
    .limit(1);
  if (!channel) return null;
  const membership = await channelMembership(channelId, userId);
  if (!membership) return null;
  return { role: membership.role as "OWNER" | "EDITOR" };
}

/** Sum metric objects across rows (absent keys stay absent). */
function sumMetrics(rows: Array<{ metrics: Record<string, number> }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.metrics)) {
      if (typeof value === "number") out[key] = (out[key] ?? 0) + value;
    }
  }
  return out;
}

/** The channel's sync-state row, or null. */
async function syncState(channelId: string): Promise<TandemChannelSync | null> {
  const [row] = await db
    .select()
    .from(tandemChannelSyncsTable)
    .where(eq(tandemChannelSyncsTable.channelId, channelId))
    .limit(1);
  return row ?? null;
}

function freshness(row: TandemChannelSync | null) {
  if (!row) return { lastSyncedAt: null, status: null, error: null, newVideosSeen: 0 };
  const lastSyncedAt = row.lastMetricsSyncAt ?? row.lastVideoSyncAt ?? null;
  return {
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
    status: row.status,
    error: row.error ?? null,
    newVideosSeen: row.newVideosSeen ?? 0,
  };
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// GET /channels/:channelId/analytics/overview
router.get("/channels/:channelId/analytics/overview", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const channelId = pathParam(req, "channelId");
  if (!channelId) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }
  const query = GetChannelAnalyticsOverviewQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }
  const member = await requireChannelMember(channelId, userId);
  if (!member) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  const rows = await db
    .select({ day: tandemChannelDailyMetricsTable.day, metrics: tandemChannelDailyMetricsTable.metrics })
    .from(tandemChannelDailyMetricsTable)
    .where(eq(tandemChannelDailyMetricsTable.channelId, channelId))
    .orderBy(asc(tandemChannelDailyMetricsTable.day));

  const today = todayStr();
  const firstDay = rows[0]?.day ?? today;
  const from = query.data.from ?? firstDay;
  const to = query.data.to ?? today;
  const windowRows = rows.filter((row) => row.day >= from && row.day <= to);

  const series = windowRows.map((row) => ({
    day: row.day,
    views: row.metrics.views ?? null,
    watchTimeMinutes: row.metrics.watchTimeMinutes ?? null,
    subscribersGained: row.metrics.subscribersGained ?? null,
    subscribersLost: row.metrics.subscribersLost ?? null,
    estimatedRevenueUsd: row.metrics.estimatedRevenueUsd ?? null,
  }));

  const { lastSyncedAt, status, error, newVideosSeen } = freshness(await syncState(channelId));
  res.json(
    GetChannelAnalyticsOverviewResponse.parse({
      channelId,
      from,
      to,
      kpis: sumMetrics(windowRows),
      series,
      lastSyncedAt,
      status,
      error,
      newVideosSeen,
    }),
  );
});

// GET /channels/:channelId/analytics/videos
router.get("/channels/:channelId/analytics/videos", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const channelId = pathParam(req, "channelId");
  if (!channelId) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }
  const query = ListChannelAnalyticsVideosQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid filters" });
    return;
  }
  const member = await requireChannelMember(channelId, userId);
  if (!member) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  const q = query.data.q?.trim() ?? "";
  const videos = await db
    .select()
    .from(tandemChannelVideosTable)
    .where(
      and(
        eq(tandemChannelVideosTable.channelId, channelId),
        q ? sql`lower(${tandemChannelVideosTable.title}) like ${`%${q.toLowerCase()}%`}` : undefined,
      ),
    );

  // Per-video metrics: counters summed over the window (or lifetime), ratios
  // from the latest day within the window.
  const ids = videos.map((v) => v.id);
  const metricRows = ids.length > 0
    ? await db
        .select({
          videoRowId: tandemVideoDailyMetricsTable.videoRowId,
          day: tandemVideoDailyMetricsTable.day,
          metrics: tandemVideoDailyMetricsTable.metrics,
        })
        .from(tandemVideoDailyMetricsTable)
        .where(inArray(tandemVideoDailyMetricsTable.videoRowId, ids))
    : [];
  const byVideo = new Map<string, Array<{ day: string; metrics: Record<string, number> }>>();
  for (const row of metricRows) {
    const list = byVideo.get(row.videoRowId) ?? [];
    list.push({ day: row.day, metrics: row.metrics });
    byVideo.set(row.videoRowId, list);
  }

  const windowFrom = query.data.from ?? null;
  const windowTo = query.data.to ?? null;
  const rowForVideo = (videoId: string) => {
    const list = (byVideo.get(videoId) ?? []).filter(
      (r) => (!windowFrom || r.day >= windowFrom) && (!windowTo || r.day <= windowTo),
    );
    list.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    const counters = sumMetrics(list);
    const latest = list[list.length - 1]?.metrics ?? {};
    return {
      views: counters.views ?? null,
      watchTimeMinutes: counters.watchTimeMinutes ?? null,
      averageViewDurationSeconds: latest.averageViewDurationSeconds ?? null,
      likes: counters.likes ?? null,
      comments: counters.comments ?? null,
      shares: counters.shares ?? null,
      impressions: counters.impressions ?? null,
      impressionsClickThroughRate: latest.impressionsClickThroughRate ?? null,
      averageViewPercentage: latest.averageViewPercentage ?? null,
      estimatedRevenueUsd: counters.estimatedRevenueUsd ?? null,
    };
  };

  type SortKey = "views" | "watchTime" | "likes" | "ctr" | "retention" | "revenue" | "publishedAt";
  const sortKey: SortKey = query.data.sort ?? "publishedAt";
  const dir = query.data.dir ?? "desc";
  const rows = videos.map((video) => {
    const metrics = rowForVideo(video.id);
    const published = video.publishedAt ? video.publishedAt.getTime() : 0;
    const sortValue =
      sortKey === "views" ? (metrics.views ?? 0)
      : sortKey === "watchTime" ? (metrics.watchTimeMinutes ?? 0)
      : sortKey === "likes" ? (metrics.likes ?? 0)
      : sortKey === "ctr" ? (metrics.impressionsClickThroughRate ?? -1)
      : sortKey === "retention" ? (metrics.averageViewPercentage ?? -1)
      : sortKey === "revenue" ? (metrics.estimatedRevenueUsd ?? 0)
      : published;
    return {
      videoRowId: video.id,
      youtubeVideoId: video.youtubeVideoId,
      title: video.title,
      publishedAt: video.publishedAt ? video.publishedAt.toISOString() : null,
      contentKind: video.contentKind as "LONG_FORM" | "SHORT" | "LIVE",
      durationSeconds: video.durationSeconds,
      thumbnails: video.thumbnails ?? null,
      ...metrics,
      _sortValue: sortValue,
    };
  });
  rows.sort((a, b) => (dir === "asc" ? a._sortValue - b._sortValue : b._sortValue - a._sortValue));

  // Opaque offset cursor.
  let offset = 0;
  if (query.data.cursor) {
    try {
      const decoded = Buffer.from(query.data.cursor, "base64url").toString("utf8");
      if (decoded.startsWith("o:")) offset = Number(decoded.slice(2)) || 0;
    } catch {
      offset = 0;
    }
  }
  const limit = query.data.limit ?? 25;
  const page = rows.slice(offset, offset + limit);
  const nextCursor = offset + page.length < rows.length ? Buffer.from(`o:${offset + page.length}`).toString("base64url") : null;

  const items = page.map(({ _sortValue: _ignored, ...row }) => row);
  res.json(ListChannelAnalyticsVideosResponse.parse({ items, nextCursor }));
});

// GET /channels/:channelId/analytics/videos/:videoRowId
router.get("/channels/:channelId/analytics/videos/:videoRowId", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const channelId = pathParam(req, "channelId");
  const videoRowId = pathParam(req, "videoRowId");
  if (!channelId || !videoRowId) {
    res.status(400).json({ error: "Invalid channel or video id" });
    return;
  }
  const query = GetChannelAnalyticsVideoQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid date range" });
    return;
  }
  const member = await requireChannelMember(channelId, userId);
  if (!member) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  const [video] = await db
    .select()
    .from(tandemChannelVideosTable)
    .where(and(eq(tandemChannelVideosTable.id, videoRowId), eq(tandemChannelVideosTable.channelId, channelId)))
    .limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found in this channel" });
    return;
  }

  const rows = await db
    .select({ day: tandemVideoDailyMetricsTable.day, metrics: tandemVideoDailyMetricsTable.metrics })
    .from(tandemVideoDailyMetricsTable)
    .where(eq(tandemVideoDailyMetricsTable.videoRowId, video.id))
    .orderBy(asc(tandemVideoDailyMetricsTable.day));
  const from = query.data.from ?? null;
  const to = query.data.to ?? null;
  const windowRows = rows.filter((r) => (!from || r.day >= from) && (!to || r.day <= to));

  const series = windowRows.map((row) => ({ day: row.day, metrics: row.metrics }));

  // Channel-median context for anomaly banners: median CTR + median AVD across
  // every catalog video's latest metric day.
  const allVideos = await db
    .select({ id: tandemChannelVideosTable.id })
    .from(tandemChannelVideosTable)
    .where(eq(tandemChannelVideosTable.channelId, channelId));
  const allIds = allVideos.map((v) => v.id);
  const allMetrics = allIds.length > 0
    ? await db
        .select({
          videoRowId: tandemVideoDailyMetricsTable.videoRowId,
          day: tandemVideoDailyMetricsTable.day,
          metrics: tandemVideoDailyMetricsTable.metrics,
        })
        .from(tandemVideoDailyMetricsTable)
        .where(inArray(tandemVideoDailyMetricsTable.videoRowId, allIds))
    : [];
  const latestByVideo = new Map<string, { day: string; metrics: Record<string, number> }>();
  for (const row of allMetrics) {
    const current = latestByVideo.get(row.videoRowId);
    if (!current || row.day > current.day) latestByVideo.set(row.videoRowId, { day: row.day, metrics: row.metrics });
  }
  const ctrs: number[] = [];
  const avds: number[] = [];
  for (const { metrics } of latestByVideo.values()) {
    if (metrics.impressionsClickThroughRate != null) ctrs.push(metrics.impressionsClickThroughRate);
    if (metrics.averageViewDurationSeconds != null) avds.push(metrics.averageViewDurationSeconds);
  }
  const channelMedians = { impressionsClickThroughRate: median(ctrs), averageViewDurationSeconds: median(avds) };

  const { lastSyncedAt, status, error } = freshness(await syncState(channelId));
  res.json(
    GetChannelAnalyticsVideoResponse.parse({
      videoRowId: video.id,
      youtubeVideoId: video.youtubeVideoId,
      title: video.title,
      description: video.description,
      thumbnails: video.thumbnails ?? null,
      publishedAt: video.publishedAt ? video.publishedAt.toISOString() : null,
      contentKind: video.contentKind as "LONG_FORM" | "SHORT" | "LIVE",
      durationSeconds: video.durationSeconds,
      privacyStatus: video.privacyStatus,
      categoryId: video.categoryId,
      defaultLanguage: video.defaultLanguage,
      totals: sumMetrics(windowRows),
      series,
      channelMedians,
      lastSyncedAt,
      status,
      error,
    }),
  );
});

// GET /channels/:channelId/analytics/videos/:videoRowId/report
router.get("/channels/:channelId/analytics/videos/:videoRowId/report", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const channelId = pathParam(req, "channelId");
  const videoRowId = pathParam(req, "videoRowId");
  if (!channelId || !videoRowId) {
    res.status(400).json({ error: "Invalid channel or video id" });
    return;
  }
  const query = GetChannelAnalyticsVideoReportQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: "Invalid report kind" });
    return;
  }
  const member = await requireChannelMember(channelId, userId);
  if (!member) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }

  const [video] = await db
    .select()
    .from(tandemChannelVideosTable)
    .where(and(eq(tandemChannelVideosTable.id, videoRowId), eq(tandemChannelVideosTable.channelId, channelId)))
    .limit(1);
  if (!video) {
    res.status(404).json({ error: "Video not found in this channel" });
    return;
  }

  const kind = query.data.kind;
  const period = query.data.period ?? (kind === "RETENTION" ? 28 : 90);
  const today = todayStr();
  const periodStart = addDays(today, -(period - 1));
  const isChannelLevel = kind === "SUBS";

  const [cached] = await db
    .select()
    .from(tandemAnalyticsReportsTable)
    .where(
      and(
        eq(tandemAnalyticsReportsTable.channelId, channelId),
        isChannelLevel
          ? sql`${tandemAnalyticsReportsTable.videoRowId} is null`
          : eq(tandemAnalyticsReportsTable.videoRowId, video.id),
        eq(tandemAnalyticsReportsTable.kind, kind),
        eq(tandemAnalyticsReportsTable.periodStart, periodStart),
        eq(tandemAnalyticsReportsTable.periodEnd, today),
      ),
    )
    .limit(1);

  const ttlMs = (Number(process.env.YT_REPORT_TTL_MINUTES) || 360) * 60 * 1000;
  const fresh = cached && Date.now() - cached.fetchedAt.getTime() < ttlMs;

  if (fresh) {
    res.json(
      GetChannelAnalyticsVideoReportResponse.parse({
        kind,
        periodStart,
        periodEnd: today,
        fetchedAt: cached.fetchedAt.toISOString(),
        rows: cached.payload,
        stale: false,
      }),
    );
    return;
  }

  // Stale or missing — kick a refresh sync (fire-and-forget) and tell the UI.
  void runChannelSync(channelId).catch((error) => {
    logger.warn({ channelId, err: error }, "Report-triggered sync failed");
  });
  res.json(
    GetChannelAnalyticsVideoReportResponse.parse({
      kind,
      periodStart,
      periodEnd: today,
      fetchedAt: cached ? cached.fetchedAt.toISOString() : null,
      rows: cached?.payload ?? [],
      stale: true,
    }),
  );
});

// POST /channels/:channelId/analytics/sync — owner only, throttled ~1/min.
router.post("/channels/:channelId/analytics/sync", async (req: Request, res): Promise<void> => {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const channelId = pathParam(req, "channelId");
  if (!channelId) {
    res.status(400).json({ error: "Invalid channel id" });
    return;
  }
  const member = await requireChannelMember(channelId, userId);
  if (!member) {
    res.status(404).json({ error: "Channel not found" });
    return;
  }
  if (member.role !== "OWNER") {
    res.status(403).json({ error: "Only the channel owner can run a sync" });
    return;
  }

  const now = Date.now();
  const lastRun = manualSyncAt.get(channelId) ?? 0;
  if (now - lastRun < MANUAL_SYNC_THROTTLE_MS) {
    res.status(429).json({ error: "A sync just ran — try again in a minute" });
    return;
  }
  manualSyncAt.set(channelId, now);

  const result = await runChannelSync(channelId);
  const row = await syncState(channelId);
  res.json(
    RunChannelAnalyticsSyncResponse.parse({
      status: result.status,
      error: result.error,
      newVideosSeen: result.newVideosSeen,
      lastVideoSyncAt: row?.lastVideoSyncAt ?? null,
      lastMetricsSyncAt: row?.lastMetricsSyncAt ?? null,
    }),
  );
});

export default router;