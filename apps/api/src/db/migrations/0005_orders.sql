-- Migration: 0005_orders.sql
-- Purpose: Orders, order items, order events (append-only audit), and outbox for webhooks.
-- Reference: ARCH §7 (Orders), AGENTS §2 rule 6 (DB), §6 (state machine must be pure/tested)

-- ============================================================
-- Orders
-- ============================================================
CREATE TABLE IF NOT EXISTS orders (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id       uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  table_id        uuid        REFERENCES tables (id) ON DELETE SET NULL,
  session_id      uuid        REFERENCES table_sessions (id) ON DELETE SET NULL,
  customer_id     uuid        REFERENCES customers (id) ON DELETE SET NULL,
  idempotency_key text        NOT NULL,            -- AGENTS §2 rule 8
  status          text        NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','CONFIRMED','PREPARING','READY','SERVED','BILLED','CANCELLED')),
  -- Pricing — all in integer paise, never float (AGENTS §2 rule 1)
  subtotal_paise  int         NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
  tax_paise       int         NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  discount_paise  int         NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  total_paise     int         NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  -- Metadata
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Enforce idempotency per org
CREATE UNIQUE INDEX IF NOT EXISTS orders_idempotency_key_uidx
  ON orders (org_id, idempotency_key);

CREATE INDEX IF NOT EXISTS orders_org_id_idx      ON orders (org_id);
CREATE INDEX IF NOT EXISTS orders_outlet_id_idx   ON orders (outlet_id);
CREATE INDEX IF NOT EXISTS orders_table_id_idx    ON orders (table_id) WHERE table_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_session_id_idx  ON orders (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_status_idx      ON orders (org_id, status);
CREATE INDEX IF NOT EXISTS orders_customer_idx    ON orders (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON orders
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON orders TO dineflow_app;

-- ============================================================
-- Order Items
-- ============================================================
CREATE TABLE IF NOT EXISTS order_items (
  id                uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid  NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  order_id          uuid  NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  menu_item_id      uuid  NOT NULL REFERENCES menu_items (id) ON DELETE RESTRICT,
  -- Snapshot pricing at time of order — never re-read from menu_items (AGENTS §2 rule 2)
  name_snapshot     text  NOT NULL,
  unit_price_paise  int   NOT NULL CHECK (unit_price_paise > 0),
  quantity          int   NOT NULL DEFAULT 1 CHECK (quantity > 0),
  line_total_paise  int   NOT NULL CHECK (line_total_paise > 0),
  -- Modifiers snapshot as JSONB: [{name, price_paise}]
  modifiers         jsonb NOT NULL DEFAULT '[]',
  notes             text,
  status            text  NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','PREPARING','READY','SERVED','CANCELLED')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_items_org_id_idx   ON order_items (org_id);
CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items (order_id);
CREATE INDEX IF NOT EXISTS order_items_status_idx   ON order_items (org_id, status);

ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_items
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON order_items TO dineflow_app;

-- ============================================================
-- Order Events — append-only audit log (AGENTS §2 rule 6, §6 DB rules)
-- No UPDATE/DELETE granted to app role.
-- ============================================================
CREATE TABLE IF NOT EXISTS order_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  order_id    uuid        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  event_type  text        NOT NULL,  -- e.g. ORDER_PLACED, STATUS_CHANGED, ITEM_ADDED
  actor_type  text        NOT NULL CHECK (actor_type IN ('STAFF', 'CUSTOMER', 'SYSTEM')),
  actor_id    uuid,                  -- staff_user id or customer id
  payload     jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS order_events_order_id_idx ON order_events (order_id);
CREATE INDEX IF NOT EXISTS order_events_org_id_idx   ON order_events (org_id);

ALTER TABLE order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON order_events
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- Append-only: no UPDATE/DELETE (AGENTS §6)
GRANT SELECT, INSERT ON order_events TO dineflow_app;

-- ============================================================
-- Outbox Events — for async webhook / notification delivery
-- Written in same TX as state changes (AGENTS §2 rule 6)
-- ============================================================
CREATE TABLE IF NOT EXISTS outbox_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  aggregate    text        NOT NULL,   -- 'order', 'payment', etc.
  aggregate_id uuid        NOT NULL,
  event_type   text        NOT NULL,
  payload      jsonb       NOT NULL DEFAULT '{}',
  delivered    boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_events_undelivered_idx
  ON outbox_events (org_id, delivered) WHERE NOT delivered;
CREATE INDEX IF NOT EXISTS outbox_events_aggregate_idx
  ON outbox_events (aggregate_id);

ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outbox_events
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- INSERT to write, UPDATE only to mark delivered
GRANT SELECT, INSERT, UPDATE ON outbox_events TO dineflow_app;
