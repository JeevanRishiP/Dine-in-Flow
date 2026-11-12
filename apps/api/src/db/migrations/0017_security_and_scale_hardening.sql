-- ============================================================
-- 0017 — Security, Scoped System Lookups & Scale Indexes (Additive Only)
--
-- Purpose:
--   1. Scoped SECURITY DEFINER helpers for pre-tenant / cross-tenant
--      system entrypoints when running under restricted `dineflow_app`
--      role with FORCE ROW LEVEL SECURITY enabled (AGENTS §2 rule 3).
--   2. Vector HNSW index on menu_items.embedding for fast semantic retrieval.
--   3. Additive multi-tenant WhatsApp Cloud API & PG split-settlement columns.
-- ============================================================

-- 1. Pre-tenant QR table lookup (only called after HMAC signature check)
CREATE OR REPLACE FUNCTION resolve_table_for_qr(p_table_id uuid)
RETURNS TABLE (
  id                uuid,
  org_id            uuid,
  outlet_id         uuid,
  qr_token_version  int,
  is_active         boolean,
  table_number      text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id, t.org_id, t.outlet_id, t.qr_token_version, t.is_active, t.table_number
  FROM tables t
  WHERE t.id = p_table_id
  LIMIT 1;
$$;

-- 2. Active outlet → org resolver (prevents passing outletId as orgId)
CREATE OR REPLACE FUNCTION resolve_outlet_org(p_outlet_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.org_id
  FROM outlets o
  WHERE o.id = p_outlet_id AND o.is_active = true
  LIMIT 1;
$$;

-- 3. Payment lookup for signature-verified gateway webhooks
CREATE OR REPLACE FUNCTION resolve_payment_by_provider_order(
  p_provider text,
  p_provider_order_id text
)
RETURNS TABLE (
  id            uuid,
  org_id        uuid,
  order_id      uuid,
  amount_paise  bigint,
  status        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.org_id, p.order_id, p.amount_paise, p.status::text
  FROM payments p
  WHERE p.provider = p_provider
    AND p.provider_order_id = p_provider_order_id
  LIMIT 1;
$$;

-- 4. Bounded reconciliation scan for pending online payments (>5 min old)
CREATE OR REPLACE FUNCTION list_pending_payments_for_reconcile(p_limit int DEFAULT 50)
RETURNS TABLE (
  id                uuid,
  org_id            uuid,
  provider          text,
  provider_order_id text,
  order_id          uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.org_id, p.provider, p.provider_order_id, p.order_id
  FROM payments p
  WHERE p.status IN ('CREATED', 'PENDING')
    AND p.created_at < now() - interval '5 minutes'
    AND p.provider NOT IN ('staff', 'cash', 'direct_upi', 'counter_request')
    AND p.provider_order_id IS NOT NULL
  ORDER BY p.created_at ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 200);
$$;

-- 5. Atomic batched outbox claim (FOR UPDATE SKIP LOCKED, avoids N+1 updates)
CREATE OR REPLACE FUNCTION fetch_and_claim_outbox_events(p_batch_size int DEFAULT 50)
RETURNS TABLE (
  id           uuid,
  org_id       uuid,
  aggregate    text,
  aggregate_id uuid,
  event_type   text,
  payload      jsonb,
  created_at   timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH claimed AS (
    SELECT oe.id
    FROM outbox_events oe
    WHERE oe.delivered_at IS NULL
    ORDER BY oe.created_at ASC
    LIMIT LEAST(GREATEST(p_batch_size, 1), 200)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE outbox_events o
  SET delivered_at = now(),
      delivered = true
  FROM claimed
  WHERE o.id = claimed.id
  RETURNING o.id, o.org_id, o.aggregate, o.aggregate_id, o.event_type, o.payload, o.created_at;
$$;

-- 6. Multi-tenant agency / SaaS split-settlement & official WhatsApp Cloud API columns (additive only)
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS pg_linked_account_id text;

ALTER TABLE org_messaging_settings
  ADD COLUMN IF NOT EXISTS whatsapp_phone_number_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_waba_id text,
  ADD COLUMN IF NOT EXISTS whatsapp_access_token_enc text;

CREATE INDEX IF NOT EXISTS org_messaging_settings_wa_phone_idx
  ON org_messaging_settings (whatsapp_phone_number_id)
  WHERE whatsapp_phone_number_id IS NOT NULL;

CREATE OR REPLACE FUNCTION resolve_org_by_whatsapp_phone_id(p_phone_number_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.org_id
  FROM org_messaging_settings s
  WHERE s.whatsapp_phone_number_id = p_phone_number_id
  LIMIT 1;
$$;

-- 7. Vector HNSW index for pgvector cosine similarity on menu_items.embedding
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'menu_items' AND column_name = 'embedding'
  ) THEN
    CREATE INDEX IF NOT EXISTS menu_items_embedding_hnsw_idx
      ON menu_items USING hnsw (embedding vector_cosine_ops);
  END IF;
END $$;

REVOKE ALL ON FUNCTION resolve_table_for_qr(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_outlet_org(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_payment_by_provider_order(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION list_pending_payments_for_reconcile(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION fetch_and_claim_outbox_events(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_org_by_whatsapp_phone_id(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION resolve_table_for_qr(uuid) TO dineflow_app;
GRANT EXECUTE ON FUNCTION resolve_outlet_org(uuid) TO dineflow_app;
GRANT EXECUTE ON FUNCTION resolve_payment_by_provider_order(text, text) TO dineflow_app;
GRANT EXECUTE ON FUNCTION list_pending_payments_for_reconcile(int) TO dineflow_app;
GRANT EXECUTE ON FUNCTION fetch_and_claim_outbox_events(int) TO dineflow_app;
GRANT EXECUTE ON FUNCTION resolve_org_by_whatsapp_phone_id(text) TO dineflow_app;

-- 8. Scoped inbound WhatsApp opt-out & delivery status updaters under dineflow_app RLS
CREATE OR REPLACE FUNCTION revoke_marketing_consent_by_phone(
  p_phone text,
  p_org_id uuid DEFAULT NULL
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int := 0;
BEGIN
  IF p_org_id IS NOT NULL THEN
    INSERT INTO consents (org_id, phone, purpose, granted, notice_version, source)
    VALUES (p_org_id, p_phone, 'MARKETING_WHATSAPP', false, 'v1.0', 'WA_INBOUND');
    v_count := 1;
  ELSE
    INSERT INTO consents (org_id, phone, purpose, granted, notice_version, source)
    SELECT DISTINCT c.org_id, p_phone, 'MARKETING_WHATSAPP', false, 'v1.0', 'WA_INBOUND'
    FROM consents c
    WHERE c.phone = p_phone;
    GET DIAGNOSTICS v_count = ROW_COUNT;
  END IF;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION update_message_status_by_provider_id(
  p_provider_msg_id text,
  p_status text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_updated int := 0;
BEGIN
  UPDATE message_log
  SET status = p_status, updated_at = now()
  WHERE provider_msg_id = p_provider_msg_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION revoke_marketing_consent_by_phone(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION update_message_status_by_provider_id(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION revoke_marketing_consent_by_phone(text, uuid) TO dineflow_app;
GRANT EXECUTE ON FUNCTION update_message_status_by_provider_id(text, text) TO dineflow_app;
