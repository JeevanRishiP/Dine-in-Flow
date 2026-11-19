-- Migration 0031: Customizations, Modifiers, and Coupons Hardening (ARCH §7, ARCH §18, AGENTS §2)

-- 1. Upgrade modifier_groups columns
ALTER TABLE modifier_groups
  ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES outlets(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS sort_order int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS min_select int,
  ADD COLUMN IF NOT EXISTS max_select int;

UPDATE modifier_groups
  SET min_select = min_selections
  WHERE min_select IS NULL;

UPDATE modifier_groups
  SET max_select = max_selections
  WHERE max_select IS NULL;

ALTER TABLE modifier_groups DROP CONSTRAINT IF EXISTS modifier_groups_selection_type_check;
ALTER TABLE modifier_groups ADD CONSTRAINT modifier_groups_selection_type_check
  CHECK (selection_type IN ('SINGLE', 'MULTIPLE', 'MULTI'));

CREATE INDEX IF NOT EXISTS modifier_groups_outlet_idx ON modifier_groups (org_id, outlet_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON modifier_groups TO dineflow_app;

-- 2. Upgrade modifiers columns
ALTER TABLE modifiers
  ADD COLUMN IF NOT EXISTS is_default boolean NOT NULL DEFAULT false;

ALTER TABLE modifiers
  ALTER COLUMN price_paise TYPE bigint;

GRANT SELECT, INSERT, UPDATE, DELETE ON modifiers TO dineflow_app;

-- 3. Views for modifier_options and menu_item_modifier_groups compatibility
CREATE OR REPLACE VIEW modifier_options AS
  SELECT id, org_id, group_id, name, name_i18n, price_paise, is_default, is_available, sort_order, created_at
  FROM modifiers;

CREATE OR REPLACE VIEW menu_item_modifier_groups AS
  SELECT item_id AS menu_item_id, group_id AS modifier_group_id, org_id, sort_order
  FROM item_modifier_groups;

GRANT SELECT ON modifier_options TO dineflow_app;
GRANT SELECT ON menu_item_modifier_groups TO dineflow_app;

-- 4. Upgrade coupons columns
ALTER TABLE coupons
  ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES outlets(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS discount_value int,
  ADD COLUMN IF NOT EXISTS redemption_count int NOT NULL DEFAULT 0;

UPDATE coupons
  SET discount_value = value
  WHERE discount_value IS NULL;

CREATE INDEX IF NOT EXISTS coupons_outlet_id_idx ON coupons (org_id, outlet_id);

-- 5. Outlets & Organizations App Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON outlets TO dineflow_app;
GRANT SELECT, UPDATE ON organizations TO dineflow_app;
