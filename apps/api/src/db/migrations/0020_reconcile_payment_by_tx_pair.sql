-- ============================================================================
-- Migration 0020: Public Return Transaction-Pair Lookup Helper
-- ============================================================================
-- Used by GET /v1/public/payments/reconcile-return when PhonePe redirects to a
-- fresh tab / mobile browser without sessionStorage. Requires BOTH order_id and
-- provider_order_id (256-bit UUID pair) and returns zero PII.

CREATE OR REPLACE FUNCTION resolve_payment_by_tx_pair(
  p_order_id uuid,
  p_provider_order_id text
)
RETURNS TABLE (
  payment_id uuid,
  org_id     uuid,
  status     text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id AS payment_id, p.org_id, p.status::text
  FROM payments p
  WHERE p.order_id = p_order_id
    AND p.provider_order_id = p_provider_order_id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_payment_by_tx_pair(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_payment_by_tx_pair(uuid, text) TO dineflow_app;

