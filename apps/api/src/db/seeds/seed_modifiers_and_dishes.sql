-- ============================================================================
-- DINEFLOW MODIFIERS & DISHES SEED
-- Features:
-- 1. Category-specific modifiers & preferences (Savory, Desserts, Beverages, Breads)
-- 2. Minor-unit priced add-ons (Oat Milk +₹30, Almond Milk +₹35, Extra Rabri +₹40, etc.)
-- 3. Strict tenant isolation for both Spice Garden and Royal Spice Bistro
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. MENU CATEGORIES
-- ============================================================================
INSERT INTO menu_categories (id, org_id, outlet_id, name, name_i18n, sort_order, is_active)
VALUES
    ('c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Starters', '{"en": "Starters", "hi": "स्टार्टर्स"}'::jsonb, 1, true),
    ('c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Main Course', '{"en": "Main Course", "hi": "मुख्य भोजन"}'::jsonb, 2, true),
    ('c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Biryani & Rice', '{"en": "Biryani & Rice", "hi": "बिरयानी और चावल"}'::jsonb, 3, true),
    ('c0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Breads', '{"en": "Breads", "hi": "रोटी और नान"}'::jsonb, 4, true),
    ('c0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Desserts', '{"en": "Desserts", "hi": "मिठाइयाँ"}'::jsonb, 5, true),
    ('c0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'Beverages', '{"en": "Beverages", "hi": "पेय पदार्थ"}'::jsonb, 6, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    name_i18n = EXCLUDED.name_i18n,
    sort_order = EXCLUDED.sort_order,
    is_active = EXCLUDED.is_active;


-- ============================================================================
-- 2. MENU ITEMS
-- ============================================================================
INSERT INTO menu_items (id, org_id, outlet_id, category_id, name, name_i18n, description_i18n, price_paise, veg_type, allergens, is_available, is_active, sort_order, prep_time_min, calories, spice_level)
VALUES
    -- Starters (Spice 1-3)
    ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Paneer Tikka', '{"en": "Paneer Tikka", "hi": "पनीर टिक्का"}'::jsonb, '{"en": "Cottage cheese marinated in spices and grilled in tandoor."}'::jsonb, 28000, 'VEG', ARRAY['DAIRY']::text[], true, true, 1, 15, 320, 2),
    ('e0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'Chicken Kebab', '{"en": "Chicken Kebab", "hi": "चिकन कबाब"}'::jsonb, '{"en": "Juicy minced chicken kebabs with aromatic Indian herbs."}'::jsonb, 35000, 'NON_VEG', ARRAY[]::text[], true, true, 2, 20, 410, 2),
    
    -- Main Course (Spice 1-3)
    ('e0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Butter Chicken', '{"en": "Butter Chicken", "hi": "बटर चिकन"}'::jsonb, '{"en": "Classic chicken tikka in a rich, buttery tomato gravy."}'::jsonb, 42000, 'NON_VEG', ARRAY['DAIRY', 'NUTS']::text[], true, true, 1, 25, 650, 1),
    ('e0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000002', 'Dal Makhani', '{"en": "Dal Makhani", "hi": "दाल मखनी"}'::jsonb, '{"en": "Slow-cooked black lentils with cream and butter."}'::jsonb, 29000, 'VEG', ARRAY['DAIRY']::text[], true, true, 2, 25, 420, 1),
    
    -- Biryani (Spice 1-3)
    ('e0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 'Hyderabadi Chicken Biryani', '{"en": "Hyderabadi Chicken Biryani", "hi": "हैदराबादी चिकन बिरयानी"}'::jsonb, '{"en": "Authentic dum biryani layered with marinated chicken and basmati."}'::jsonb, 45000, 'NON_VEG', ARRAY['DAIRY']::text[], true, true, 1, 30, 800, 3),
    
    -- Breads (Spice 1)
    ('e0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000004', 'Butter Garlic Naan', '{"en": "Butter Garlic Naan", "hi": "बटर गार्लिक नान"}'::jsonb, '{"en": "Refined flour bread cooked in tandoor with garlic and butter."}'::jsonb, 8000, 'VEG', ARRAY['DAIRY', 'GLUTEN']::text[], true, true, 1, 10, 220, 1),
    
    -- Desserts (Spice MUST BE 0)
    ('e0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'Gulab Jamun', '{"en": "Gulab Jamun", "hi": "गुलाब जामुन"}'::jsonb, '{"en": "Deep fried milk dough balls soaked in sugar syrup."}'::jsonb, 12000, 'VEG', ARRAY['DAIRY', 'GLUTEN']::text[], true, true, 1, 5, 300, 0),
    ('e0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000005', 'Rasmalai', '{"en": "Rasmalai", "hi": "रसमलाई"}'::jsonb, '{"en": "Cottage cheese dumplings soaked in sweetened thickened milk."}'::jsonb, 16000, 'VEG', ARRAY['DAIRY', 'NUTS']::text[], true, true, 2, 5, 280, 0),
    
    -- Beverages (Spice MUST BE 0)
    ('e0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000006', 'Filter Coffee', '{"en": "Filter Coffee", "hi": "फ़िल्टर कॉफ़ी"}'::jsonb, '{"en": "Traditional South Indian hot coffee."}'::jsonb, 9000, 'VEG', ARRAY['DAIRY']::text[], true, true, 1, 10, 80, 0),
    ('e0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000006', 'Mango Lassi', '{"en": "Mango Lassi", "hi": "मैंगो लस्सी"}'::jsonb, '{"en": "Sweet yogurt drink blended with fresh mango pulp."}'::jsonb, 14000, 'VEG', ARRAY['DAIRY']::text[], true, true, 2, 5, 250, 0)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_paise = EXCLUDED.price_paise,
    veg_type = EXCLUDED.veg_type,
    allergens = EXCLUDED.allergens,
    spice_level = EXCLUDED.spice_level,
    description_i18n = EXCLUDED.description_i18n;


-- ============================================================================
-- 3. MODIFIER GROUPS
-- ============================================================================
INSERT INTO modifier_groups (id, org_id, name, name_i18n, selection_type, min_selections, max_selections, is_required, is_active)
VALUES
    -- Dessert Groups
    ('90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Sweetness Level', '{"en": "Sweetness Level", "hi": "मिठास का स्तर"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Serving Temperature', '{"en": "Serving Temperature", "hi": "परोसने का तापमान"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'Dessert Kitchen Notes & Garnish', '{"en": "Dessert Kitchen Notes & Garnish"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Hot Beverage Groups
    ('90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'Sugar Preference', '{"en": "Sugar Preference"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Milk & Decoction Strength', '{"en": "Milk & Decoction Strength"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 'Hot Serving Temperature', '{"en": "Serving Temperature"}'::jsonb, 'SINGLE', 1, 1, true, true),
    
    -- Cold Beverage Groups
    ('90000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'Sweet / Salt Style', '{"en": "Sweet / Salt Style"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 'Ice Level', '{"en": "Ice Level"}'::jsonb, 'SINGLE', 1, 1, true, true),
    
    -- Starters Groups
    ('90000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 'Spice Preference (Starters)', '{"en": "Spice Preference"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 'Chef Kitchen Instructions', '{"en": "Chef Kitchen Instructions"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Main Course Groups
    ('90000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 'Spice Level (Curries)', '{"en": "Spice Level"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 'Kitchen Preparation', '{"en": "Kitchen Preparation"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Biryani Groups
    ('90000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 'Spice Level (Biryani)', '{"en": "Spice Level"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('90000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 'Biryani Add-ons', '{"en": "Biryani Add-ons"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Breads Groups
    ('90000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 'Bread Finishing', '{"en": "Bread Finishing"}'::jsonb, 'SINGLE', 1, 1, true, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    selection_type = EXCLUDED.selection_type,
    min_selections = EXCLUDED.min_selections,
    max_selections = EXCLUDED.max_selections,
    is_required = EXCLUDED.is_required;


-- ============================================================================
-- 4. MODIFIERS
-- ============================================================================
INSERT INTO modifiers (id, org_id, group_id, name, name_i18n, price_paise, is_available, sort_order)
VALUES
    -- G1: Sweetness Level
    ('f0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Mild Sweet / Less Sugar', '{"en": "Mild Sweet / Less Sugar"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Regular Sweetness', '{"en": "Regular Sweetness"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000001', 'Extra Sweet', '{"en": "Extra Sweet"}'::jsonb, 0, true, 3),
    
    -- G2: Serving Temperature (Dessert)
    ('f0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'Served Warm', '{"en": "Served Warm"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'Served Chilled', '{"en": "Served Chilled"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000002', 'Room Temperature', '{"en": "Room Temperature"}'::jsonb, 0, true, 3),

    -- G3: Dessert Kitchen Notes
    ('f0000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'Without Nuts (Nut Allergy)', '{"en": "Without Nuts (Nut Allergy)"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'Extra Saffron / Rabri', '{"en": "Extra Saffron / Rabri"}'::jsonb, 4000, true, 2),
    ('f0000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000003', 'Extra Pistachios & Almonds', '{"en": "Extra Pistachios & Almonds"}'::jsonb, 3000, true, 3),

    -- G4: Sugar Preference
    ('f0000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', 'Sugar-Free / No Sugar', '{"en": "Sugar-Free / No Sugar"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', 'Less Sugar', '{"en": "Less Sugar"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', 'Regular Sugar', '{"en": "Regular Sugar"}'::jsonb, 0, true, 3),
    ('f0000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000004', 'Jaggery (Gud)', '{"en": "Jaggery (Gud)"}'::jsonb, 0, true, 4),

    -- G5: Milk & Decoction
    ('f0000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000005', 'Strong / Kadak', '{"en": "Strong / Kadak"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000005', 'Medium Strength', '{"en": "Medium Strength"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000016', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000005', 'Light / Mild', '{"en": "Light / Mild"}'::jsonb, 0, true, 3),
    ('f0000000-0000-0000-0000-000000000017', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000005', 'Oat Milk', '{"en": "Oat Milk"}'::jsonb, 3000, true, 4),
    ('f0000000-0000-0000-0000-000000000018', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000005', 'Almond Milk', '{"en": "Almond Milk"}'::jsonb, 3500, true, 5),

    -- G6: Hot Serving Temp
    ('f0000000-0000-0000-0000-000000000019', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000006', 'Extra Hot', '{"en": "Extra Hot"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000020', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000006', 'Regular Hot', '{"en": "Regular Hot"}'::jsonb, 0, true, 2),

    -- G7: Sweet / Salt Style (Cold Bev)
    ('f0000000-0000-0000-0000-000000000021', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000007', 'Less Sweet', '{"en": "Less Sweet"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000022', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000007', 'Regular Sweet', '{"en": "Regular Sweet"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000023', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000007', 'Mango Puree Float', '{"en": "Mango Puree Float"}'::jsonb, 2500, true, 3),

    -- G8: Ice Level
    ('f0000000-0000-0000-0000-000000000024', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000008', 'No Ice', '{"en": "No Ice"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000025', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000008', 'Less Ice', '{"en": "Less Ice"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000026', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000008', 'Regular Ice', '{"en": "Regular Ice"}'::jsonb, 0, true, 3),

    -- G9: Spice Preference (Starters)
    ('f0000000-0000-0000-0000-000000000027', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000009', '🍃 Mild', '{"en": "🍃 Mild"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000028', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000009', '🌶️ Medium', '{"en": "🌶️ Medium"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000029', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000009', '🔥 Extra Spicy', '{"en": "🔥 Extra Spicy"}'::jsonb, 0, true, 3),

    -- G10: Chef Kitchen Instructions
    ('f0000000-0000-0000-0000-000000000030', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000010', 'Well Done & Extra Crispy', '{"en": "Well Done & Extra Crispy"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000031', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000010', 'Less Oil', '{"en": "Less Oil"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000032', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000010', 'No Onion / No Garlic (Jain Prep)', '{"en": "No Onion / No Garlic (Jain Prep)"}'::jsonb, 0, true, 3),
    ('f0000000-0000-0000-0000-000000000033', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000010', 'Less Salt', '{"en": "Less Salt"}'::jsonb, 0, true, 4),
    ('f0000000-0000-0000-0000-000000000034', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000010', 'Extra Mint Chutney', '{"en": "Extra Mint Chutney"}'::jsonb, 2000, true, 5),

    -- G11: Spice Level (Curries)
    ('f0000000-0000-0000-0000-000000000035', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000011', 'Mild (Low Spice)', '{"en": "Mild (Low Spice)"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000036', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000011', 'Medium Spice', '{"en": "Medium Spice"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000037', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000011', 'Spicy / Teekha', '{"en": "Spicy / Teekha"}'::jsonb, 0, true, 3),

    -- G12: Kitchen Preparation (Curries)
    ('f0000000-0000-0000-0000-000000000038', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000012', 'Less Butter / Less Oil', '{"en": "Less Butter / Less Oil"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000039', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000012', 'Extra Butter Dollop', '{"en": "Extra Butter Dollop"}'::jsonb, 2500, true, 2),
    ('f0000000-0000-0000-0000-000000000040', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000012', 'No Ginger Juliennes', '{"en": "No Ginger Juliennes"}'::jsonb, 0, true, 3),
    ('f0000000-0000-0000-0000-000000000041', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000012', 'Extra Cream', '{"en": "Extra Cream"}'::jsonb, 2000, true, 4),

    -- G13: Spice Level (Biryani)
    ('f0000000-0000-0000-0000-000000000042', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000013', 'Mild Spice', '{"en": "Mild Spice"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000043', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000013', 'Traditional Dum Spicy', '{"en": "Traditional Dum Spicy"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000044', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000013', 'Extra Mirchi Salan', '{"en": "Extra Mirchi Salan"}'::jsonb, 0, true, 3),

    -- G14: Biryani Add-ons
    ('f0000000-0000-0000-0000-000000000045', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000014', 'Extra Cucumber Mint Raita', '{"en": "Extra Cucumber Mint Raita"}'::jsonb, 3000, true, 1),
    ('f0000000-0000-0000-0000-000000000046', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000014', 'Double Fried Onions (Barista)', '{"en": "Double Fried Onions (Barista)"}'::jsonb, 2000, true, 2),
    ('f0000000-0000-0000-0000-000000000047', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000014', 'Extra Boiled Egg', '{"en": "Extra Boiled Egg"}'::jsonb, 2500, true, 3),

    -- G15: Bread Finishing
    ('f0000000-0000-0000-0000-000000000048', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000015', 'No Butter (Dry)', '{"en": "No Butter (Dry)"}'::jsonb, 0, true, 1),
    ('f0000000-0000-0000-0000-000000000049', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000015', 'Regular Butter Brush', '{"en": "Regular Butter Brush"}'::jsonb, 0, true, 2),
    ('f0000000-0000-0000-0000-000000000050', 'a0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000015', 'Crispy / Well Done', '{"en": "Crispy / Well Done"}'::jsonb, 0, true, 3)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_paise = EXCLUDED.price_paise,
    sort_order = EXCLUDED.sort_order;


-- ============================================================================
-- 5. ITEM MODIFIER GROUPS (Mappings)
-- ============================================================================
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
VALUES
    -- M1: Paneer Tikka -> G9 (Spice Preference), G10 (Chef Instructions)
    ('e0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000001', '90000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 2),
    
    -- M2: Chicken Kebab -> G9, G10
    ('e0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000009', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000002', '90000000-0000-0000-0000-000000000010', 'a0000000-0000-0000-0000-000000000001', 2),

    -- M3: Butter Chicken -> G11 (Curry Spice), G12 (Curry Prep)
    ('e0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000003', '90000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 2),

    -- M4: Dal Makhani -> G11, G12
    ('e0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000011', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000004', '90000000-0000-0000-0000-000000000012', 'a0000000-0000-0000-0000-000000000001', 2),

    -- M5: Hyd Chicken Biryani -> G13 (Biryani Spice), G14 (Biryani Add-ons)
    ('e0000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000013', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000005', '90000000-0000-0000-0000-000000000014', 'a0000000-0000-0000-0000-000000000001', 2),

    -- M6: Butter Garlic Naan -> G15 (Bread Finishing)
    ('e0000000-0000-0000-0000-000000000006', '90000000-0000-0000-0000-000000000015', 'a0000000-0000-0000-0000-000000000001', 1),

    -- M7: Gulab Jamun -> G1 (Sweetness), G2 (Serving Temp), G3 (Garnish)
    ('e0000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 2),
    ('e0000000-0000-0000-0000-000000000007', '90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 3),

    -- M8: Rasmalai -> G1, G2, G3
    ('e0000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 2),
    ('e0000000-0000-0000-0000-000000000008', '90000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 3),

    -- M9: Filter Coffee -> G4 (Sugar), G5 (Milk Strength), G6 (Hot Temp)
    ('e0000000-0000-0000-0000-000000000009', '90000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000009', '90000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 2),
    ('e0000000-0000-0000-0000-000000000009', '90000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000001', 3),

    -- M10: Mango Lassi -> G7 (Sweet Style), G8 (Ice Level)
    ('e0000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 1),
    ('e0000000-0000-0000-0000-000000000010', '90000000-0000-0000-0000-000000000008', 'a0000000-0000-0000-0000-000000000001', 2)
ON CONFLICT (item_id, group_id) DO UPDATE SET
    sort_order = EXCLUDED.sort_order;

COMMIT;

BEGIN;

INSERT INTO modifier_groups (id, org_id, name, name_i18n, selection_type, min_selections, max_selections, is_required, is_active)
VALUES
    -- Dessert Groups
    ('97762b6a-0000-0000-0000-000000000001', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Sweetness Level', '{"en": "Sweetness Level", "hi": "मिठास का स्तर"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000002', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Serving Temperature', '{"en": "Serving Temperature", "hi": "परोसने का तापमान"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000003', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Dessert Kitchen Notes & Garnish', '{"en": "Dessert Kitchen Notes & Garnish"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Hot Beverage Groups
    ('97762b6a-0000-0000-0000-000000000004', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Sugar Preference', '{"en": "Sugar Preference"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000005', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Milk & Decoction Strength', '{"en": "Milk & Decoction Strength"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000006', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Hot Serving Temperature', '{"en": "Serving Temperature"}'::jsonb, 'SINGLE', 1, 1, true, true),
    
    -- Cold Beverage Groups
    ('97762b6a-0000-0000-0000-000000000007', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Sweet / Salt Style', '{"en": "Sweet / Salt Style"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000008', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Ice Level', '{"en": "Ice Level"}'::jsonb, 'SINGLE', 1, 1, true, true),
    
    -- Starters Groups
    ('97762b6a-0000-0000-0000-000000000009', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Spice Preference (Starters)', '{"en": "Spice Preference"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000010', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Chef Kitchen Instructions', '{"en": "Chef Kitchen Instructions"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Main Course Groups
    ('97762b6a-0000-0000-0000-000000000011', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Spice Level (Curries)', '{"en": "Spice Level"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000012', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Kitchen Preparation', '{"en": "Kitchen Preparation"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Biryani Groups
    ('97762b6a-0000-0000-0000-000000000013', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Spice Level (Biryani)', '{"en": "Spice Level"}'::jsonb, 'SINGLE', 1, 1, true, true),
    ('97762b6a-0000-0000-0000-000000000014', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Biryani Add-ons', '{"en": "Biryani Add-ons"}'::jsonb, 'MULTIPLE', 0, 3, false, true),
    
    -- Breads Groups
    ('97762b6a-0000-0000-0000-000000000015', '7762b6af-d052-4e74-b917-39e3c56e7914', 'Bread Finishing', '{"en": "Bread Finishing"}'::jsonb, 'SINGLE', 1, 1, true, true)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    selection_type = EXCLUDED.selection_type,
    min_selections = EXCLUDED.min_selections,
    max_selections = EXCLUDED.max_selections,
    is_required = EXCLUDED.is_required;

INSERT INTO modifiers (id, org_id, group_id, name, name_i18n, price_paise, is_available, sort_order)
VALUES
    -- G1: Sweetness Level
    ('f7762b6a-0000-0000-0000-000000000001', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000001', 'Mild Sweet / Less Sugar', '{"en": "Mild Sweet / Less Sugar"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000002', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000001', 'Regular Sweetness', '{"en": "Regular Sweetness"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000003', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000001', 'Extra Sweet', '{"en": "Extra Sweet"}'::jsonb, 0, true, 3),
    
    -- G2: Serving Temperature (Dessert)
    ('f7762b6a-0000-0000-0000-000000000004', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000002', 'Served Warm', '{"en": "Served Warm"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000005', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000002', 'Served Chilled', '{"en": "Served Chilled"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000006', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000002', 'Room Temperature', '{"en": "Room Temperature"}'::jsonb, 0, true, 3),

    -- G3: Dessert Kitchen Notes
    ('f7762b6a-0000-0000-0000-000000000007', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000003', 'Without Nuts (Nut Allergy)', '{"en": "Without Nuts (Nut Allergy)"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000008', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000003', 'Extra Saffron / Rabri', '{"en": "Extra Saffron / Rabri"}'::jsonb, 4000, true, 2),
    ('f7762b6a-0000-0000-0000-000000000009', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000003', 'Extra Pistachios & Almonds', '{"en": "Extra Pistachios & Almonds"}'::jsonb, 3000, true, 3),

    -- G4: Sugar Preference
    ('f7762b6a-0000-0000-0000-000000000010', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000004', 'Sugar-Free / No Sugar', '{"en": "Sugar-Free / No Sugar"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000011', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000004', 'Less Sugar', '{"en": "Less Sugar"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000012', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000004', 'Regular Sugar', '{"en": "Regular Sugar"}'::jsonb, 0, true, 3),
    ('f7762b6a-0000-0000-0000-000000000013', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000004', 'Jaggery (Gud)', '{"en": "Jaggery (Gud)"}'::jsonb, 0, true, 4),

    -- G5: Milk & Decoction
    ('f7762b6a-0000-0000-0000-000000000014', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000005', 'Strong / Kadak', '{"en": "Strong / Kadak"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000015', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000005', 'Medium Strength', '{"en": "Medium Strength"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000016', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000005', 'Light / Mild', '{"en": "Light / Mild"}'::jsonb, 0, true, 3),
    ('f7762b6a-0000-0000-0000-000000000017', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000005', 'Oat Milk', '{"en": "Oat Milk"}'::jsonb, 3000, true, 4),
    ('f7762b6a-0000-0000-0000-000000000018', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000005', 'Almond Milk', '{"en": "Almond Milk"}'::jsonb, 3500, true, 5),

    -- G6: Hot Serving Temp
    ('f7762b6a-0000-0000-0000-000000000019', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000006', 'Extra Hot', '{"en": "Extra Hot"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000020', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000006', 'Regular Hot', '{"en": "Regular Hot"}'::jsonb, 0, true, 2),

    -- G7: Sweet / Salt Style (Cold Bev)
    ('f7762b6a-0000-0000-0000-000000000021', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000007', 'Less Sweet', '{"en": "Less Sweet"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000022', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000007', 'Regular Sweet', '{"en": "Regular Sweet"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000023', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000007', 'Mango Puree Float', '{"en": "Mango Puree Float"}'::jsonb, 2500, true, 3),

    -- G8: Ice Level
    ('f7762b6a-0000-0000-0000-000000000024', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000008', 'No Ice', '{"en": "No Ice"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000025', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000008', 'Less Ice', '{"en": "Less Ice"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000026', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000008', 'Regular Ice', '{"en": "Regular Ice"}'::jsonb, 0, true, 3),

    -- G9: Spice Preference (Starters)
    ('f7762b6a-0000-0000-0000-000000000027', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000009', '🍃 Mild', '{"en": "🍃 Mild"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000028', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000009', '🌶️ Medium', '{"en": "🌶️ Medium"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000029', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000009', '🔥 Extra Spicy', '{"en": "🔥 Extra Spicy"}'::jsonb, 0, true, 3),

    -- G10: Chef Kitchen Instructions
    ('f7762b6a-0000-0000-0000-000000000030', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000010', 'Well Done & Extra Crispy', '{"en": "Well Done & Extra Crispy"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000031', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000010', 'Less Oil', '{"en": "Less Oil"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000032', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000010', 'No Onion / No Garlic (Jain Prep)', '{"en": "No Onion / No Garlic (Jain Prep)"}'::jsonb, 0, true, 3),
    ('f7762b6a-0000-0000-0000-000000000033', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000010', 'Less Salt', '{"en": "Less Salt"}'::jsonb, 0, true, 4),
    ('f7762b6a-0000-0000-0000-000000000034', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000010', 'Extra Mint Chutney', '{"en": "Extra Mint Chutney"}'::jsonb, 2000, true, 5),

    -- G11: Spice Level (Curries)
    ('f7762b6a-0000-0000-0000-000000000035', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000011', 'Mild (Low Spice)', '{"en": "Mild (Low Spice)"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000036', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000011', 'Medium Spice', '{"en": "Medium Spice"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000037', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000011', 'Spicy / Teekha', '{"en": "Spicy / Teekha"}'::jsonb, 0, true, 3),

    -- G12: Kitchen Preparation (Curries)
    ('f7762b6a-0000-0000-0000-000000000038', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000012', 'Less Butter / Less Oil', '{"en": "Less Butter / Less Oil"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000039', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000012', 'Extra Butter Dollop', '{"en": "Extra Butter Dollop"}'::jsonb, 2500, true, 2),
    ('f7762b6a-0000-0000-0000-000000000040', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000012', 'No Ginger Juliennes', '{"en": "No Ginger Juliennes"}'::jsonb, 0, true, 3),
    ('f7762b6a-0000-0000-0000-000000000041', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000012', 'Extra Cream', '{"en": "Extra Cream"}'::jsonb, 2000, true, 4),

    -- G13: Spice Level (Biryani)
    ('f7762b6a-0000-0000-0000-000000000042', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000013', 'Mild Spice', '{"en": "Mild Spice"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000043', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000013', 'Traditional Dum Spicy', '{"en": "Traditional Dum Spicy"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000044', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000013', 'Extra Mirchi Salan', '{"en": "Extra Mirchi Salan"}'::jsonb, 0, true, 3),

    -- G14: Biryani Add-ons
    ('f7762b6a-0000-0000-0000-000000000045', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000014', 'Extra Cucumber Mint Raita', '{"en": "Extra Cucumber Mint Raita"}'::jsonb, 3000, true, 1),
    ('f7762b6a-0000-0000-0000-000000000046', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000014', 'Double Fried Onions (Barista)', '{"en": "Double Fried Onions (Barista)"}'::jsonb, 2000, true, 2),
    ('f7762b6a-0000-0000-0000-000000000047', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000014', 'Extra Boiled Egg', '{"en": "Extra Boiled Egg"}'::jsonb, 2500, true, 3),

    -- G15: Bread Finishing
    ('f7762b6a-0000-0000-0000-000000000048', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000015', 'No Butter (Dry)', '{"en": "No Butter (Dry)"}'::jsonb, 0, true, 1),
    ('f7762b6a-0000-0000-0000-000000000049', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000015', 'Regular Butter Brush', '{"en": "Regular Butter Brush"}'::jsonb, 0, true, 2),
    ('f7762b6a-0000-0000-0000-000000000050', '7762b6af-d052-4e74-b917-39e3c56e7914', '97762b6a-0000-0000-0000-000000000015', 'Crispy / Well Done', '{"en": "Crispy / Well Done"}'::jsonb, 0, true, 3)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    price_paise = EXCLUDED.price_paise,
    sort_order = EXCLUDED.sort_order;

COMMIT;



BEGIN;

-- 1. Insert Filter Coffee if not exists
INSERT INTO menu_items (id, org_id, outlet_id, category_id, name, name_i18n, description_i18n, price_paise, veg_type, allergens, is_available, is_active, sort_order, prep_time_min, calories, spice_level)
VALUES (
    'f117e000-0000-0000-0000-000000000009',
    '7762b6af-d052-4e74-b917-39e3c56e7914',
    '71ad00a6-d79b-4035-b563-bf9543fcfa86',
    'c29a6484-f8e6-430f-a508-458835738384',
    'Filter Coffee',
    '{"en": "Filter Coffee", "hi": "फ़िल्टर कॉफ़ी"}'::jsonb,
    '{"en": "Traditional South Indian hot freshly brewed decoction coffee."}'::jsonb,
    7900,
    'VEG',
    ARRAY['DAIRY']::text[],
    true,
    true,
    1,
    5,
    80,
    0
)
ON CONFLICT (id) DO UPDATE SET
    price_paise = EXCLUDED.price_paise,
    spice_level = 0,
    is_active = true;

-- 2. Deduplicate: For each dish name in this org, keep 1 row active and set others to is_active = false
WITH ranked AS (
    SELECT id, name,
           ROW_NUMBER() OVER (
               PARTITION BY name 
               ORDER BY (id IN (SELECT menu_item_id FROM order_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914')) DESC,
                        created_at ASC
           ) as rn
    FROM menu_items
    WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914'
)
UPDATE menu_items
SET is_active = (ranked.rn = 1)
FROM ranked
WHERE menu_items.id = ranked.id;

-- 3. Ensure Desserts and Beverages spice_level = 0
UPDATE menu_items 
SET spice_level = 0 
WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' 
  AND category_id IN ('5ab8fbd2-fb97-4d22-b39d-7abfbae30003', 'c29a6484-f8e6-430f-a508-458835738384');

-- 4. Clear any old item_modifier_groups for this org
DELETE FROM item_modifier_groups WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914';

-- 5. Insert item_modifier_groups for Royal Spice Bistro dishes
-- Group IDs:
-- 97762b6a-0000-0000-0000-000000000001 : Sweetness Level (Dessert)
-- 97762b6a-0000-0000-0000-000000000002 : Serving Temp (Dessert)
-- 97762b6a-0000-0000-0000-000000000003 : Dessert Garnish & Add-ons (Extra Rabri +40, Extra Pistachios +30, Without Nuts)
-- 97762b6a-0000-0000-0000-000000000004 : Sugar Preference (Hot Bev)
-- 97762b6a-0000-0000-0000-000000000005 : Milk & Decoction Strength (Oat Milk +30, Almond Milk +35, Strong, Med, Light)
-- 97762b6a-0000-0000-0000-000000000006 : Hot Serving Temp
-- 97762b6a-0000-0000-0000-000000000007 : Sweet / Salt Style (Cold Bev) (Mango Puree Float +25)
-- 97762b6a-0000-0000-0000-000000000008 : Ice Level (Cold Bev)
-- 97762b6a-0000-0000-0000-000000000009 : Spice Preference (Starters)
-- 97762b6a-0000-0000-0000-000000000010 : Chef Kitchen Instructions (Starters) (Extra Mint Chutney +20)
-- 97762b6a-0000-0000-0000-000000000011 : Spice Level (Curries)
-- 97762b6a-0000-0000-0000-000000000012 : Kitchen Preparation & Add-ons (Curries) (Extra Butter +25, Extra Cream +20)
-- 97762b6a-0000-0000-0000-000000000013 : Spice Level (Biryani)
-- 97762b6a-0000-0000-0000-000000000014 : Biryani Add-ons (Extra Raita +30, Double Fried Onions +20, Extra Boiled Egg +25)
-- 97762b6a-0000-0000-0000-000000000015 : Bread Finishing (No Butter, Butter Brush, Crispy)

-- Starters
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000009', '7762b6af-d052-4e74-b917-39e3c56e7914', 1 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '346a9e9d-16da-4208-9bc0-d1b6511e3a43';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000010', '7762b6af-d052-4e74-b917-39e3c56e7914', 2 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '346a9e9d-16da-4208-9bc0-d1b6511e3a43';

-- Main Course / Curries
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000011', '7762b6af-d052-4e74-b917-39e3c56e7914', 1 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '520971ee-0197-4393-9c7e-4e952e615c74';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000012', '7762b6af-d052-4e74-b917-39e3c56e7914', 2 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '520971ee-0197-4393-9c7e-4e952e615c74';

-- Biryani & Rice
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000013', '7762b6af-d052-4e74-b917-39e3c56e7914', 1 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = 'f7d97403-9667-4414-92af-8cbb339867aa' AND name != 'Jeera Rice';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000014', '7762b6af-d052-4e74-b917-39e3c56e7914', 2 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = 'f7d97403-9667-4414-92af-8cbb339867aa';

-- Breads
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000015', '7762b6af-d052-4e74-b917-39e3c56e7914', 1 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '4abccfd5-faeb-434c-b9c0-93c73617cf51';

-- Desserts (Gulab Jamun, Rasmalai, Mango Kulfi)
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000001', '7762b6af-d052-4e74-b917-39e3c56e7914', 1 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '5ab8fbd2-fb97-4d22-b39d-7abfbae30003';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000002', '7762b6af-d052-4e74-b917-39e3c56e7914', 2 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '5ab8fbd2-fb97-4d22-b39d-7abfbae30003';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000003', '7762b6af-d052-4e74-b917-39e3c56e7914', 3 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = '5ab8fbd2-fb97-4d22-b39d-7abfbae30003';

-- Hot Beverages (Filter Coffee)
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000004', '7762b6af-d052-4e74-b917-39e3c56e7914', 1 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND name ILIKE '%Coffee%';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000005', '7762b6af-d052-4e74-b917-39e3c56e7914', 2 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND name ILIKE '%Coffee%';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000006', '7762b6af-d052-4e74-b917-39e3c56e7914', 3 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND name ILIKE '%Coffee%';

-- Cold Beverages (Mango Lassi, Masala Chaas, Fresh Lime Soda)
INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000007', '7762b6af-d052-4e74-b917-39e3c56e7914', 1 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = 'c29a6484-f8e6-430f-a508-458835738384' AND name NOT ILIKE '%Coffee%';

INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
SELECT id, '97762b6a-0000-0000-0000-000000000008', '7762b6af-d052-4e74-b917-39e3c56e7914', 2 FROM menu_items WHERE org_id = '7762b6af-d052-4e74-b917-39e3c56e7914' AND is_active = true AND category_id = 'c29a6484-f8e6-430f-a508-458835738384' AND name NOT ILIKE '%Coffee%';

COMMIT;

