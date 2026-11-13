-- ============================================================================
-- Migration 0019: Public Outlet Resolution by Organization Slug
-- ============================================================================
-- Allows customer-web to resolve a hotel's primary active outlet cleanly from
-- ?slug=<slug> or tenant subdomain (or pilot slug in dev) without hardcoding UUIDs
-- or querying arbitrary tenants.

CREATE OR REPLACE FUNCTION resolve_public_outlet_by_slug(p_slug text)
RETURNS TABLE (
  outlet_id uuid,
  org_id    uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT o.id AS outlet_id, o.org_id
  FROM outlets o
  INNER JOIN organizations org ON org.id = o.org_id
  WHERE LOWER(org.slug) = LOWER(p_slug)
    AND org.is_active = true
    AND o.is_active = true
  ORDER BY o.created_at ASC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_public_outlet_by_slug(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_public_outlet_by_slug(text) TO dineflow_app;

