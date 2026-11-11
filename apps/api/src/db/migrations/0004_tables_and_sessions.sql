-- Migration: 0004_tables_and_sessions.sql
-- Purpose: Physical restaurant tables, QR token tracking, and dine-in sessions.
-- Reference: ARCH §5 (Tables & QR), §6 (DB rules)

-- ============================================================
-- Restaurant Tables
-- ============================================================
CREATE TABLE IF NOT EXISTS tables (
  id               uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id        uuid    NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  table_number     text    NOT NULL,
  qr_token_version int     NOT NULL DEFAULT 1,   -- bump to invalidate all open QR sessions
  capacity         int     NOT NULL DEFAULT 4,
  section          text,
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tables_org_id_idx    ON tables (org_id);
CREATE INDEX IF NOT EXISTS tables_outlet_id_idx ON tables (outlet_id);
CREATE UNIQUE INDEX IF NOT EXISTS tables_outlet_number_uidx
  ON tables (outlet_id, table_number) WHERE is_active;

ALTER TABLE tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE tables FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tables
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON tables TO dineflow_app;

-- ============================================================
-- Table Sessions (a dine-in session per scan)
-- One active session per table at a time (enforced by partial unique index)
-- ============================================================
CREATE TABLE IF NOT EXISTS table_sessions (
  id              uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id       uuid    NOT NULL REFERENCES outlets (id) ON DELETE CASCADE,
  table_id        uuid    NOT NULL REFERENCES tables (id) ON DELETE CASCADE,
  customer_id     uuid    REFERENCES customers (id) ON DELETE SET NULL,
  qr_token_version int    NOT NULL,   -- snapshot of tables.qr_token_version at scan time
  status          text    NOT NULL DEFAULT 'OPEN'
                    CHECK (status IN ('OPEN', 'BILLED', 'CLOSED')),
  pax             int     NOT NULL DEFAULT 1 CHECK (pax > 0),
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Only one OPEN session per table at a time
CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_one_open_uidx
  ON table_sessions (table_id) WHERE status = 'OPEN';

CREATE INDEX IF NOT EXISTS table_sessions_org_id_idx   ON table_sessions (org_id);
CREATE INDEX IF NOT EXISTS table_sessions_table_id_idx ON table_sessions (table_id);
CREATE INDEX IF NOT EXISTS table_sessions_customer_idx ON table_sessions (customer_id) WHERE customer_id IS NOT NULL;

ALTER TABLE table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE table_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON table_sessions
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON table_sessions TO dineflow_app;
