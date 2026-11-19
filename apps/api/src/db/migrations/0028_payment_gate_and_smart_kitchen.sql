-- ============================================================================
-- Migration 0028: Payment Gate & Smart Kitchen Orchestrator Schema
--
-- Security & Tenancy Invariants (AGENTS §2):
--  - Rule 1: Integer paise minor units only.
--  - Rule 3: Every tenant table has org_id and forced RLS.
--  - Rule 14: Expand -> migrate -> contract. Forward-only SQL.
--
-- Tables touched:
--  1. menu_items: course_sequence, prep_time_minutes
--  2. table_reservations: new table with org_id, forced RLS, composite indexes
--  3. orders: expanded status check, payment_status, payment_method, order_type,
--             scheduled_for, guest_count, reservation_id, paid_at,
--             main_course_served_at, serve_later_prompt_sent_at
--  4. order_items: course_sequence, prep_time_minutes, target_fire_at,
--                  hold_status, is_combo_item, combo_name
-- ============================================================================

-- ── 1. menu_items expansion ──────────────────────────────────────────────────
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS course_sequence SMALLINT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS prep_time_minutes INT NOT NULL DEFAULT 15;

-- Populate prep_time_minutes from prep_time_min if present
UPDATE menu_items
SET prep_time_minutes = prep_time_min
WHERE prep_time_min IS NOT NULL AND prep_time_minutes = 15;

-- Backfill course_sequence accurately based on category name
UPDATE menu_items mi
SET course_sequence = 1
FROM menu_categories mc
WHERE mi.category_id = mc.id
  AND mc.name ~* '(starter|soup|appetizer|chaat|snack|kebab|tikka)';

UPDATE menu_items mi
SET course_sequence = 2
FROM menu_categories mc
WHERE mi.category_id = mc.id
  AND mc.name ~* '(main|biryani|bread|curry|rice|roti|thali|dal|gravy)';

UPDATE menu_items mi
SET course_sequence = 3
FROM menu_categories mc
WHERE mi.category_id = mc.id
  AND mc.name ~* '(dessert|sweet|ice cream|kulfi|halwa|jamun|rasgulla)';

UPDATE menu_items mi
SET course_sequence = 4
FROM menu_categories mc
WHERE mi.category_id = mc.id
  AND mc.name ~* '(beverage|drink|juice|coffee|tea|chai|shake|lassi|soda|water)';

-- Specific dish item overrides if category was generic
UPDATE menu_items
SET course_sequence = 3
WHERE name ~* '(ice cream|kulfi|gulab jamun|halwa|rasgulla|dessert|sweet|cake|pastry|brownie)'
  AND course_sequence != 3;

UPDATE menu_items
SET course_sequence = 4
WHERE name ~* '(coffee|tea|chai|lassi|juice|beverage|cooler|mojito|shake|soda)'
  AND course_sequence != 4;

UPDATE menu_items
SET course_sequence = 1
WHERE name ~* '(soup|tikka|kebab|crispy|fingers|wings|manchurian|spring roll)'
  AND course_sequence NOT IN (3, 4);

-- ── 2. table_reservations table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS table_reservations (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id           UUID        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  customer_id         UUID        REFERENCES customers (id) ON DELETE SET NULL,
  customer_name       TEXT,
  customer_phone      TEXT,
  guest_count         INT         NOT NULL CHECK (guest_count > 0),
  assigned_table_ids  UUID[]      NOT NULL DEFAULT '{}',
  reserved_for        TIMESTAMPTZ NOT NULL,
  duration_minutes    INT         NOT NULL DEFAULT 90 CHECK (duration_minutes > 0),
  status              TEXT        NOT NULL DEFAULT 'PENDING_PAYMENT'
                        CHECK (status IN ('PENDING_PAYMENT', 'CONFIRMED', 'SEATED', 'COMPLETED', 'NO_SHOW', 'CANCELLED')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS table_reservations_outlet_res_status_idx
  ON table_reservations (outlet_id, reserved_for, status);

CREATE INDEX IF NOT EXISTS table_reservations_org_id_idx
  ON table_reservations (org_id);

ALTER TABLE table_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_reservations FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY tenant_isolation ON table_reservations
    USING (org_id = current_org_id())
    WITH CHECK (org_id = current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE ON table_reservations TO dineflow_app;

-- ── 3. orders expansion ──────────────────────────────────────────────────────
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
  CHECK (status IN (
    'AWAITING_PAYMENT', 'PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED',
    'BILLED', 'CANCELLED', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED'
  ));

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS payment_status TEXT NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS payment_method TEXT,
  ADD COLUMN IF NOT EXISTS order_type TEXT NOT NULL DEFAULT 'DINE_IN'
    CHECK (order_type IN ('DINE_IN', 'PRE_BOOK_DINE_IN', 'TAKEAWAY')),
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS guest_count INT,
  ADD COLUMN IF NOT EXISTS reservation_id UUID REFERENCES table_reservations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS main_course_served_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS serve_later_prompt_sent_at TIMESTAMPTZ;

-- Backfill payment_status and paid_at for existing orders
UPDATE orders o
SET payment_status = COALESCE((
  SELECT p.status::text FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1
), CASE WHEN o.status IN ('CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED') THEN 'PAID' ELSE 'PENDING' END);

UPDATE orders o
SET payment_method = COALESCE((
  SELECT p.method::text FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1
), CASE WHEN o.status IN ('CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED') THEN 'UPI' ELSE NULL END)
WHERE o.payment_method IS NULL;

UPDATE orders o
SET paid_at = COALESCE((
  SELECT p.settled_at FROM payments p WHERE p.order_id = o.id AND p.status = 'PAID' ORDER BY p.created_at DESC LIMIT 1
), CASE WHEN o.status IN ('CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED') THEN o.created_at ELSE NULL END)
WHERE o.payment_status = 'PAID' AND o.paid_at IS NULL;

CREATE INDEX IF NOT EXISTS orders_payment_status_idx ON orders (org_id, payment_status);
CREATE INDEX IF NOT EXISTS orders_awaiting_payment_idx ON orders (status, created_at)
  WHERE status = 'AWAITING_PAYMENT';

-- ── 4. order_items expansion ─────────────────────────────────────────────────
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS course_sequence SMALLINT NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS prep_time_minutes INT NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS target_fire_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS hold_status TEXT NOT NULL DEFAULT 'ACTIVE'
    CHECK (hold_status IN ('ACTIVE', 'SCHEDULED_WAIT', 'SERVE_LATER_HOLD', 'RELEASED')),
  ADD COLUMN IF NOT EXISTS is_combo_item BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS combo_name TEXT;

-- Backfill course_sequence and prep_time_minutes from menu_items
UPDATE order_items oi
SET course_sequence = mi.course_sequence,
    prep_time_minutes = mi.prep_time_minutes
FROM menu_items mi
WHERE oi.menu_item_id = mi.id;

CREATE INDEX IF NOT EXISTS order_items_hold_status_idx ON order_items (org_id, hold_status);
CREATE INDEX IF NOT EXISTS order_items_target_fire_at_idx ON order_items (target_fire_at)
  WHERE hold_status = 'SCHEDULED_WAIT';
