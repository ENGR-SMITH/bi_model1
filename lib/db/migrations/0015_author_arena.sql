-- =============================================================================
-- Migration: Author Den Writers' Audition Arena
--
-- Why: Phase 0 of the arena plan (AUTHOR-DEN-AUDITION-ARENA-PLAN.md). The
-- Author Den gets one Arena board with two rails over the existing seed model:
--   * Open Roles  — a seed with kind = 'ROLE', a typed `role`, and the author's
--                   `role_pitch`; writers audition through the existing
--                   fork → submit → select → contract pipeline.
--   * Seed Pitches — the classic kind = 'SEED' rows, unchanged.
--
-- This migration adds:
--   collaboration_seeds.kind / role / role_pitch / filled_by / filled_at
--   collaboration_seed_open_role_project_unique   (partial, one OPEN role per
--                                                  project + role)
--   collaboration_arena_watches                   (role watch alerts)
--
-- Source of truth: lib/db/src/schema/collaborations.ts
--                  lib/db/src/schema/author-arena.ts
--
-- Additive and idempotent: every column is nullable or defaulted, existing rows
-- become kind = 'SEED', and re-running is safe.
-- =============================================================================

-- The two rails share one table. `kind` defaults to 'SEED' so rows published
-- before the Arena read back exactly as they always did.
ALTER TABLE "collaboration_seeds"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'SEED';

-- The typed writing role and the author's pitch for it; both NULL for seeds.
ALTER TABLE "collaboration_seeds"
  ADD COLUMN IF NOT EXISTS "role" text;

ALTER TABLE "collaboration_seeds"
  ADD COLUMN IF NOT EXISTS "role_pitch" text;

-- Set when an accepted audition fills the role.
ALTER TABLE "collaboration_seeds"
  ADD COLUMN IF NOT EXISTS "filled_by" text;

ALTER TABLE "collaboration_seeds"
  ADD COLUMN IF NOT EXISTS "filled_at" timestamp with time zone;

-- One OPEN role call per (project, role). The partial predicate leaves every
-- seed row out of the index, and a FILLED/CLOSED role can be reopened later.
CREATE UNIQUE INDEX IF NOT EXISTS "collaboration_seed_open_role_project_unique"
  ON "collaboration_seeds" ("source_project_id", "role")
  WHERE "kind" = 'ROLE' AND "availability" = 'OPEN';

CREATE INDEX IF NOT EXISTS "collaboration_seed_kind_availability_idx"
  ON "collaboration_seeds" ("kind", "availability");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'collaboration_arena_watches'
  ) THEN
    CREATE TABLE "collaboration_arena_watches" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "role" text NOT NULL,
      -- nullable: watch that role on one author's calls, or across the Arena.
      "creator_id" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "collaboration_arena_watch_user_idx"
      ON "collaboration_arena_watches" ("user_id");
  END IF;
END $$;
