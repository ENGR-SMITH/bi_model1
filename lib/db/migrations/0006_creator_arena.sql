-- =============================================================================
-- Migration: Creator Den Collaboration / Audition Arena (public contribution)
--
-- Why: Phase 0 of the arena plan (CREATOR-DEN-AUDITION-ARENA-PLAN.md). A
-- Captain posts an OPEN role (VIDEO/AUDIO/SCRIPT/THUMBNAIL) for a channel
-- project; signed-in creators browse the Arena, preview the project read-only
-- (PREVIEW + TIMELINE) while a post is OPEN, and apply with a message and
-- optional documents. This migration adds:
--   tandem_arena_posts              — an open role on one channel project
--   tandem_arena_applications       — one audition per (post, applicant)
--   tandem_arena_application_files  — supporting documents (≤3 × ≤15 MB)
--   tandem_arena_watches            — role watch alerts (role ± channel scope)
--   tandem_arena_reviews            — mutual post-hire work reviews (public)
--   tandem_arena_blocks             — per-Captain applicant blocks (anti-spam)
--
-- Source of truth: lib/db/src/schema/arena.ts
--
-- Idempotent: guarded so re-running is safe.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_arena_posts'
  ) THEN
    CREATE TABLE "tandem_arena_posts" (
      "id" text PRIMARY KEY NOT NULL,
      "channel_id" text NOT NULL,
      "project_id" text NOT NULL,
      "role" text NOT NULL,
      "pitch" text NOT NULL,
      "status" text DEFAULT 'OPEN' NOT NULL,
      "posted_by" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    -- One OPEN post per (project, role); FILLED/CLOSED rows do not block a
    -- later reopen of the same role on the same project.
    CREATE UNIQUE INDEX IF NOT EXISTS "tandem_arena_post_open_project_role_unique"
      ON "tandem_arena_posts" ("project_id", "role")
      WHERE "status" = 'OPEN';
    CREATE INDEX IF NOT EXISTS "tandem_arena_posts_channel_idx"
      ON "tandem_arena_posts" ("channel_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_arena_applications'
  ) THEN
    CREATE TABLE "tandem_arena_applications" (
      "id" text PRIMARY KEY NOT NULL,
      "post_id" text NOT NULL,
      "project_id" text NOT NULL,
      "role" text NOT NULL,
      "applicant_id" text NOT NULL,
      "message" text NOT NULL,
      "status" text DEFAULT 'PENDING' NOT NULL,
      "decided_by" text,
      "decided_at" timestamp with time zone,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    -- One PENDING audition per (post, applicant); a resolved row does not
    -- block the applicant applying to the same post again.
    CREATE UNIQUE INDEX IF NOT EXISTS "tandem_arena_application_pending_post_applicant_unique"
      ON "tandem_arena_applications" ("post_id", "applicant_id")
      WHERE "status" = 'PENDING';
    CREATE INDEX IF NOT EXISTS "tandem_arena_application_post_applicant_idx"
      ON "tandem_arena_applications" ("post_id", "applicant_id");
    CREATE INDEX IF NOT EXISTS "tandem_arena_applications_applicant_idx"
      ON "tandem_arena_applications" ("applicant_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_arena_application_files'
  ) THEN
    CREATE TABLE "tandem_arena_application_files" (
      "id" text PRIMARY KEY NOT NULL,
      "application_id" text NOT NULL,
      "file_name" text NOT NULL,
      "mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
      "size_bytes" bigint DEFAULT 0 NOT NULL,
      "storage_key" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "tandem_arena_application_file_application_idx"
      ON "tandem_arena_application_files" ("application_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_arena_watches'
  ) THEN
    CREATE TABLE "tandem_arena_watches" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "role" text NOT NULL,
      "channel_id" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "tandem_arena_watch_user_idx"
      ON "tandem_arena_watches" ("user_id");
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_arena_reviews'
  ) THEN
    CREATE TABLE "tandem_arena_reviews" (
      "id" text PRIMARY KEY NOT NULL,
      "application_id" text NOT NULL,
      "project_id" text NOT NULL,
      "role" text NOT NULL,
      "reviewer_id" text NOT NULL,
      "reviewee_id" text NOT NULL,
      "rating" integer NOT NULL,
      "note" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE ("application_id", "reviewer_id")
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_arena_blocks'
  ) THEN
    CREATE TABLE "tandem_arena_blocks" (
      "id" text PRIMARY KEY NOT NULL,
      "captain_id" text NOT NULL,
      "applicant_id" text NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      UNIQUE ("captain_id", "applicant_id")
    );
  END IF;
END $$;
