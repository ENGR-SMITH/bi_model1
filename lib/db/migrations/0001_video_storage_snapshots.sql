-- =============================================================================
-- Migration: tandem_video_storage_snapshots
-- The metering ledger behind the storage bar. R2 does not bill per account; a
-- nightly job (api-server video/storage-maintenance.ts) records how many
-- physical bytes each project actually stores — originals + derived artifacts,
-- split by provider (r2 vs local processing disk).
--
-- Source of truth: lib/db/src/schema/account.ts
--   → tandemVideoStorageSnapshotsTable (drizzle-orm/pg-core)
--
-- Why this file exists: dev + deploy environments apply schema changes with
-- `drizzle-kit push --force` (scripts/post-merge.sh), but an already-provisioned
-- Postgres needs the table applied out of band. This is idempotent and safe to
-- run more than once.
--
-- Apply against the target database (any of):
--   psql "$DATABASE_URL" -f lib/db/migrations/0001_video_storage_snapshots.sql
--   psql -h <host> -U <user> -d tandem -f lib/db/migrations/0001_video_storage_snapshots.sql
--
-- NOTE: keep this file in lockstep with the Drizzle definition above. Any
-- object created here that is NOT in the schema file will be dropped by the
-- next `drizzle-kit push --force` reconciliation.
-- =============================================================================

CREATE TABLE IF NOT EXISTS "tandem_video_storage_snapshots" (
  "project_id"  text                     NOT NULL,
  "owner_id"    text                     NOT NULL,
  "day"         date                     NOT NULL,
  -- Total physical bytes stored for the project that day.
  -- bigint: project storage routinely exceeds 2 GB, and a 32-bit integer
  -- maxes out at 2^31 - 1.
  "total_bytes" bigint                   NOT NULL DEFAULT 0,
  -- Bytes held in R2 (billable at the R2 rate) vs local processing disk.
  "r2_bytes"    bigint                   NOT NULL DEFAULT 0,
  "local_bytes" bigint                   NOT NULL DEFAULT 0,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

-- Unique (project_id, day): one snapshot row per project per day. Also the
-- upsert conflict target used by runStorageMetering's onConflictDoUpdate, and
-- the index serving storageUsedBytes' `project_id IN (...) ORDER BY day DESC`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tandem_video_storage_snapshot_project_day'
      AND conrelid = 'tandem_video_storage_snapshots'::regclass
  ) THEN
    ALTER TABLE "tandem_video_storage_snapshots"
      ADD CONSTRAINT "tandem_video_storage_snapshot_project_day"
      UNIQUE ("project_id", "day");
  END IF;
END $$;

-- Rollback (deliberately not part of the forward migration):
--   DROP TABLE IF EXISTS "tandem_video_storage_snapshots";
