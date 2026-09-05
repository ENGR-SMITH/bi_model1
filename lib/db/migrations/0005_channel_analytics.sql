-- =============================================================================
-- Migration: Creator Den channel analytics
--
-- Why: Phase 3 of the channels plan. Once a channel is linked to its real
-- YouTube channel, a background sync engine snapshots the catalog of published
-- videos and their daily metrics into Postgres so the analytics pages never
-- proxy live YouTube API responses. This migration adds:
--   tandem_channel_videos        — catalog of published uploads (upserted)
--   tandem_channel_daily_metrics — channel-level daily metric snapshots
--   tandem_video_daily_metrics   — per-video daily metric snapshots
--   tandem_analytics_reports     — on-demand report cache (retention/traffic/
--                                  demographics/devices/revenue/subs)
--   tandem_channel_syncs         — per-channel sync state (IDLE/SYNCING/ERROR)
--   tandem_channel_alerts        — v1 anomaly alerts (deduped per rule+window)
--
-- Source of truth: lib/db/src/schema/channel-analytics.ts
--
-- Idempotent: guarded so re-running is safe.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_channel_videos'
  ) THEN
    CREATE TABLE "tandem_channel_videos" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "youtube_video_id" text NOT NULL,
      "title" text NOT NULL,
      "description" text DEFAULT '' NOT NULL,
      "thumbnails" jsonb,
      "published_at" timestamp with time zone,
      "duration_seconds" integer,
      "privacy_status" text,
      "category_id" text,
      "default_language" text,
      "content_kind" text DEFAULT 'LONG_FORM' NOT NULL,
      "last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE ("channel_id", "youtube_video_id")
    );
    CREATE INDEX IF NOT EXISTS "tandem_channel_videos_channel_idx"
      ON "tandem_channel_videos" ("channel_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_channel_daily_metrics'
  ) THEN
    CREATE TABLE "tandem_channel_daily_metrics" (
      "channel_id" text NOT NULL,
      "day" date NOT NULL,
      "metrics" jsonb NOT NULL,
      "source" text DEFAULT 'youtube' NOT NULL,
      UNIQUE ("channel_id", "day")
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_video_daily_metrics'
  ) THEN
    CREATE TABLE "tandem_video_daily_metrics" (
      "video_row_id" text NOT NULL,
      "day" date NOT NULL,
      "metrics" jsonb NOT NULL,
      UNIQUE ("video_row_id", "day")
    );
    CREATE INDEX IF NOT EXISTS "tandem_video_daily_metrics_video_idx"
      ON "tandem_video_daily_metrics" ("video_row_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_analytics_reports'
  ) THEN
    CREATE TABLE "tandem_analytics_reports" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "video_row_id" text,
      "kind" text NOT NULL,
      "period_start" date NOT NULL,
      "period_end" date NOT NULL,
      "payload" jsonb NOT NULL,
      "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "tandem_analytics_reports_channel_idx"
      ON "tandem_analytics_reports" ("channel_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_channel_syncs'
  ) THEN
    CREATE TABLE "tandem_channel_syncs" (
      "channel_id" text PRIMARY KEY NOT NULL,
      "last_video_sync_at" timestamp with time zone,
      "last_metrics_sync_at" timestamp with time zone,
      "status" text DEFAULT 'IDLE' NOT NULL,
      "error" text,
      "new_videos_seen" integer DEFAULT 0 NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_channel_alerts'
  ) THEN
    CREATE TABLE "tandem_channel_alerts" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "rule" text NOT NULL,
      "message" text NOT NULL,
      "period_start" date NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE ("channel_id", "rule", "period_start")
    );
  END IF;
END $$;