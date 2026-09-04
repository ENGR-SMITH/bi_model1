-- =============================================================================
-- Migration: tandem_tours — the one-time 10-minute den preview tour
--
-- Why: a visitor without an active category pass gets a single 10-minute
-- tour of the Author Den / Creator Den before the paywall blocks re-entry.
-- One row per (user, category) ever: granting the tour twice is impossible,
-- so once the countdown ends the only way back in is an active pass. Each
-- den keeps its own independent tour (separate category rows), matching the
-- separate Author & Writer / Content Creators passes.
--
-- Source of truth: lib/db/src/schema/tickets.ts
--   → tandemToursTable
--
-- Idempotent: guarded so re-running is safe.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name = 'tandem_tours'
  ) THEN
    CREATE TABLE "tandem_tours" (
      "id" text PRIMARY KEY NOT NULL,
      "user_id" text NOT NULL,
      "category" text NOT NULL,
      "started_at" timestamp with time zone DEFAULT now() NOT NULL,
      "ends_at" timestamp with time zone NOT NULL
    );
  END IF;
END $$;
