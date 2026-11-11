-- Migration: 0003_menu.sql
-- Purpose: Menu, media, modifiers, availability, version tracking.
-- Every tenant table has FORCE ROW LEVEL SECURITY.
-- Reference: ARCH §7, §16, §17

-- ============================================================
-- Menu categories
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_categories (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id    uuid        REFERENCES outlets (id) ON DELETE SET NULL, -- NULL = all outlets
  name         text        NOT NULL,                    -- English fallback for search
  name_i18n    jsonb       NOT NULL DEFAULT '{}',       -- {"en":"...", "hi":"..."}
  sort_order   int         NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_categories FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_categories
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON menu_categories TO dineflow_app;
CREATE INDEX IF NOT EXISTS menu_categories_org_id_idx ON menu_categories (org_id);
CREATE INDEX IF NOT EXISTS menu_categories_outlet_id_idx ON menu_categories (org_id, outlet_id);

-- ============================================================
-- Menu items
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_items (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id           uuid        REFERENCES outlets (id) ON DELETE SET NULL, -- NULL = all outlets
  category_id         uuid        NOT NULL REFERENCES menu_categories (id) ON DELETE CASCADE,
  name                text        NOT NULL,                    -- English, used for full-text search
  name_i18n           jsonb       NOT NULL DEFAULT '{}',
  description_i18n    jsonb       NOT NULL DEFAULT '{}',
  price_paise         int         NOT NULL CHECK (price_paise >= 0),   -- base price in paise
  -- Dietary
  veg_type            text        NOT NULL DEFAULT 'VEG'
                        CHECK (veg_type IN ('VEG', 'NON_VEG', 'EGG', 'VEGAN')),
  allergens           text[]      NOT NULL DEFAULT '{}',        -- e.g. ARRAY['GLUTEN','DAIRY']
  -- Status
  is_available        boolean     NOT NULL DEFAULT true,
  is_active           boolean     NOT NULL DEFAULT true,
  -- Display
  sort_order          int         NOT NULL DEFAULT 0,
  prep_time_min       int,                                      -- estimated prep time
  calories            int,                                      -- kcal, optional
  spice_level         int         NOT NULL DEFAULT 0
                        CHECK (spice_level BETWEEN 0 AND 3),    -- 0=none 1=mild 2=med 3=hot
  -- Search (populated by trigger / background job)
  search_vector       tsvector,
  -- Reserved for Phase 9 AI features
  embedding           vector(768),
  -- Timestamps
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_items
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON menu_items TO dineflow_app;
CREATE INDEX IF NOT EXISTS menu_items_org_id_idx ON menu_items (org_id);
CREATE INDEX IF NOT EXISTS menu_items_category_id_idx ON menu_items (org_id, category_id);
CREATE INDEX IF NOT EXISTS menu_items_outlet_id_idx ON menu_items (org_id, outlet_id);
CREATE INDEX IF NOT EXISTS menu_items_search_vector_idx ON menu_items USING gin (search_vector);
CREATE INDEX IF NOT EXISTS menu_items_veg_type_idx ON menu_items (org_id, veg_type);

-- Trigger to keep search_vector in sync
CREATE OR REPLACE FUNCTION update_menu_item_search_vector()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.name_i18n->>'en', '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.description_i18n->>'en', '')), 'B');
  RETURN NEW;
END;
$$;

CREATE TRIGGER menu_items_search_vector_trigger
  BEFORE INSERT OR UPDATE ON menu_items
  FOR EACH ROW EXECUTE FUNCTION update_menu_item_search_vector();

-- ============================================================
-- Item media (images / videos)
-- ============================================================
CREATE TABLE IF NOT EXISTS item_media (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  item_id        uuid        NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  media_type     text        NOT NULL CHECK (media_type IN ('IMAGE', 'VIDEO')),
  -- Original upload
  raw_key        text        NOT NULL,   -- S3/MinIO key of the raw upload
  -- Processed outputs (populated by async media job)
  processed_key  text,                   -- primary processed image key (WebP/AVIF)
  thumbnail_key  text,                   -- small thumbnail key
  video_hls_url  text,                   -- HLS playlist URL (VIDEO type, via VideoProvider)
  -- Metadata
  width_px       int,
  height_px      int,
  size_bytes     bigint,
  mime_type      text,
  alt_text_i18n  jsonb       NOT NULL DEFAULT '{}',
  -- Processing state
  status         text        NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'PROCESSING', 'READY', 'FAILED')),
  sort_order     int         NOT NULL DEFAULT 0,
  is_active      boolean     NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE item_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_media FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_media
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON item_media TO dineflow_app;
CREATE INDEX IF NOT EXISTS item_media_org_id_idx ON item_media (org_id);
CREATE INDEX IF NOT EXISTS item_media_item_id_idx ON item_media (org_id, item_id);

-- ============================================================
-- Modifier groups (e.g. "Choose spice level")
-- ============================================================
CREATE TABLE IF NOT EXISTS modifier_groups (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name             text        NOT NULL,
  name_i18n        jsonb       NOT NULL DEFAULT '{}',
  selection_type   text        NOT NULL DEFAULT 'SINGLE'
                     CHECK (selection_type IN ('SINGLE', 'MULTIPLE')),
  min_selections   int         NOT NULL DEFAULT 0 CHECK (min_selections >= 0),
  max_selections   int         NOT NULL DEFAULT 1 CHECK (max_selections >= 1),
  is_required      boolean     NOT NULL DEFAULT false,
  is_active        boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (max_selections >= min_selections)
);

ALTER TABLE modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifier_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifier_groups
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON modifier_groups TO dineflow_app;
CREATE INDEX IF NOT EXISTS modifier_groups_org_id_idx ON modifier_groups (org_id);

-- ============================================================
-- Modifiers (individual options within a group)
-- ============================================================
CREATE TABLE IF NOT EXISTS modifiers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  group_id     uuid        NOT NULL REFERENCES modifier_groups (id) ON DELETE CASCADE,
  name         text        NOT NULL,
  name_i18n    jsonb       NOT NULL DEFAULT '{}',
  price_paise  int         NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  is_available boolean     NOT NULL DEFAULT true,
  sort_order   int         NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE modifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE modifiers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON modifiers
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON modifiers TO dineflow_app;
CREATE INDEX IF NOT EXISTS modifiers_org_id_idx ON modifiers (org_id);
CREATE INDEX IF NOT EXISTS modifiers_group_id_idx ON modifiers (group_id);

-- ============================================================
-- Item ↔ modifier group link table
-- ============================================================
CREATE TABLE IF NOT EXISTS item_modifier_groups (
  item_id    uuid NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES modifier_groups (id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  sort_order int  NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, group_id)
);

ALTER TABLE item_modifier_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_modifier_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_modifier_groups
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, DELETE ON item_modifier_groups TO dineflow_app;
CREATE INDEX IF NOT EXISTS item_modifier_groups_org_id_idx ON item_modifier_groups (org_id);

-- ============================================================
-- Item availability overrides (per outlet + day/time window)
-- ============================================================
CREATE TABLE IF NOT EXISTS item_availability (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  item_id     uuid        NOT NULL REFERENCES menu_items (id) ON DELETE CASCADE,
  outlet_id   uuid        REFERENCES outlets (id) ON DELETE CASCADE, -- NULL = all outlets
  day_of_week int         CHECK (day_of_week BETWEEN 0 AND 6),       -- 0=Sun … 6=Sat; NULL=every day
  start_time  time,                                                    -- NULL = midnight
  end_time    time,                                                    -- NULL = midnight
  is_available boolean    NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE item_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE item_availability FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON item_availability
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON item_availability TO dineflow_app;
CREATE INDEX IF NOT EXISTS item_availability_org_id_idx ON item_availability (org_id, item_id, outlet_id);

-- ============================================================
-- Menu versions (for cache invalidation)
-- Bumped in same transaction as any menu change.
-- ============================================================
CREATE TABLE IF NOT EXISTS menu_versions (
  org_id     uuid    NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  outlet_id  uuid    REFERENCES outlets (id) ON DELETE CASCADE, -- NULL = org-level default
  version    bigint  NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, outlet_id)
);

-- NOTE: menu_versions has org_id but no self-contained tenant filter
--       (org scoped, no need to hide from owner). Still apply RLS for safety.
ALTER TABLE menu_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON menu_versions
  USING (org_id = current_org_id()) WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE ON menu_versions TO dineflow_app;

-- Initialize version row for each org on first migration
-- (Real initialization happens via API at org creation time)
