-- ============================================================
-- 0008 — Analytics Rollups & Export Records
-- Rollup tables for daily/hourly metrics, item breakdown, payment mix.
-- All tables enforce org_id + forced RLS (AGENTS §2 rule 3).
-- Money stored as integer paise (AGENTS §2 rule 1).
-- Reference: ARCH §17, §15, §25, PROMPTS Phase 6
-- ============================================================

-- ============================================================
-- 1. Daily Outlet Rollups
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_daily_outlet_rollups (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id          uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  date               date        NOT NULL,
  order_count        int         NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  gross_sales_paise  bigint      NOT NULL DEFAULT 0 CHECK (gross_sales_paise >= 0),
  subtotal_paise     bigint      NOT NULL DEFAULT 0 CHECK (subtotal_paise >= 0),
  tax_paise          bigint      NOT NULL DEFAULT 0 CHECK (tax_paise >= 0),
  discount_paise     bigint      NOT NULL DEFAULT 0 CHECK (discount_paise >= 0),
  refund_paise       bigint      NOT NULL DEFAULT 0 CHECK (refund_paise >= 0),
  net_sales_paise    bigint      NOT NULL DEFAULT 0 CHECK (net_sales_paise >= 0),
  tip_paise          bigint      NOT NULL DEFAULT 0 CHECK (tip_paise >= 0),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_daily_outlet_rollup UNIQUE (org_id, outlet_id, date)
);

CREATE INDEX IF NOT EXISTS daily_rollups_org_idx      ON analytics_daily_outlet_rollups (org_id);
CREATE INDEX IF NOT EXISTS daily_rollups_outlet_date  ON analytics_daily_outlet_rollups (org_id, outlet_id, date);

ALTER TABLE analytics_daily_outlet_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_daily_outlet_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_daily_outlet_rollups
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_daily_outlet_rollups TO dineflow_app;

-- ============================================================
-- 2. Hourly Outlet Rollups (For heatmaps & hourly traffic)
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_hourly_outlet_rollups (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id   uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  date        date        NOT NULL,
  hour        smallint    NOT NULL CHECK (hour >= 0 AND hour <= 23),
  order_count int         NOT NULL DEFAULT 0 CHECK (order_count >= 0),
  total_paise bigint      NOT NULL DEFAULT 0 CHECK (total_paise >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_hourly_outlet_rollup UNIQUE (org_id, outlet_id, date, hour)
);

CREATE INDEX IF NOT EXISTS hourly_rollups_org_idx     ON analytics_hourly_outlet_rollups (org_id);
CREATE INDEX IF NOT EXISTS hourly_rollups_outlet_date ON analytics_hourly_outlet_rollups (org_id, outlet_id, date);

ALTER TABLE analytics_hourly_outlet_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_hourly_outlet_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_hourly_outlet_rollups
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_hourly_outlet_rollups TO dineflow_app;

-- ============================================================
-- 3. Item Daily Rollups (Top/bottom items & item revenue)
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_item_daily_rollups (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id         uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  menu_item_id      uuid        NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  item_name         text        NOT NULL,
  date              date        NOT NULL,
  quantity_sold     int         NOT NULL DEFAULT 0 CHECK (quantity_sold >= 0),
  total_sales_paise bigint      NOT NULL DEFAULT 0 CHECK (total_sales_paise >= 0),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_item_daily_rollup UNIQUE (org_id, outlet_id, menu_item_id, date)
);

CREATE INDEX IF NOT EXISTS item_rollups_org_idx     ON analytics_item_daily_rollups (org_id);
CREATE INDEX IF NOT EXISTS item_rollups_outlet_date ON analytics_item_daily_rollups (org_id, outlet_id, date);
CREATE INDEX IF NOT EXISTS item_rollups_item_date   ON analytics_item_daily_rollups (org_id, menu_item_id, date);

ALTER TABLE analytics_item_daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_item_daily_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_item_daily_rollups
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_item_daily_rollups TO dineflow_app;

-- ============================================================
-- 4. Payment Method Daily Rollups (Payment mix, fees, net)
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_payment_daily_rollups (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id     uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  date          date        NOT NULL,
  method        text        NOT NULL,
  payment_count int         NOT NULL DEFAULT 0 CHECK (payment_count >= 0),
  amount_paise  bigint      NOT NULL DEFAULT 0 CHECK (amount_paise >= 0),
  fee_paise     bigint      NOT NULL DEFAULT 0 CHECK (fee_paise >= 0),
  net_paise     bigint      NOT NULL DEFAULT 0 CHECK (net_paise >= 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_payment_daily_rollup UNIQUE (org_id, outlet_id, method, date)
);

CREATE INDEX IF NOT EXISTS payment_rollups_org_idx     ON analytics_payment_daily_rollups (org_id);
CREATE INDEX IF NOT EXISTS payment_rollups_outlet_date ON analytics_payment_daily_rollups (org_id, outlet_id, date);

ALTER TABLE analytics_payment_daily_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_payment_daily_rollups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_payment_daily_rollups
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_payment_daily_rollups TO dineflow_app;

-- ============================================================
-- 5. Analytics Exports (Async download records & status)
-- ============================================================
CREATE TABLE IF NOT EXISTS analytics_exports (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id       uuid        REFERENCES outlets (id) ON DELETE CASCADE,
  requested_by    uuid        NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  export_type     text        NOT NULL CHECK (export_type IN ('SALES', 'ITEMS', 'PAYMENTS', 'ORDERS')),
  format          text        NOT NULL CHECK (format IN ('CSV', 'JSON', 'XLSX')),
  status          text        NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  file_url        text,
  file_size_bytes int,
  row_count       int,
  date_from       date        NOT NULL,
  date_to         date        NOT NULL,
  error_message   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);

CREATE INDEX IF NOT EXISTS analytics_exports_org_idx ON analytics_exports (org_id, created_at DESC);

ALTER TABLE analytics_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_exports
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON analytics_exports TO dineflow_app;
