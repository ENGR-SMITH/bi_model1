-- =============================================================================
-- Migration: Creator Den multi-channel workspaces
--
-- Why: Creator Den becomes a multi-channel platform for YouTube agencies /
-- MCNs. Each "channel" is a YouTube-linked workspace owned by one user; every
-- video project now lives inside a channel, and the den pages (studio, vault,
-- roles, review, analytics) are scoped per channel. This migration adds:
--   tandem_channels            — the workspace (status CREATED/CONNECTED)
--   tandem_channel_members     — OWNER + EDITOR roster (contributor strip +
--                                the editor's CMS mirror card)
--   tandem_channel_oauth       — encrypted YouTube OAuth tokens (one/channel)
--   tandem_video_projects.channel_id — project → channel binding (nullable:
--                                legacy projects stay unlinked until attached)
--
-- Source of truth: lib/db/src/schema/channels.ts
--   → tandemChannelsTable, tandemChannelMembersTable, tandemChannelOauthTable
--   lib/db/src/schema/video-projects.ts → tandemVideoProjectsTable.channelId
--
-- Idempotent: guarded so re-running is safe.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_channels'
  ) THEN
    CREATE TABLE "tandem_channels" (
      "id" text PRIMARY KEY NOT NULL,
      "owner_id" text NOT NULL,
      "status" text DEFAULT 'CREATED' NOT NULL,
      "name" text NOT NULL,
      "youtube_channel_id" text,
      "youtube_title" text,
      "youtube_description" text,
      "youtube_avatar_url" text,
      "youtube_banner_url" text,
      "youtube_country" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS "tandem_channels_youtube_channel_unique"
      ON "tandem_channels" ("youtube_channel_id")
      WHERE "youtube_channel_id" IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_channel_members'
  ) THEN
    CREATE TABLE "tandem_channel_members" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "user_id" text NOT NULL,
      "role" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE ("channel_id", "user_id")
    );
    CREATE INDEX IF NOT EXISTS "tandem_channel_member_user_idx"
      ON "tandem_channel_members" ("user_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_channel_oauth'
  ) THEN
    CREATE TABLE "tandem_channel_oauth" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "youtube_channel_id" text NOT NULL,
      "access_token_cipher" text NOT NULL,
      "refresh_token_cipher" text NOT NULL,
      "scope" text DEFAULT '' NOT NULL,
      "status" text DEFAULT 'ACTIVE' NOT NULL,
      "expires_at" timestamp with time zone,
      "linked_by_user_id" text NOT NULL,
      "last_refreshed_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE ("channel_id")
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_video_projects'
      AND column_name = 'channel_id'
  ) THEN
    ALTER TABLE "tandem_video_projects"
      ADD COLUMN "channel_id" text;
    CREATE INDEX IF NOT EXISTS "tandem_video_projects_channel_idx"
      ON "tandem_video_projects" ("channel_id");
  END IF;
END $$;
