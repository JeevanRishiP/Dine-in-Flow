-- ============================================================================
-- Migration 0015: Add Half Portion Pricing & Diner Profiles
-- ============================================================================

-- 1. Add allow_half_portion and half_price_paise to menu_items
ALTER TABLE menu_items
  ADD COLUMN IF NOT EXISTS allow_half_portion BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS half_price_paise INTEGER NULL;

-- 2. Populate allow_half_portion for Biryani, Rice, Main Course, and Starters
-- Calculate default half price at ~62% of full price rounded to nearest ₹10 (1000 paise)
UPDATE menu_items mi
SET 
  allow_half_portion = true,
  half_price_paise = ROUND((mi.price_paise * 0.62) / 1000) * 1000
FROM menu_categories mc
WHERE mi.category_id = mc.id
  AND mc.name IN ('Biryani & Rice', 'Main Course', 'Starters')
  AND mi.name NOT ILIKE '%tea%'
  AND mi.name NOT ILIKE '%coffee%'
  AND mi.name NOT ILIKE '%lassi%'
  AND mi.name NOT ILIKE '%soda%'
  AND mi.name NOT ILIKE '%roti%'
  AND mi.name NOT ILIKE '%naan%';

-- 3. Create diner_profiles table
CREATE TABLE IF NOT EXISTS diner_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  customer_id         uuid REFERENCES customers (id) ON DELETE CASCADE,
  name                text NOT NULL,
  relationship_tag    text NOT NULL DEFAULT 'FRIEND',
  spice_preference    text NOT NULL DEFAULT 'MEDIUM',
  dietary_preference  text NOT NULL DEFAULT 'ANY',
  kitchen_instructions text[] NOT NULL DEFAULT '{}',
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT diner_profiles_spice_check CHECK (spice_preference IN ('MILD', 'MEDIUM', 'HOT', 'NONE')),
  CONSTRAINT diner_profiles_dietary_check CHECK (dietary_preference IN ('ANY', 'VEG', 'NON_VEG', 'JAIN', 'VEGAN'))
);

-- Forced Row Level Security (AGENTS §2 rule 3)
ALTER TABLE diner_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE diner_profiles FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON diner_profiles
  USING (org_id = current_org_id())
  WITH CHECK (org_id = current_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON diner_profiles TO dineflow_app;

CREATE INDEX IF NOT EXISTS diner_profiles_org_id_idx ON diner_profiles (org_id);
CREATE INDEX IF NOT EXISTS diner_profiles_customer_id_idx ON diner_profiles (org_id, customer_id);

-- 4. Seed initial default diner profiles for Royal Spice Bistro tenant (if organization exists)
DO $$
DECLARE
  v_org_rsb uuid := '7762b6af-d052-4e74-b917-39e3c56e7914';
BEGIN
  IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_rsb) THEN
    INSERT INTO diner_profiles (id, org_id, name, relationship_tag, spice_preference, dietary_preference, kitchen_instructions, notes)
    VALUES
      ('d1000000-0000-4000-8000-000000000001', v_org_rsb, 'Rahul', 'ME', 'MEDIUM', 'NON_VEG', ARRAY['Extra Crispy', 'Less Oil'], 'Self profile'),
      ('d1000000-0000-4000-8000-000000000002', v_org_rsb, 'Priya', 'PARTNER', 'MILD', 'VEG', ARRAY['Mild', 'No Onion / Garlic', 'Less Butter / Oil'], 'Partner preference'),
      ('d1000000-0000-4000-8000-000000000003', v_org_rsb, 'Dad', 'DAD', 'HOT', 'NON_VEG', ARRAY['Extra Spicy / Kadak', 'Extra Onions'], 'Prefers authentic rich spice'),
      ('d1000000-0000-4000-8000-000000000004', v_org_rsb, 'Mom', 'MOM', 'MILD', 'VEG', ARRAY['Mild', 'Less Oil', 'No Garlic (Jain Prep)'], 'Light and gentle on stomach')
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      spice_preference = EXCLUDED.spice_preference,
      kitchen_instructions = EXCLUDED.kitchen_instructions;
  END IF;
END $$;

