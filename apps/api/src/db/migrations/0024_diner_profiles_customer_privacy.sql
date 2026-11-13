-- Migration: 0024_diner_profiles_customer_privacy.sql
-- Purpose: Ensure diner_profiles belong strictly to an authenticated customer account
-- and are completely unreadable/unwritable by restaurant owners or staff at the DB RLS level.
-- Preserves ENABLE + FORCE ROW LEVEL SECURITY and tenant_isolation policy name.

-- 1. Remove any legacy unowned rows that lacked a customer_id
DELETE FROM diner_profiles WHERE customer_id IS NULL;

-- 2. Tighten RLS policy so rows are visible/writable ONLY when both app.org_id and
--    app.customer_id match that customer's own records (staff/owner sessions leave app.customer_id unset).
DROP POLICY IF EXISTS tenant_isolation ON diner_profiles;
CREATE POLICY tenant_isolation ON diner_profiles
  USING (
    org_id = current_org_id()
    AND customer_id IS NOT NULL
    AND customer_id = nullif(current_setting('app.customer_id', true), '')::uuid
  )
  WITH CHECK (
    org_id = current_org_id()
    AND customer_id IS NOT NULL
    AND customer_id = nullif(current_setting('app.customer_id', true), '')::uuid
  );

