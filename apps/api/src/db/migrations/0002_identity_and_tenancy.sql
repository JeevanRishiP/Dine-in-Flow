-- Migration: 0002_identity_and_tenancy.sql
-- Purpose: Create all identity, tenancy, and RBAC tables.
-- Every table with org_id MUST have ENABLE + FORCE ROW LEVEL SECURITY.
-- Append-only tables (audit_logs, consents): only INSERT + SELECT granted to app role.
-- Reference: ARCH §6, §7, §12

-- ============================================================
-- Organizations (tenants)
-- ============================================================
CREATE TABLE IF NOT EXISTS organizations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text        NOT NULL,
  slug         citext      NOT NULL UNIQUE,             -- URL-safe, case-insensitive
  plan         text        NOT NULL DEFAULT 'free',     -- free | starter | pro | enterprise
  currency     text        NOT NULL DEFAULT 'INR',      -- ISO 4217
  country_code text        NOT NULL DEFAULT 'IN',       -- ISO 3166-1 alpha-2
  timezone     text        NOT NULL DEFAULT 'Asia/Kolkata',
  settings     jsonb       NOT NULL DEFAULT '{}',
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Organizations are NOT tenant-scoped (no org_id self-reference), but access is controlled at API level
CREATE INDEX IF NOT EXISTS organizations_slug_idx ON organizations (slug);
CREATE INDEX IF NOT EXISTS organizations_is_active_idx ON organizations (is_active);

-- ============================================================
-- Outlets (physical locations within an org)
-- ============================================================
CREATE TABLE IF NOT EXISTS outlets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  address      text,
  timezone     text        NOT NULL DEFAULT 'Asia/Kolkata',
  settings     jsonb       NOT NULL DEFAULT '{}',
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE outlets ENABLE ROW LEVEL SECURITY;
ALTER TABLE outlets FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON outlets
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON outlets TO dineflow_app;
CREATE INDEX IF NOT EXISTS outlets_org_id_idx ON outlets (org_id);

-- ============================================================
-- Staff users
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_users (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  email            citext      NOT NULL,
  password_hash    text        NOT NULL,             -- argon2id
  display_name     text        NOT NULL,
  phone_e164       text,
  -- MFA
  totp_secret_enc  text,                             -- AES-256-GCM encrypted; NULL = not enrolled
  totp_enrolled_at timestamptz,
  recovery_codes   jsonb       NOT NULL DEFAULT '[]',-- array of hashed codes
  -- Status
  is_active        boolean     NOT NULL DEFAULT true,
  email_verified   boolean     NOT NULL DEFAULT false,
  -- Password reset
  pw_reset_token   text,                             -- HMAC hash of token, single-use
  pw_reset_exp     timestamptz,
  -- Timestamps
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, email)
);

ALTER TABLE staff_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_users FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_users
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON staff_users TO dineflow_app;
CREATE INDEX IF NOT EXISTS staff_users_org_id_idx ON staff_users (org_id);
CREATE INDEX IF NOT EXISTS staff_users_email_idx ON staff_users (org_id, email);

-- ============================================================
-- Staff memberships (role per staff per org, optionally scoped to outlet)
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_memberships (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  outlet_id  uuid        REFERENCES outlets (id) ON DELETE SET NULL, -- NULL = org-wide
  role       text        NOT NULL, -- OWNER | MANAGER | CASHIER | KITCHEN | WAITER
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id, outlet_id)
);

ALTER TABLE staff_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_memberships FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_memberships
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON staff_memberships TO dineflow_app;
CREATE INDEX IF NOT EXISTS staff_memberships_org_id_idx ON staff_memberships (org_id);
CREATE INDEX IF NOT EXISTS staff_memberships_user_id_idx ON staff_memberships (user_id);

-- ============================================================
-- Refresh tokens for staff
-- ============================================================
CREATE TABLE IF NOT EXISTS staff_refresh_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES staff_users (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,   -- SHA-256 of the raw token
  family_id    uuid        NOT NULL,          -- same family = same login session
  is_revoked   boolean     NOT NULL DEFAULT false,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE staff_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON staff_refresh_tokens
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON staff_refresh_tokens TO dineflow_app;
CREATE INDEX IF NOT EXISTS staff_refresh_tokens_org_id_idx ON staff_refresh_tokens (org_id);
CREATE INDEX IF NOT EXISTS staff_refresh_tokens_family_id_idx ON staff_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS staff_refresh_tokens_user_id_idx ON staff_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS staff_refresh_tokens_token_hash_idx ON staff_refresh_tokens (token_hash);

-- ============================================================
-- Customers (per org — a phone can be a customer of multiple orgs)
-- ============================================================
CREATE TABLE IF NOT EXISTS customers (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  phone_e164        text        NOT NULL,              -- E.164, verified
  phone_verified_at timestamptz NOT NULL DEFAULT now(),
  display_name      text,
  email             citext,
  email_verified    boolean     NOT NULL DEFAULT false,
  google_sub        text,                             -- Google OAuth sub (Phase future)
  is_active         boolean     NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, phone_e164)
);

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customers
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON customers TO dineflow_app;
CREATE INDEX IF NOT EXISTS customers_org_id_idx ON customers (org_id);
CREATE INDEX IF NOT EXISTS customers_phone_idx ON customers (org_id, phone_e164);

-- ============================================================
-- Customer OTP codes (transient — cleaned up by TTL/cron)
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_otp_codes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  phone_e164   text        NOT NULL,
  code_hash    text        NOT NULL,   -- HMAC-SHA256 of the OTP code
  attempts     int         NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  sent_at      timestamptz NOT NULL DEFAULT now(),
  verified_at  timestamptz,
  -- Rate limiting support
  ip_hash      text,                   -- hashed client IP for rate limiting
  UNIQUE (org_id, phone_e164, sent_at) -- one per phone per send call
);

ALTER TABLE customer_otp_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_otp_codes FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_otp_codes
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON customer_otp_codes TO dineflow_app;
CREATE INDEX IF NOT EXISTS customer_otp_codes_org_id_phone_idx ON customer_otp_codes (org_id, phone_e164);
CREATE INDEX IF NOT EXISTS customer_otp_codes_expires_at_idx ON customer_otp_codes (expires_at);

-- ============================================================
-- Customer refresh tokens
-- ============================================================
CREATE TABLE IF NOT EXISTS customer_refresh_tokens (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id  uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  token_hash   text        NOT NULL UNIQUE,
  family_id    uuid        NOT NULL,
  is_revoked   boolean     NOT NULL DEFAULT false,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_refresh_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_refresh_tokens
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON customer_refresh_tokens TO dineflow_app;
CREATE INDEX IF NOT EXISTS customer_refresh_tokens_org_id_idx ON customer_refresh_tokens (org_id);
CREATE INDEX IF NOT EXISTS customer_refresh_tokens_family_id_idx ON customer_refresh_tokens (family_id);
CREATE INDEX IF NOT EXISTS customer_refresh_tokens_token_hash_idx ON customer_refresh_tokens (token_hash);

-- ============================================================
-- Audit logs (APPEND-ONLY — no UPDATE/DELETE to app role)
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_id    uuid,                             -- staff_user or customer id; NULL = system
  actor_type  text,                             -- 'staff' | 'customer' | 'system'
  action      text        NOT NULL,             -- e.g. 'staff.login', 'order.created'
  resource    text,                             -- e.g. 'order', 'menu_item'
  resource_id uuid,
  metadata    jsonb       NOT NULL DEFAULT '{}',-- redacted, no PII
  ip_hash     text,                             -- hashed IP
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_logs
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Append-only: INSERT + SELECT only (no UPDATE or DELETE)
GRANT SELECT, INSERT ON audit_logs TO dineflow_app;
CREATE INDEX IF NOT EXISTS audit_logs_org_id_idx ON audit_logs (org_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_id_idx ON audit_logs (org_id, actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (org_id, created_at);

-- ============================================================
-- Consents (APPEND-ONLY — immutable consent record)
-- ============================================================
CREATE TABLE IF NOT EXISTS consents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id   uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  consent_type  text        NOT NULL,  -- 'marketing_whatsapp' | 'marketing_sms' | 'marketing_email'
  consented     boolean     NOT NULL,
  ip_hash       text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consents
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

-- Append-only
GRANT SELECT, INSERT ON consents TO dineflow_app;
CREATE INDEX IF NOT EXISTS consents_org_id_customer_idx ON consents (org_id, customer_id);
CREATE INDEX IF NOT EXISTS consents_type_idx ON consents (org_id, consent_type, created_at);

-- ============================================================
-- Feature flags (per org overrides)
-- ============================================================
CREATE TABLE IF NOT EXISTS feature_flags (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  flag       text        NOT NULL,
  enabled    boolean     NOT NULL DEFAULT false,
  metadata   jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, flag)
);

ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE feature_flags FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON feature_flags
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON feature_flags TO dineflow_app;
CREATE INDEX IF NOT EXISTS feature_flags_org_id_idx ON feature_flags (org_id);
