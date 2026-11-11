-- ============================================================
-- 0013 — DPDP Act & Privacy Compliance (ARCH §23)
-- Purpose:
--   1. Anonymization tracking on customers table
--   2. Audit log of Data Subject Access Requests (DSAR) and Right to Erasure
--
-- Invariants (AGENTS §2, ARCH §23):
--   - Tenant isolation via forced RLS (Rule 3).
--   - Invoice & tax records are preserved per Indian GST law while customer PII is scrubbed.
-- ============================================================

-- 1. Add anonymized_at timestamp to customers table
ALTER TABLE customers ADD COLUMN IF NOT EXISTS anonymized_at timestamptz;

-- 2. Privacy Requests (DSAR export and Erasure audit log)
CREATE TABLE IF NOT EXISTS privacy_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id   uuid        REFERENCES customers (id) ON DELETE SET NULL,
  request_type  text        NOT NULL CHECK (request_type IN ('EXPORT', 'ERASURE')),
  status        text        NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'REJECTED')),
  requested_by  text        NOT NULL CHECK (requested_by IN ('CUSTOMER', 'STAFF')),
  details       jsonb,
  completed_at  timestamptz DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS privacy_requests_org_customer_idx ON privacy_requests (org_id, customer_id);
CREATE INDEX IF NOT EXISTS privacy_requests_type_idx ON privacy_requests (org_id, request_type, created_at DESC);

ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON privacy_requests
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON privacy_requests TO dineflow_app;

-- 3. Grants for automated retention cleanup (ARCH §21, §23)
GRANT DELETE ON customer_otp_codes TO dineflow_app;
GRANT DELETE ON ai_chat_transcripts TO dineflow_app;

