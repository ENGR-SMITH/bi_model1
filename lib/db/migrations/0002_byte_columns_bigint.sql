-- =============================================================================
-- Migration: widen byte-count columns from integer → bigint
--
-- Why: the free storage tier is 2 GB = 2^31, which does NOT fit in a signed
-- 32-bit Postgres `integer` (max 2^31 - 1). Every fresh account's default
-- quota row INSERT (`getOrCreateQuota`) overflowed and threw a 500 — which
-- surfaced as "The upload failed. Try once more." on the vault upload card.
-- Paid plans (200 GB / 500 GB / 1 TB) are further past the limit, and raw
-- footage / derived artifacts exceed 2 GB routinely.
--
-- Source of truth: lib/db/src/schema/
--   → tandemAccountQuotasTable.storageLimitBytes        (account.ts)
--   → tandemVideoStorageSnapshotsTable.total/r2/local    (account.ts)
--   → tandemUserCvsTable.sizeBytes                       (account.ts)
--   → tandemVideoAssetsTable.sizeBytes                   (video-projects.ts)
--   → tandemVideoAssetFilesTable.sizeBytes               (video-production.ts)
--
-- Idempotent: every statement is guarded, so re-running is safe. Runs as a
-- single transaction; if any ALTER fails the whole batch rolls back.
--
-- Apply against the target database (any of):
--   psql "$DATABASE_URL" -f lib/db/migrations/0002_byte_columns_bigint.sql
--   psql -h <host> -U <user> -d tandem -f lib/db/migrations/0002_byte_columns_bigint.sql
--
-- NOTE: keep this file in lockstep with the Drizzle definitions above. Fresh
-- databases get these columns as bigint directly via `drizzle-kit push`;
-- this migration only upgrades databases that were provisioned before the fix.
-- =============================================================================

BEGIN;

-- tandem_account_quotas.storage_limit_bytes — the overflow that broke uploads.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tandem_account_quotas'
      AND column_name = 'storage_limit_bytes'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "tandem_account_quotas"
      ALTER COLUMN "storage_limit_bytes" TYPE bigint;
  END IF;
END $$;

-- tandem_video_storage_snapshots.total_bytes / r2_bytes / local_bytes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tandem_video_storage_snapshots'
      AND column_name = 'total_bytes'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "tandem_video_storage_snapshots"
      ALTER COLUMN "total_bytes" TYPE bigint,
      ALTER COLUMN "r2_bytes"    TYPE bigint,
      ALTER COLUMN "local_bytes" TYPE bigint;
  END IF;
END $$;

-- tandem_user_cvs.size_bytes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tandem_user_cvs'
      AND column_name = 'size_bytes'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "tandem_user_cvs"
      ALTER COLUMN "size_bytes" TYPE bigint;
  END IF;
END $$;

-- tandem_video_assets.size_bytes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tandem_video_assets'
      AND column_name = 'size_bytes'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "tandem_video_assets"
      ALTER COLUMN "size_bytes" TYPE bigint;
  END IF;
END $$;

-- tandem_video_asset_files.size_bytes
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tandem_video_asset_files'
      AND column_name = 'size_bytes'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE "tandem_video_asset_files"
      ALTER COLUMN "size_bytes" TYPE bigint;
  END IF;
END $$;

COMMIT;

-- Rollback (deliberately not part of the forward migration):
--   ALTER TABLE "tandem_account_quotas"          ALTER COLUMN "storage_limit_bytes" TYPE integer;
--   ALTER TABLE "tandem_video_storage_snapshots" ALTER COLUMN "total_bytes" TYPE integer, ALTER COLUMN "r2_bytes" TYPE integer, ALTER COLUMN "local_bytes" TYPE integer;
--   ALTER TABLE "tandem_user_cvs"                ALTER COLUMN "size_bytes" TYPE integer;
--   ALTER TABLE "tandem_video_assets"            ALTER COLUMN "size_bytes" TYPE integer;
--   ALTER TABLE "tandem_video_asset_files"       ALTER COLUMN "size_bytes" TYPE integer;