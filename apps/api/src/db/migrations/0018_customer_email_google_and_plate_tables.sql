-- ============================================================================
-- Migration 0018: 1:1 Customer Email/Google Constraints, Public Table Directory
--                 Helper, & Per-Plate Target Table Support
-- ============================================================================

-- 1. Enforce 1:1 email <-> mobile linkage per organization on customers
--    (Phone remains primary customer identifier; an email belongs to at most one mobile per org)
CREATE UNIQUE INDEX IF NOT EXISTS customers_org_email_uidx
  ON customers (org_id, email)
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_org_google_sub_uidx
  ON customers (org_id, google_sub)
  WHERE google_sub IS NOT NULL;

-- 2. Allow each plate/item in an order to specify its own destination table
ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS target_table_id uuid REFERENCES tables (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS order_items_target_table_id_idx
  ON order_items (org_id, target_table_id)
  WHERE target_table_id IS NOT NULL;

-- 3. Scoped SECURITY DEFINER helper to list active table numbers for an active outlet
--    Returns only public metadata (never exposes active sessions or customer PII)
CREATE OR REPLACE FUNCTION list_public_outlet_tables(p_outlet_id uuid)
RETURNS TABLE (
  id           uuid,
  org_id       uuid,
  outlet_id    uuid,
  table_number text,
  section      text,
  capacity     int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.org_id, t.outlet_id, t.table_number, t.section, t.capacity
  FROM tables t
  INNER JOIN outlets o ON o.id = t.outlet_id AND o.org_id = t.org_id
  WHERE t.outlet_id = p_outlet_id
    AND t.is_active = true
    AND o.is_active = true
  ORDER BY t.table_number;
$$;

REVOKE ALL ON FUNCTION list_public_outlet_tables(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_public_outlet_tables(uuid) TO dineflow_app;

