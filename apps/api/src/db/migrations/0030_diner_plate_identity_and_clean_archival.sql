-- ============================================================================
-- Migration 0030: Diner Plate Identity, Canonical Display ID & Clean Archival
--
-- Security & Tenancy Invariants (AGENTS §2):
--  - Rule 1: Integer paise minor units only.
--  - Rule 3: Every tenant table has org_id and forced RLS.
--  - Rule 14: Expand -> migrate -> contract. Forward-only SQL.
--
-- Tables touched:
--  1. orders: add diner_id, diner_label, display_id; backfill display_id;
--             expand status check to include 'COMPLETED'
--  2. order_items: add diner_id, diner_label; expand status check to include 'CONFIRMED'
-- ============================================================================

-- ── 1. orders expansion ──────────────────────────────────────────────────────
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS diner_id TEXT,
  ADD COLUMN IF NOT EXISTS diner_label TEXT,
  ADD COLUMN IF NOT EXISTS display_id TEXT;

-- Expand orders status check to include COMPLETED
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'AWAITING_PAYMENT', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED',
    'BILLED', 'COMPLETED', 'CANCELLED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED'
  ));

-- Backfill display_id deterministically for all existing orders
UPDATE orders
SET display_id = CASE
  WHEN order_number IS NOT NULL THEN 'ORD-' || LPAD(order_number::text, 4, '0')
  ELSE 'ORD-' || UPPER(SUBSTRING(id::text, 1, 4))
END
WHERE display_id IS NULL;

-- Indexes for orders
CREATE INDEX IF NOT EXISTS orders_display_id_idx
  ON orders (display_id);

CREATE INDEX IF NOT EXISTS orders_org_display_id_idx
  ON orders (org_id, display_id);

CREATE INDEX IF NOT EXISTS orders_org_diner_idx
  ON orders (org_id, diner_id)
  WHERE diner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS orders_session_status_idx
  ON orders (session_id, status);

-- ── 2. order_items expansion ─────────────────────────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS diner_id TEXT,
  ADD COLUMN IF NOT EXISTS diner_label TEXT;

-- Expand order_items status check to include CONFIRMED
ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_status_check;
ALTER TABLE order_items ADD CONSTRAINT order_items_status_check
  CHECK (status IN ('PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'));

-- Backfill order_items diner_id and diner_label from orders if present
UPDATE order_items oi
SET diner_id = o.diner_id,
    diner_label = o.diner_label
FROM orders o
WHERE oi.order_id = o.id
  AND oi.diner_id IS NULL
  AND o.diner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS order_items_org_diner_idx
  ON order_items (org_id, diner_id)
  WHERE diner_id IS NOT NULL;
