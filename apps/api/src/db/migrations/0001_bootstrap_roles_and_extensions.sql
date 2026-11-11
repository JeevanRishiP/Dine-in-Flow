-- Migration: 0001_bootstrap_roles_and_extensions.sql
-- Purpose: Create DB roles, enable required extensions, and bootstrap the RLS harness table.
-- Runs under the MIGRATOR role (privileged). The app role has no BYPASSRLS.
-- Reference: ARCH §6, §3

-- ============================================================
-- Extensions
-- ============================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- pgvector must be installed on the server (pgvector package)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Roles
-- ============================================================
-- App role: used by the API server at runtime. No BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dineflow_app') THEN
    CREATE ROLE dineflow_app LOGIN PASSWORD 'change_me_in_env';
  END IF;
END $$;

-- Read-only role for analytics / reports
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'dineflow_readonly') THEN
    CREATE ROLE dineflow_readonly LOGIN PASSWORD 'change_me_in_env';
  END IF;
END $$;

-- ============================================================
-- RLS helper: create a policy-safe wrapper so set_config works per TX
-- ============================================================
-- Function that returns the current tenant org_id from session config.
-- Returns NULL if not set — policies must FAIL CLOSED (return no rows).
CREATE OR REPLACE FUNCTION current_org_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER AS
$$
  SELECT NULLIF(current_setting('app.org_id', true), '')::uuid
$$;

-- ============================================================
-- RLS harness table (used only in CI tests to validate the harness)
-- This table is NOT a real business table; it demonstrates forced RLS.
-- ============================================================
CREATE TABLE IF NOT EXISTS _rls_test_items (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid    NOT NULL,
  label       text    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Forced RLS — even the table owner cannot bypass
ALTER TABLE _rls_test_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE _rls_test_items FORCE ROW LEVEL SECURITY;

-- Tenant isolation policy: only see rows belonging to the current org
CREATE POLICY tenant_isolation ON _rls_test_items
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

-- Grant only the allowed verbs to the app role on this test table
GRANT SELECT, INSERT, UPDATE ON _rls_test_items TO dineflow_app;
-- DELETE is intentionally not granted to test tables (immutable-ish data model preferred)

-- ============================================================
-- Index on org_id for all tenant tables (here: harness table)
-- ============================================================
CREATE INDEX IF NOT EXISTS _rls_test_items_org_id_idx ON _rls_test_items (org_id);
