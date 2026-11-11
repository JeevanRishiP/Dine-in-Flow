-- ============================================================
-- 0011 — Messaging, Consents & Delivery Tracking
-- Tables:
--   1. consents (DPDP compliance, opt-in/opt-out for transactional, loyalty, marketing)
--   2. org_messaging_settings (per-org budgets, quiet hours, channel preferences)
--   3. message_log (audit log of every outgoing message, cost, and delivery state)
--
-- Invariants (AGENTS §2, ARCH §20):
--   - All tables enforce org_id + forced RLS (Rule 3).
--   - Consents is append-only: INSERT, SELECT only (Rule 6).
--   - Marketing messages require explicit active opt-in in consents table.
--   - Cost tracked in integer paise (cost_minor).
-- ============================================================

-- ============================================================
-- 1. Consents Table (DPDP / GDPR Compliance)
-- ============================================================
CREATE TABLE IF NOT EXISTS consents (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers (id) ON DELETE SET NULL,
  phone           text,
  purpose         text,
  granted         boolean,
  notice_version  text        NOT NULL DEFAULT 'v1.0',
  source          text        NOT NULL DEFAULT 'WEB_CHECKOUT',
  ip_hash         text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Safely add columns if consents was created by earlier migration
ALTER TABLE consents ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS granted boolean;
ALTER TABLE consents ADD COLUMN IF NOT EXISTS notice_version text NOT NULL DEFAULT 'v1.0';
ALTER TABLE consents ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'WEB_CHECKOUT';
ALTER TABLE consents ALTER COLUMN customer_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS consents_org_phone_idx ON consents (org_id, phone, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS consents_customer_idx ON consents (org_id, customer_id);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON consents;
CREATE POLICY tenant_isolation ON consents
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- Append-only: SELECT, INSERT only (AGENTS §2 rule 6)
GRANT SELECT, INSERT ON consents TO dineflow_app;

-- ============================================================
-- 2. Org Messaging Settings & Budgets
-- ============================================================
CREATE TABLE IF NOT EXISTS org_messaging_settings (
  id                          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  monthly_budget_paise        bigint      NOT NULL DEFAULT 50000 CHECK (monthly_budget_paise >= 0), -- ₹500 default
  daily_budget_paise          bigint      NOT NULL DEFAULT 10000 CHECK (daily_budget_paise >= 0),  -- ₹100 default
  is_marketing_enabled        boolean     NOT NULL DEFAULT true,
  quiet_hours_start_utc       smallint    NOT NULL DEFAULT 15, -- 15:30 UTC = 21:00 IST (9 PM)
  quiet_hours_end_utc         smallint    NOT NULL DEFAULT 3,  -- 03:30 UTC = 09:00 IST (9 AM)
  sms_fallback_enabled        boolean     NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_org_messaging_settings UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS org_messaging_settings_org_idx ON org_messaging_settings (org_id);

ALTER TABLE org_messaging_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_messaging_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_messaging_settings
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON org_messaging_settings TO dineflow_app;

-- ============================================================
-- 3. Message Log (Audit trail, Delivery Status, Cost Tracking)
-- ============================================================
CREATE TABLE IF NOT EXISTS message_log (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id     uuid        REFERENCES customers (id) ON DELETE SET NULL,
  phone           text        NOT NULL,
  channel         text        NOT NULL CHECK (channel IN ('WHATSAPP', 'SMS')),
  template        text        NOT NULL,
  category        text        NOT NULL CHECK (category IN ('AUTHENTICATION', 'UTILITY', 'MARKETING')),
  provider_msg_id text,
  provider        text        NOT NULL DEFAULT 'EVOLUTION',
  status          text        NOT NULL DEFAULT 'QUEUED'
                    CHECK (status IN ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED')),
  failure_reason  text,
  cost_minor      bigint      NOT NULL DEFAULT 0 CHECK (cost_minor >= 0), -- In integer paise
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_message_idempotency UNIQUE (org_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS message_log_org_created_idx ON message_log (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS message_log_phone_idx ON message_log (org_id, phone, created_at DESC);
CREATE INDEX IF NOT EXISTS message_log_provider_msg_idx ON message_log (org_id, provider_msg_id);

ALTER TABLE message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON message_log
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON message_log TO dineflow_app;
