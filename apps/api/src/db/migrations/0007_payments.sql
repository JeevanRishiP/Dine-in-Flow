-- ============================================================
-- 0007 — Payments, Webhook Inbox, Refunds, Invoices
-- All tables have org_id + forced RLS (AGENTS §2 rule 3).
-- Money stored as integer paise, currency char(3) (AGENTS §2 rule 1).
-- NEEDS_HUMAN_REVIEW: payment table, webhook_inbox, refunds, invoices
-- ============================================================

-- ── Payment method enum ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payment_method AS ENUM (
    'UPI',
    'UPI_INTENT',
    'CARD',
    'NETBANKING',
    'WALLET',
    'CASH',
    'DIRECT_UPI_STAFF',   -- staff-confirmed UPI (no webhook, audited)
    'PAY_AT_COUNTER'      -- cash / physical terminal
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Payment status enum ──────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM (
    'CREATED',
    'PENDING',
    'PAID',
    'FAILED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
    'MISMATCH'            -- webhook amount != order total; requires manual review
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Refund status enum ───────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE refund_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'SUCCEEDED',
    'FAILED'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- payments
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid         NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  order_id             uuid         NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  idempotency_key      uuid         NOT NULL,
  provider             text         NOT NULL,           -- 'phonepe' | 'razorpay' | 'cash' | 'direct_upi'
  provider_order_id    text,                            -- gateway's order/transaction ref
  provider_payment_id  text,                            -- gateway's final payment ref (after capture)
  method               payment_method NOT NULL,
  amount_paise         bigint       NOT NULL CHECK (amount_paise > 0),
  currency             char(3)      NOT NULL DEFAULT 'INR',
  status               payment_status NOT NULL DEFAULT 'CREATED',
  fee_paise            bigint,                          -- gateway fee (recorded from webhook)
  settled_at           timestamptz,
  raw_response         jsonb        NOT NULL DEFAULT '{}',  -- provider raw payload
  notes                text,
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

-- Idempotency: one payment attempt per key per org
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_idx
  ON payments (org_id, idempotency_key);

-- Quick lookup by gateway reference
CREATE INDEX IF NOT EXISTS payments_provider_order_idx
  ON payments (provider, provider_order_id) WHERE provider_order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payments_order_idx
  ON payments (order_id, org_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON payments
  USING  (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON payments TO dineflow_app;

-- ============================================================
-- webhook_inbox
-- Raw inbound webhooks; processed async and idempotently.
-- UNIQUE(provider, event_id) prevents duplicate processing (AGENTS §2 rule 9).
-- NEVER trust browser redirects for payment success.
-- ============================================================
CREATE TABLE IF NOT EXISTS webhook_inbox (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  provider         text         NOT NULL,   -- 'phonepe' | 'razorpay'
  event_id         text         NOT NULL,   -- gateway-assigned unique event ID
  signature_valid  boolean      NOT NULL DEFAULT false,
  raw_payload      jsonb        NOT NULL DEFAULT '{}',
  received_at      timestamptz  NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  status           text         NOT NULL DEFAULT 'RECEIVED'  -- RECEIVED|PROCESSED|SKIPPED|ERROR
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_inbox_provider_event_idx
  ON webhook_inbox (provider, event_id);

-- No RLS on webhook_inbox — it receives data before org context is known.
-- Access is controlled via app role grants only.
GRANT SELECT, INSERT, UPDATE ON webhook_inbox TO dineflow_app;

-- ============================================================
-- refunds
-- Partial or full; each refund has its own idempotency_key.
-- Append-only for the refund record; status updated via UPDATE.
-- NEEDS_HUMAN_REVIEW: refund amounts, partial refund logic
-- ============================================================
CREATE TABLE IF NOT EXISTS refunds (
  id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid         NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  payment_id           uuid         NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  idempotency_key      uuid         NOT NULL,
  amount_paise         bigint       NOT NULL CHECK (amount_paise > 0),
  currency             char(3)      NOT NULL DEFAULT 'INR',
  reason               text         NOT NULL,
  status               refund_status NOT NULL DEFAULT 'PENDING',
  provider_refund_id   text,
  initiated_by_type    text         NOT NULL DEFAULT 'STAFF',  -- STAFF | SYSTEM
  initiated_by_id      uuid,                                   -- staff_user.id
  raw_response         jsonb        NOT NULL DEFAULT '{}',
  created_at           timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS refunds_idempotency_key_idx
  ON refunds (org_id, idempotency_key);
CREATE INDEX IF NOT EXISTS refunds_payment_idx
  ON refunds (payment_id, org_id);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON refunds
  USING  (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON refunds TO dineflow_app;

-- ============================================================
-- invoices
-- Gapless numbering per outlet per fiscal year (ARCH §7).
-- Uses a locked counter row pattern: SELECT ... FOR UPDATE on
-- invoice_counters to prevent gaps and race conditions.
-- NEEDS_HUMAN_REVIEW: GST invoice number format, fiscal year boundary
-- ============================================================
CREATE TABLE IF NOT EXISTS invoice_counters (
  outlet_id    uuid     NOT NULL REFERENCES outlets (id) ON DELETE RESTRICT,
  fiscal_year  smallint NOT NULL,   -- e.g. 2025 for FY 2025-26
  last_no      int      NOT NULL DEFAULT 0,
  PRIMARY KEY (outlet_id, fiscal_year)
);

GRANT SELECT, UPDATE ON invoice_counters TO dineflow_app;

CREATE TABLE IF NOT EXISTS invoices (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid         NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT,
  outlet_id     uuid         NOT NULL REFERENCES outlets (id) ON DELETE RESTRICT,
  order_id      uuid         NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  payment_id    uuid         REFERENCES payments (id),
  invoice_no    int          NOT NULL,
  fiscal_year   smallint     NOT NULL,
  -- Human-readable: e.g. INV/2025-26/000001
  invoice_ref   text         GENERATED ALWAYS AS (
    'INV/' || fiscal_year || '-' || (fiscal_year + 1) || '/' || lpad(invoice_no::text, 6, '0')
  ) STORED,
  issued_at     timestamptz  NOT NULL DEFAULT now(),
  buyer_name    text,
  buyer_gstin   text,
  seller_gstin  text,
  tax_breakup   jsonb        NOT NULL DEFAULT '{}',
  subtotal_paise bigint      NOT NULL,
  tax_paise     bigint       NOT NULL,
  discount_paise bigint      NOT NULL DEFAULT 0,
  total_paise   bigint       NOT NULL,
  currency      char(3)      NOT NULL DEFAULT 'INR',
  created_at    timestamptz  NOT NULL DEFAULT now()
);

-- Gapless: unique per outlet + fiscal year + invoice_no
CREATE UNIQUE INDEX IF NOT EXISTS invoices_outlet_fy_no_idx
  ON invoices (outlet_id, fiscal_year, invoice_no);
CREATE UNIQUE INDEX IF NOT EXISTS invoices_order_idx
  ON invoices (order_id);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invoices
  USING  (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- Invoices are financial records — no UPDATE/DELETE to the app role (ARCH §6)
GRANT SELECT, INSERT ON invoices TO dineflow_app;
GRANT SELECT, INSERT ON invoice_counters TO dineflow_app;
