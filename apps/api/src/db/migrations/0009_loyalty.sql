-- ============================================================
-- 0009 — Loyalty, Coupons, Ledger, and Referrals
-- Tables:
--   1. coupons
--   2. coupon_redemptions
--   3. loyalty_ledger (append-only)
--   4. referrals
--   5. org_loyalty_settings
--
-- Invariants (AGENTS §2):
--   - All tables enforce org_id + forced RLS (Rule 3).
--   - Money/credit stored in integer paise (bigint), never float (Rule 1).
--   - loyalty_ledger is append-only: app role has SELECT, INSERT only (Rule 6).
--   - Unique constraints prevent double redemption and double credit.
--   - Reference: ARCH §18, §7, §10, PROMPTS Phase 7
-- ============================================================

-- ============================================================
-- 1. Coupons
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  code                      citext      NOT NULL,
  type                      text        NOT NULL CHECK (type IN ('PERCENT', 'FLAT')),
  value                     int         NOT NULL CHECK (value > 0), -- basis points for PERCENT (e.g. 2000 = 20%) or paise for FLAT
  max_discount_paise        int         CHECK (max_discount_paise > 0),
  min_order_paise           int         NOT NULL DEFAULT 0 CHECK (min_order_paise >= 0),
  audience                  text        NOT NULL DEFAULT 'ALL' CHECK (audience IN ('ALL', 'SIGNED_IN', 'NEW', 'RETURNING')),
  valid_from                timestamptz NOT NULL,
  valid_to                  timestamptz NOT NULL,
  usage_limit_total         int         CHECK (usage_limit_total > 0),
  usage_limit_per_customer  int         NOT NULL DEFAULT 1 CHECK (usage_limit_per_customer > 0),
  stackable                 boolean     NOT NULL DEFAULT false,
  outlets                   uuid[]      NOT NULL DEFAULT '{}', -- empty means all outlets in org
  is_active                 boolean     NOT NULL DEFAULT true,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT uq_coupons_org_code UNIQUE (org_id, code),
  CONSTRAINT chk_coupon_valid_dates CHECK (valid_from <= valid_to)
);

CREATE INDEX IF NOT EXISTS coupons_org_id_idx ON coupons (org_id);
CREATE INDEX IF NOT EXISTS coupons_org_code_idx ON coupons (org_id, code);
CREATE INDEX IF NOT EXISTS coupons_validity_idx ON coupons (org_id, is_active, valid_from, valid_to);

ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON coupons
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON coupons TO dineflow_app;

-- ============================================================
-- 2. Coupon Redemptions (Atomic, 1 per order per coupon)
-- ============================================================
CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  coupon_id      uuid        NOT NULL REFERENCES coupons (id) ON DELETE RESTRICT,
  customer_id    uuid        REFERENCES customers (id) ON DELETE SET NULL,
  order_id       uuid        NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  discount_paise int         NOT NULL CHECK (discount_paise > 0),
  created_at     timestamptz NOT NULL DEFAULT now(),

  -- Atomic uniqueness: a coupon can only be redeemed once per order
  CONSTRAINT uq_coupon_redemption_order UNIQUE (coupon_id, order_id)
);

CREATE INDEX IF NOT EXISTS coupon_redemptions_org_idx ON coupon_redemptions (org_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_coupon_idx ON coupon_redemptions (org_id, coupon_id);
CREATE INDEX IF NOT EXISTS coupon_redemptions_customer_idx ON coupon_redemptions (org_id, customer_id);

ALTER TABLE coupon_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_redemptions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON coupon_redemptions
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT ON coupon_redemptions TO dineflow_app;

-- ============================================================
-- 3. Loyalty Ledger (Append-only store credit & points)
-- ============================================================
CREATE TABLE IF NOT EXISTS loyalty_ledger (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id  uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  entry_type   text        NOT NULL CHECK (entry_type IN ('EARN', 'REDEEM', 'EXPIRE', 'ADJUST', 'REVERSAL')),
  amount_paise bigint      NOT NULL, -- signed: positive = credit, negative = debit
  reason       text        NOT NULL,
  ref_type     text        NOT NULL, -- 'ORDER' | 'REFERRAL' | 'MANUAL' | 'REFUND'
  ref_id       uuid        NOT NULL,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),

  -- Idempotency invariant: prevents double credit or double debit for same event
  CONSTRAINT uq_loyalty_ledger_ref UNIQUE (org_id, ref_type, ref_id, entry_type)
);

CREATE INDEX IF NOT EXISTS loyalty_ledger_org_customer_idx ON loyalty_ledger (org_id, customer_id);
CREATE INDEX IF NOT EXISTS loyalty_ledger_customer_balance_idx ON loyalty_ledger (customer_id, created_at);

ALTER TABLE loyalty_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON loyalty_ledger
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- Append-only: SELECT, INSERT only (no UPDATE or DELETE granted to app role, AGENTS §2 rule 6)
GRANT SELECT, INSERT ON loyalty_ledger TO dineflow_app;

-- ============================================================
-- 4. Referrals
-- ============================================================
CREATE TABLE IF NOT EXISTS referrals (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  referrer_customer_id uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  referee_customer_id  uuid        NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  status               text        NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING', 'QUALIFIED', 'REWARDED', 'REJECTED')),
  qualified_order_id   uuid        REFERENCES orders (id) ON DELETE SET NULL,
  fraud_signals        jsonb       NOT NULL DEFAULT '{}',
  created_at           timestamptz NOT NULL DEFAULT now(),
  rewarded_at          timestamptz,

  -- A customer can only be referred once per org
  CONSTRAINT uq_referrals_org_referee UNIQUE (org_id, referee_customer_id),
  -- Self-referral blocked at database level
  CONSTRAINT chk_no_self_referral CHECK (referrer_customer_id <> referee_customer_id)
);

CREATE INDEX IF NOT EXISTS referrals_org_referrer_idx ON referrals (org_id, referrer_customer_id);
CREATE INDEX IF NOT EXISTS referrals_org_status_idx ON referrals (org_id, status);

ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON referrals
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON referrals TO dineflow_app;

-- ============================================================
-- 5. Org Loyalty Settings
-- ============================================================
CREATE TABLE IF NOT EXISTS org_loyalty_settings (
  org_id                        uuid        PRIMARY KEY REFERENCES organizations (id) ON DELETE CASCADE,
  max_wallet_redemption_percent int         NOT NULL DEFAULT 20 CHECK (max_wallet_redemption_percent BETWEEN 0 AND 100),
  referrer_reward_percent       int         NOT NULL DEFAULT 10 CHECK (referrer_reward_percent BETWEEN 0 AND 100),
  referrer_max_reward_paise     int         NOT NULL DEFAULT 50000 CHECK (referrer_max_reward_paise >= 0), -- ₹500 default
  referee_discount_paise        int         NOT NULL DEFAULT 10000 CHECK (referee_discount_paise >= 0),   -- ₹100 default
  points_earn_percent           int         NOT NULL DEFAULT 5 CHECK (points_earn_percent BETWEEN 0 AND 50),
  is_loyalty_enabled            boolean     NOT NULL DEFAULT true,
  is_referral_enabled           boolean     NOT NULL DEFAULT true,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE org_loyalty_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_loyalty_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON org_loyalty_settings
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON org_loyalty_settings TO dineflow_app;
