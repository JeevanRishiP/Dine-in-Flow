-- ============================================================================
-- Migration 0027: Patch resolve_payment_by_provider_order Security Definer
--
-- Purpose:
--   Guard cross-tenant payment resolution so an attacker cannot enumerate
--   provider_order_ids to discover tenant payments or order statuses across
--   different restaurants.
--
--   Lockdown Rules:
--   1. Requires a valid p_inbox_id referencing a verified webhook_inbox record
--      (signature_valid = true AND provider = p_provider).
--   2. Rejects unanchored lookups (p_inbox_id IS NULL) by returning zero rows.
--   3. Drops the old 2-parameter signature to prevent unauthenticated enumeration.
-- ============================================================================

DROP FUNCTION IF EXISTS resolve_payment_by_provider_order(text, text);
DROP FUNCTION IF EXISTS resolve_payment_by_provider_order(text, text, uuid);

CREATE OR REPLACE FUNCTION resolve_payment_by_provider_order(
  p_provider text,
  p_provider_order_id text,
  p_inbox_id uuid
)
RETURNS TABLE (
  id            uuid,
  org_id        uuid,
  order_id      uuid,
  amount_paise  bigint,
  status        text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Strict security guard: Must have a signature-verified entry in webhook_inbox
  IF p_inbox_id IS NULL THEN
    RETURN; -- Refuse unanchored lookups to prevent enumeration attacks
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM webhook_inbox wi
    WHERE wi.id = p_inbox_id
      AND wi.provider = p_provider
      AND wi.signature_valid = true
  ) THEN
    RETURN; -- Refuse cross-tenant lookup for unverified or forged webhooks
  END IF;

  RETURN QUERY
  SELECT p.id, p.org_id, p.order_id, p.amount_paise, p.status::text
  FROM payments p
  WHERE p.provider = p_provider
    AND p.provider_order_id = p_provider_order_id
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION resolve_payment_by_provider_order(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_payment_by_provider_order(text, text, uuid) TO dineflow_app;
