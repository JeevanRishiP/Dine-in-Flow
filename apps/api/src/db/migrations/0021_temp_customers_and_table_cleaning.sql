-- ============================================================================
-- Migration 0021: Temporary Guest Customer Identities, Multi-Table Links &
--                 Captain Table Cleaning Lifecycle
-- ============================================================================

-- 1. Temporary guest customer identity (dissolved only once ALL linked tables are cleaned)
CREATE TABLE IF NOT EXISTS temp_customers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id       uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  active_table_id uuid        REFERENCES tables (id) ON DELETE SET NULL,
  status          text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISSOLVED')),
  dissolved_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS temp_customers_org_id_idx ON temp_customers (org_id);
CREATE INDEX IF NOT EXISTS temp_customers_active_idx ON temp_customers (org_id, status) WHERE status = 'ACTIVE';

ALTER TABLE temp_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE temp_customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON temp_customers
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON temp_customers TO dineflow_app;

-- 2. Junction linking temporary customers to every ordered / plate-target table
CREATE TABLE IF NOT EXISTS temp_customer_tables (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id        uuid        NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  temp_customer_id uuid        NOT NULL REFERENCES temp_customers (id) ON DELETE CASCADE,
  table_id         uuid        NOT NULL REFERENCES tables (id) ON DELETE CASCADE,
  status           text        NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLEANED')),
  cleaned_at       timestamptz,
  cleaned_by       uuid        REFERENCES staff_users (id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, temp_customer_id, table_id)
);

CREATE INDEX IF NOT EXISTS temp_customer_tables_org_id_idx  ON temp_customer_tables (org_id);
CREATE INDEX IF NOT EXISTS temp_customer_tables_tc_idx      ON temp_customer_tables (temp_customer_id, status);
CREATE INDEX IF NOT EXISTS temp_customer_tables_table_idx   ON temp_customer_tables (table_id, status) WHERE status = 'ACTIVE';

ALTER TABLE temp_customer_tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE temp_customer_tables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON temp_customer_tables
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON temp_customer_tables TO dineflow_app;

-- 3. Expand table_sessions & orders with temp_customer_id; isolate concurrent sessions cleanly
ALTER TABLE table_sessions
  ADD COLUMN IF NOT EXISTS temp_customer_id uuid REFERENCES temp_customers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS table_sessions_temp_customer_idx
  ON table_sessions (temp_customer_id) WHERE temp_customer_id IS NOT NULL;

DROP INDEX IF EXISTS table_sessions_one_open_uidx;
CREATE INDEX IF NOT EXISTS table_sessions_open_lookup_idx
  ON table_sessions (table_id) WHERE status = 'OPEN';

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS temp_customer_id uuid REFERENCES temp_customers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS orders_temp_customer_idx
  ON orders (org_id, temp_customer_id) WHERE temp_customer_id IS NOT NULL;

-- 4. Scoped helper for GET /v1/public/sessions/me cookie verification under forced RLS
CREATE OR REPLACE FUNCTION resolve_active_temp_customer(p_temp_customer_id uuid)
RETURNS TABLE (
  id              uuid,
  org_id          uuid,
  outlet_id       uuid,
  active_table_id uuid,
  table_number    text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT tc.id, tc.org_id, tc.outlet_id, tc.active_table_id, t.table_number
  FROM temp_customers tc
  LEFT JOIN tables t ON t.id = tc.active_table_id
  WHERE tc.id = p_temp_customer_id
    AND tc.status = 'ACTIVE'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_active_temp_customer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_active_temp_customer(uuid) TO dineflow_app;

