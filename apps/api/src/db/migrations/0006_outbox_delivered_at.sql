-- ============================================================
-- 0006 — Outbox delivered_at
-- Replace boolean `delivered` with `delivered_at timestamptz`
-- for richer audit and retention logic (relay marks with timestamp,
-- retention job prunes rows WHERE delivered_at < now() - interval '30 days').
--
-- Expand → migrate → contract pattern (AGENTS §2 rule 14):
--   Step 1 (this migration): add delivered_at, backfill from delivered flag.
--   Step 2 (future): drop delivered column once all replicas are updated.
-- ============================================================

ALTER TABLE outbox_events
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

-- Backfill: rows already marked delivered get an approximate timestamp
UPDATE outbox_events
  SET delivered_at = created_at
  WHERE delivered = true AND delivered_at IS NULL;

-- Replace the partial index to use delivered_at
DROP INDEX IF EXISTS outbox_events_undelivered_idx;
CREATE INDEX IF NOT EXISTS outbox_events_undelivered_idx
  ON outbox_events (org_id, created_at)
  WHERE delivered_at IS NULL;
