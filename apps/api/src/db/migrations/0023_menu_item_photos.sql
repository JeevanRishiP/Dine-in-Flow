-- Migration: 0023_menu_item_photos.sql
-- Purpose: Add persistent image_url column on menu_items and tenant-isolated menu_item_photos bytea storage
-- so Owner & Manager can edit menu items and food photos directly without requiring external S3/MinIO.
-- Every table with org_id MUST have ENABLE + FORCE ROW LEVEL SECURITY.

ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS image_url text;

CREATE TABLE IF NOT EXISTS menu_item_photos (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  item_id     uuid        NOT NULL UNIQUE REFERENCES menu_items (id) ON DELETE CASCADE,
  mime_type   text        NOT NULL,
  image_bytes bytea       NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_item_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_item_photos FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_item_photos
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON menu_item_photos TO dineflow_app;
CREATE INDEX IF NOT EXISTS menu_item_photos_org_id_idx ON menu_item_photos (org_id);
CREATE INDEX IF NOT EXISTS menu_item_photos_item_id_idx ON menu_item_photos (org_id, item_id);

-- Public read helper for dish photos (only serves photos of active menu items)
CREATE OR REPLACE FUNCTION get_public_menu_item_photo(p_item_id uuid)
RETURNS TABLE (mime_type text, image_bytes bytea, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.mime_type, p.image_bytes, p.updated_at
  FROM menu_item_photos p
  JOIN menu_items mi ON mi.id = p.item_id AND mi.org_id = p.org_id
  WHERE p.item_id = p_item_id
    AND mi.is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_public_menu_item_photo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_menu_item_photo(uuid) TO dineflow_app;

