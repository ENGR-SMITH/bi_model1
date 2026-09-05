import { createInsertSchema } from "drizzle-zod";
import {
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Creator Den — channel analytics (Phase 3). Periodic snapshots of the linked
// YouTube channel, stored in Postgres; the pages never proxy live YouTube API
// responses. The sync engine (artifacts/api-server/src/youtube/sync.ts) writes
// these rows; the analytics routes (§11.3) only ever read them.
// ---------------------------------------------------------------------------

// Channel-level daily metric shape. YouTube's Analytics API returns nulls for
// non-monetized rows, so every key is optional — absent keys mean "no data".
export const channelMetricsSchema = z.object({
  views: z.number().optional(),
  watchTimeMinutes: z.number().optional(),
  averageViewDurationSeconds: z.number().optional(),
  subscribersGained: z.number().optional(),
  subscribersLost: z.number().optional(),
  estimatedRevenueUsd: z.number().optional(),
  estimatedAdRevenueUsd: z.number().optional(),
  likes: z.number().optional(),
  comments: z.number().optional(),
  shares: z.number().optional(),
});
export type ChannelMetrics = z.infer<typeof channelMetricsSchema>;

// Per-video daily metric shape — channel metrics plus the impression/CTR and
// retention signals the Analytics API only exposes per video.
export const videoMetricsSchema = channelMetricsSchema.extend({
  impressions: z.number().optional(),
  impressionsClickThroughRate: z.number().optional(),
  averageViewPercentage: z.number().optional(),
});
export type VideoMetrics = z.infer<typeof videoMetricsSchema>;

export const channelContentKindSchema = z.enum(["LONG_FORM", "SHORT", "LIVE"]);
export const analyticsReportKindSchema = z.enum([
  "RETENTION",
  "TRAFFIC",
  "PLAYBACK_LOCATION",
  "DEMOGRAPHICS",
  "DEVICES",
  "REVENUE",
  "SUBS",
]);

// Catalog of videos published on the linked YouTube channel, upserted by the
// catalog sync. One row per (channel, youtube video).
export const tandemChannelVideosTable = pgTable(
  "tandem_channel_videos",
  {
    id: text("id").primaryKey(), // chanvid_…
    channelId: text("channel_id").notNull(),
    youtubeVideoId: text("youtube_video_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    // snippet.thumbnails passthrough: { default, medium, high, … } → { url }
    thumbnails: jsonb("thumbnails").$type<Record<string, { url?: string } | undefined>>(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    durationSeconds: integer("duration_seconds"),
    privacyStatus: text("privacy_status"),
    categoryId: text("category_id"),
    defaultLanguage: text("default_language"),
    // LONG_FORM | SHORT | LIVE — derived from duration/contentDetails.
    contentKind: text("content_kind").notNull().default("LONG_FORM"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    channelVideoUnique: unique("tandem_channel_video_channel_video").on(
      table.channelId,
      table.youtubeVideoId,
    ),
  }),
);

// Channel-level daily metric snapshots (upserted, never deleted).
export const tandemChannelDailyMetricsTable = pgTable(
  "tandem_channel_daily_metrics",
  {
    channelId: text("channel_id").notNull(),
    day: date("day").notNull(), // YYYY-MM-DD
    metrics: jsonb("metrics").$type<ChannelMetrics>().notNull(),
    source: text("source").notNull().default("youtube"),
  },
  (table) => ({
    channelDayUnique: unique("tandem_channel_daily_metric_channel_day").on(
      table.channelId,
      table.day,
    ),
  }),
);

// Per-video daily metric snapshots (upserted, never deleted).
export const tandemVideoDailyMetricsTable = pgTable(
  "tandem_video_daily_metrics",
  {
    videoRowId: text("video_row_id").notNull(),
    day: date("day").notNull(), // YYYY-MM-DD
    metrics: jsonb("metrics").$type<VideoMetrics>().notNull(),
  },
  (table) => ({
    videoDayUnique: unique("tandem_video_daily_metric_video_day").on(
      table.videoRowId,
      table.day,
    ),
  }),
);

// On-demand analytics report cache (retention / traffic / demographics /
// devices / revenue / subs). Fetched lazily by the report endpoint, refreshed
// by the sync loop beyond YT_REPORT_TTL_MINUTES. `videoRowId` is null for
// channel-level reports (SUBS); the client-normalized row objects live in
// `payload` (zod-validated arrays, keyed by column name).
export const tandemAnalyticsReportsTable = pgTable(
  "tandem_analytics_reports",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    videoRowId: text("video_row_id"),
    kind: text("kind").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    payload: jsonb("payload").$type<Array<Record<string, string | number | null>>>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // channel-level rows carry videoRowId = NULL; Postgres treats NULLs as
    // distinct in unique constraints, so the sync engine dedupes those with a
    // select-before-insert (see youtube/sync.ts).
    reportUnique: unique("tandem_analytics_report_channel_kind_period").on(
      table.channelId,
      table.videoRowId,
      table.kind,
      table.periodStart,
      table.periodEnd,
    ),
  }),
);

// Per-channel sync state. One row per channel; status IDLE | SYNCING | ERROR.
export const tandemChannelSyncsTable = pgTable("tandem_channel_syncs", {
  channelId: text("channel_id").primaryKey(),
  lastVideoSyncAt: timestamp("last_video_sync_at", { withTimezone: true }),
  lastMetricsSyncAt: timestamp("last_metrics_sync_at", { withTimezone: true }),
  // IDLE | SYNCING | ERROR
  status: text("status").notNull().default("IDLE"),
  error: text("error"),
  // Uploads discovered on the most recent catalog sync (drives the UI banner).
  newVideosSeen: integer("new_videos_seen").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// v1 anomaly alerts (§14). One row per (channel, rule, window) — the unique
// constraint is the dedupe: the same alert never fires twice for a window.
export const tandemChannelAlertsTable = pgTable(
  "tandem_channel_alerts",
  {
    id: text("id").primaryKey(),
    channelId: text("channel_id").notNull(),
    // WATCH_TIME_DROP | VIDEO_UNDERPERFORMING | UPLOAD_GAP
    rule: text("rule").notNull(),
    message: text("message").notNull(),
    periodStart: date("period_start").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ruleWindowUnique: unique("tandem_channel_alert_rule_window").on(
      table.channelId,
      table.rule,
      table.periodStart,
    ),
  }),
);

export const insertTandemChannelVideoSchema = createInsertSchema(tandemChannelVideosTable);
export const insertTandemChannelDailyMetricSchema = createInsertSchema(tandemChannelDailyMetricsTable);
export const insertTandemVideoDailyMetricSchema = createInsertSchema(tandemVideoDailyMetricsTable);
export const insertTandemAnalyticsReportSchema = createInsertSchema(tandemAnalyticsReportsTable);
export const insertTandemChannelSyncSchema = createInsertSchema(tandemChannelSyncsTable);
export const insertTandemChannelAlertSchema = createInsertSchema(tandemChannelAlertsTable);

export type TandemChannelVideo = typeof tandemChannelVideosTable.$inferSelect;
export type TandemChannelDailyMetric = typeof tandemChannelDailyMetricsTable.$inferSelect;
export type TandemVideoDailyMetric = typeof tandemVideoDailyMetricsTable.$inferSelect;
export type TandemAnalyticsReport = typeof tandemAnalyticsReportsTable.$inferSelect;
export type TandemChannelSync = typeof tandemChannelSyncsTable.$inferSelect;
export type TandemChannelAlert = typeof tandemChannelAlertsTable.$inferSelect;