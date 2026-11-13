-- Migration: 0022_staff_usernames_and_simple_login.sql
-- Purpose: Support simple Owner-assigned staff usernames + passwords without requiring Workspace Slug at login.
-- Every table touched retains existing org_id + FORCE ROW LEVEL SECURITY.
-- Reference: ARCH §12, AGENTS §2 rules 3, 14

-- 1. Add nullable username column (expand-only, backwards compatible)
ALTER TABLE staff_users
  ADD COLUMN IF NOT EXISTS username citext;

-- 2. Backfill deterministic, human-friendly usernames for existing staff rows
WITH derived AS (
  SELECT
    id,
    org_id,
    CASE
      WHEN split_part(email::text, '@', 1) LIKE 'pilot.%'
        THEN substr(split_part(email::text, '@', 1), 7)
      ELSE split_part(email::text, '@', 1)
    END AS base_username,
    row_number() OVER (
      PARTITION BY org_id,
      CASE
        WHEN split_part(email::text, '@', 1) LIKE 'pilot.%'
          THEN substr(split_part(email::text, '@', 1), 7)
        ELSE split_part(email::text, '@', 1)
      END
      ORDER BY created_at, id
    ) AS dup_rank
  FROM staff_users
  WHERE username IS NULL
)
UPDATE staff_users su
SET username = CASE
  WHEN d.dup_rank = 1 THEN d.base_username
  ELSE d.base_username || '_' || d.dup_rank::text
END
FROM derived d
WHERE su.id = d.id
  AND su.username IS NULL;

-- 3. Enforce case-insensitive uniqueness of username per organization
CREATE UNIQUE INDEX IF NOT EXISTS staff_users_org_username_uidx
  ON staff_users (org_id, username)
  WHERE username IS NOT NULL;

-- 4. Narrow SECURITY DEFINER lookup helper: resolves active organization routing hints
-- for a given staff username or email when Workspace Slug is omitted at login.
-- Never returns passwords or PII; full credential verification still executes under
-- forced RLS inside withTenantContextRaw(org_id).
CREATE OR REPLACE FUNCTION resolve_staff_login_candidates(p_identifier text)
RETURNS TABLE (org_id uuid, org_slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT DISTINCT o.id AS org_id, o.slug::text AS org_slug
  FROM staff_users su
  JOIN organizations o ON o.id = su.org_id
  WHERE o.is_active = true
    AND su.is_active = true
    AND (su.username = p_identifier::citext OR su.email = p_identifier::citext)
  ORDER BY o.slug::text ASC
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION resolve_staff_login_candidates(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_staff_login_candidates(text) TO dineflow_app;

