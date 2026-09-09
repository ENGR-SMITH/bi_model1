-- ---------------------------------------------------------------------------
-- NEXET rebrand: rename all tandem_* tables / indexes / sequences to nexet_*.
-- Data-preserving: only object names change; rows, columns, and foreign keys
-- are untouched (Postgres rewires FK references automatically on rename).
-- Idempotent: every statement is guarded so this migration is safe to re-run.
-- ---------------------------------------------------------------------------

-- Tables
DO $$
DECLARE
  r record;
  new_name text;
BEGIN
  FOR r IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public' AND tablename LIKE 'tandem\_%'
  LOOP
    new_name := 'nexet_' || substr(r.tablename, 8);
    IF to_regclass('public.' || quote_ident(new_name)) IS NULL THEN
      EXECUTE format('ALTER TABLE %I RENAME TO %I', r.tablename, new_name);
    END IF;
  END LOOP;
END $$;

-- Indexes (including auto-generated pkey/unique constraint indexes)
DO $$
DECLARE
  r record;
  new_name text;
BEGIN
  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname LIKE 'tandem\_%'
  LOOP
    new_name := 'nexet_' || substr(r.indexname, 8);
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = new_name
    ) THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.indexname, new_name);
    END IF;
  END LOOP;
END $$;

-- Sequences
DO $$
DECLARE
  r record;
  new_name text;
BEGIN
  FOR r IN
    SELECT sequence_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public' AND sequence_name LIKE 'tandem\_%'
  LOOP
    new_name := 'nexet_' || substr(r.sequence_name, 8);
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.sequences
      WHERE sequence_schema = 'public' AND sequence_name = new_name
    ) THEN
      EXECUTE format('ALTER SEQUENCE %I RENAME TO %I', r.sequence_name, new_name);
    END IF;
  END LOOP;
END $$;