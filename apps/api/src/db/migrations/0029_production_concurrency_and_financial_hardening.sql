-- ============================================================================
-- Migration 0029: Production Concurrency & Financial Hardening
--
-- Security & Tenancy Invariants (AGENTS §2):
--  - Rule 1: Integer minor units (paise) only.
--  - Rule 3: Every tenant table has org_id and forced RLS.
--  - Rule 6: Append-only tables (no UPDATE/DELETE to app role).
--  - Rule 14: Expand -> migrate -> contract. Forward-only SQL.
--
-- Features:
--  1. btree_gist extension for PostgreSQL exclusion constraints
--  2. payment_reconciliation_flags: late webhooks after order expiry
--  3. table_reservation_slots: concurrency lock via exclusion constraint
--  4. order_items: claimed_by_staff_id, claimed_at for kitchen dual-chef lock
--  5. order_counters: gapless daily per-outlet order numbering
--  6. orders: order_number column
-- ============================================================================

-- ── 1. PostgreSQL Extension ──────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── 2. Payment Reconciliation Flags ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_reconciliation_flags (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id             UUID        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  order_id              UUID        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  payment_id            UUID        NOT NULL REFERENCES payments (id) ON DELETE CASCADE,
  reason                TEXT        NOT NULL,
  amount_paise          BIGINT      NOT NULL CHECK (amount_paise > 0),
  status                TEXT        NOT NULL DEFAULT 'NEEDS_REFUND'
                          CHECK (status IN ('NEEDS_REFUND', 'RESOLVED')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at           TIMESTAMPTZ,
  resolved_by_staff_id  UUID        REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS payment_reconciliation_flags_org_status_idx
  ON payment_reconciliation_flags (org_id, status);

CREATE INDEX IF NOT EXISTS payment_reconciliation_flags_order_idx
  ON payment_reconciliation_flags (order_id);

CREATE INDEX IF NOT EXISTS payment_reconciliation_flags_outlet_idx
  ON payment_reconciliation_flags (outlet_id);

ALTER TABLE payment_reconciliation_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_reconciliation_flags FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON payment_reconciliation_flags
    USING (org_id = current_org_id())
    WITH CHECK (org_id = current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON payment_reconciliation_flags TO dineflow_app;

-- ── 3. Table Reservation Slots (Concurrency Lock via Exclusion Constraint) ──
CREATE TABLE IF NOT EXISTS table_reservation_slots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id       UUID        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  reservation_id  UUID        NOT NULL REFERENCES table_reservations (id) ON DELETE CASCADE,
  table_id        UUID        NOT NULL REFERENCES tables (id) ON DELETE CASCADE,
  slot_range      TSTZRANGE   NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'PENDING_PAYMENT'
                    CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'SEATED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')),
  CONSTRAINT table_reservation_slots_no_overlap
    EXCLUDE USING gist (table_id WITH =, slot_range WITH &&)
    WHERE (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'SEATED'))
);

CREATE INDEX IF NOT EXISTS table_reservation_slots_org_res_idx
  ON table_reservation_slots (org_id, reservation_id);

CREATE INDEX IF NOT EXISTS table_reservation_slots_outlet_table_idx
  ON table_reservation_slots (outlet_id, table_id);

ALTER TABLE table_reservation_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_reservation_slots FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON table_reservation_slots
    USING (org_id = current_org_id())
    WITH CHECK (org_id = current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON table_reservation_slots TO dineflow_app;

-- ── 4. Kitchen Ticket Claim Lock on order_items ──────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS claimed_by_staff_id UUID REFERENCES staff_users (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS order_items_claimed_staff_idx
  ON order_items (claimed_by_staff_id)
  WHERE claimed_by_staff_id IS NOT NULL;

-- ── 5. Gapless Daily Order Counters & orders.order_number ────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS order_number INT;

CREATE TABLE IF NOT EXISTS order_counters (
  org_id        UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id     UUID        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  counter_date  DATE        NOT NULL DEFAULT CURRENT_DATE,
  last_seq      INT         NOT NULL DEFAULT 0,
  PRIMARY KEY (outlet_id, counter_date)
);

CREATE INDEX IF NOT EXISTS order_counters_org_idx
  ON order_counters (org_id);

ALTER TABLE order_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_counters FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON order_counters
    USING (org_id = current_org_id())
    WITH CHECK (org_id = current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON order_counters TO dineflow_app;

-- Backfill existing orders with a default sequence if null
UPDATE orders
SET order_number = 100
WHERE order_number IS NULL;
