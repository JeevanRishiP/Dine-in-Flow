-- ============================================================================
-- Seed Biryani & Rice Dataset with Modifiers for Dineflow SaaS
-- Tenants:
--   1. Royal Spice Bistro (org_id: 7762b6af-d052-4e74-b917-39e3c56e7914, cat_id: f7d97403-9667-4414-92af-8cbb339867aa)
--   2. Spice Garden (org_id: a0000000-0000-0000-0000-000000000001, cat_id: c0000000-0000-0000-0000-000000000003)
-- ============================================================================

BEGIN;

-- Deactivate older legacy placeholder biryani items to prevent duplicates
UPDATE menu_items 
SET is_active = false 
WHERE id IN (
  '168ca629-5b33-4167-b99d-2c0522fd559a', 
  '4b6e6d0e-0f40-40c0-8ba0-058b6678f65a', 
  '3267acbe-579e-44d9-a135-1f1f31497b93'
);

-- ============================================================================
-- 1. MENU ITEMS
-- ============================================================================
INSERT INTO menu_items (
    id, org_id, category_id, name, name_i18n, description_i18n, 
    price_paise, veg_type, spice_level, prep_time_min, 
    is_available, is_active, sort_order
)
VALUES
    -- ------------------------------------------------------------------------
    -- TENANT 1: Royal Spice Bistro
    -- org_id: 7762b6af-d052-4e74-b917-39e3c56e7914 | cat_id: f7d97403-9667-4414-92af-8cbb339867aa
    -- ------------------------------------------------------------------------
    (
        '1a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Hyderabadi Chicken Dum Biryani', '{"en": "Hyderabadi Chicken Dum Biryani", "hi": "हैदराबादी चिकन दम बिरयानी"}'::jsonb, 
        '{"en": "Authentic long-grain basmati rice layered with spiced chicken, saffron, mint and brown onions, slow-cooked in a sealed handi."}'::jsonb, 
        42000, 'NON_VEG', 2, 25, true, true, 10
    ),
    (
        '1a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Awadhi Gosht / Mutton Biryani', '{"en": "Awadhi Gosht / Mutton Biryani", "hi": "अवधी गोश्त / मटन बिरयानी"}'::jsonb, 
        '{"en": "Tender pieces of mutton cooked with fragrant spices and basmati rice in the traditional Awadhi style."}'::jsonb, 
        52000, 'NON_VEG', 2, 30, true, true, 20
    ),
    (
        '1a000000-0000-4000-8000-000000000103', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Royal Veg Dum Biryani', '{"en": "Royal Veg Dum Biryani", "hi": "रॉयल वेज दम बिरयानी"}'::jsonb, 
        '{"en": "Garden fresh vegetables marinated in yogurt and spices, layered with basmati rice and cooked on dum."}'::jsonb, 
        34000, 'VEG', 1, 20, true, true, 30
    ),
    (
        '1a000000-0000-4000-8000-000000000104', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Prawn Dum Biryani', '{"en": "Prawn Dum Biryani", "hi": "प्रॉन दम बिरयानी"}'::jsonb, 
        '{"en": "Juicy prawns tossed in coastal spices, slow-cooked with aromatic basmati rice."}'::jsonb, 
        56000, 'NON_VEG', 2, 25, true, true, 40
    ),
    (
        '1a000000-0000-4000-8000-000000000105', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Ande Ki Dum Biryani (Egg Biryani)', '{"en": "Ande Ki Dum Biryani (Egg Biryani)", "hi": "अंडे की दम बिरयानी"}'::jsonb, 
        '{"en": "Hard-boiled eggs roasted in spices, layered with saffron rice and caramelized onions."}'::jsonb, 
        36000, 'NON_VEG', 2, 20, true, true, 50
    ),
    (
        '1a000000-0000-4000-8000-000000000106', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Paneer Makhani Biryani', '{"en": "Paneer Makhani Biryani", "hi": "पनीर मखनी बिरयानी"}'::jsonb, 
        '{"en": "Cottage cheese chunks cooked in rich creamy tomato gravy, layered with dum rice."}'::jsonb, 
        38000, 'VEG', 1, 20, true, true, 60
    ),
    (
        '1a000000-0000-4000-8000-000000000107', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Jeera Ghee Rice', '{"en": "Jeera Ghee Rice", "hi": "जीरा घी राइस"}'::jsonb, 
        '{"en": "Basmati rice tempered with roasted cumin seeds and pure desi ghee."}'::jsonb, 
        19000, 'VEG', 0, 15, true, true, 70
    ),
    (
        '1a000000-0000-4000-8000-000000000108', '7762b6af-d052-4e74-b917-39e3c56e7914', 'f7d97403-9667-4414-92af-8cbb339867aa', 
        'Steamed Basmati Rice', '{"en": "Steamed Basmati Rice", "hi": "उबले हुए बासमती चावल"}'::jsonb, 
        '{"en": "Long-grain aromatic basmati rice, perfectly steamed."}'::jsonb, 
        14000, 'VEG', 0, 15, true, true, 80
    ),

    -- ------------------------------------------------------------------------
    -- TENANT 2: Spice Garden
    -- org_id: a0000000-0000-0000-0000-000000000001 | cat_id: c0000000-0000-0000-0000-000000000003
    -- ------------------------------------------------------------------------
    (
        '1b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Hyderabadi Chicken Dum Biryani', '{"en": "Hyderabadi Chicken Dum Biryani", "hi": "हैदराबादी चिकन दम बिरयानी"}'::jsonb, 
        '{"en": "Authentic long-grain basmati rice layered with spiced chicken, saffron, mint and brown onions, slow-cooked in a sealed handi."}'::jsonb, 
        42000, 'NON_VEG', 2, 25, true, true, 10
    ),
    (
        '1b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Awadhi Gosht / Mutton Biryani', '{"en": "Awadhi Gosht / Mutton Biryani", "hi": "अवधी गोश्त / मटन बिरयानी"}'::jsonb, 
        '{"en": "Tender pieces of mutton cooked with fragrant spices and basmati rice in the traditional Awadhi style."}'::jsonb, 
        52000, 'NON_VEG', 2, 30, true, true, 20
    ),
    (
        '1b000000-0000-4000-8000-000000000203', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Royal Veg Dum Biryani', '{"en": "Royal Veg Dum Biryani", "hi": "रॉयल वेज दम बिरयानी"}'::jsonb, 
        '{"en": "Garden fresh vegetables marinated in yogurt and spices, layered with basmati rice and cooked on dum."}'::jsonb, 
        34000, 'VEG', 1, 20, true, true, 30
    ),
    (
        '1b000000-0000-4000-8000-000000000204', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Prawn Dum Biryani', '{"en": "Prawn Dum Biryani", "hi": "प्रॉन दम बिरयानी"}'::jsonb, 
        '{"en": "Juicy prawns tossed in coastal spices, slow-cooked with aromatic basmati rice."}'::jsonb, 
        56000, 'NON_VEG', 2, 25, true, true, 40
    ),
    (
        '1b000000-0000-4000-8000-000000000205', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Ande Ki Dum Biryani (Egg Biryani)', '{"en": "Ande Ki Dum Biryani (Egg Biryani)", "hi": "अंडे की दम बिरयानी"}'::jsonb, 
        '{"en": "Hard-boiled eggs roasted in spices, layered with saffron rice and caramelized onions."}'::jsonb, 
        36000, 'NON_VEG', 2, 20, true, true, 50
    ),
    (
        '1b000000-0000-4000-8000-000000000206', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Paneer Makhani Biryani', '{"en": "Paneer Makhani Biryani", "hi": "पनीर मखनी बिरयानी"}'::jsonb, 
        '{"en": "Cottage cheese chunks cooked in rich creamy tomato gravy, layered with dum rice."}'::jsonb, 
        38000, 'VEG', 1, 20, true, true, 60
    ),
    (
        '1b000000-0000-4000-8000-000000000207', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Jeera Ghee Rice', '{"en": "Jeera Ghee Rice", "hi": "जीरा घी राइस"}'::jsonb, 
        '{"en": "Basmati rice tempered with roasted cumin seeds and pure desi ghee."}'::jsonb, 
        19000, 'VEG', 0, 15, true, true, 70
    ),
    (
        '1b000000-0000-4000-8000-000000000208', 'a0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000003', 
        'Steamed Basmati Rice', '{"en": "Steamed Basmati Rice", "hi": "उबले हुए बासमती चावल"}'::jsonb, 
        '{"en": "Long-grain aromatic basmati rice, perfectly steamed."}'::jsonb, 
        14000, 'VEG', 0, 15, true, true, 80
    )
ON CONFLICT (id) DO UPDATE SET
    category_id = EXCLUDED.category_id,
    name = EXCLUDED.name,
    name_i18n = EXCLUDED.name_i18n,
    description_i18n = EXCLUDED.description_i18n,
    price_paise = EXCLUDED.price_paise,
    veg_type = EXCLUDED.veg_type,
    spice_level = EXCLUDED.spice_level,
    prep_time_min = EXCLUDED.prep_time_min,
    is_available = EXCLUDED.is_available,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 2. MODIFIER GROUPS
-- ============================================================================
INSERT INTO modifier_groups (
    id, org_id, name, name_i18n, 
    selection_type, min_selections, max_selections, is_required, is_active
)
VALUES
    -- TENANT 1
    (
        '2a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 
        'Raita Selection', '{"en": "Raita Selection"}'::jsonb, 
        'MULTIPLE', 0, 3, false, true
    ),
    (
        '2a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 
        'Biryani Add-ons & Gravies', '{"en": "Biryani Add-ons & Gravies"}'::jsonb, 
        'MULTIPLE', 0, 5, false, true
    ),
    -- TENANT 2
    (
        '2b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 
        'Raita Selection', '{"en": "Raita Selection"}'::jsonb, 
        'MULTIPLE', 0, 3, false, true
    ),
    (
        '2b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 
        'Biryani Add-ons & Gravies', '{"en": "Biryani Add-ons & Gravies"}'::jsonb, 
        'MULTIPLE', 0, 5, false, true
    )
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    name_i18n = EXCLUDED.name_i18n,
    selection_type = EXCLUDED.selection_type,
    min_selections = EXCLUDED.min_selections,
    max_selections = EXCLUDED.max_selections,
    is_required = EXCLUDED.is_required,
    is_active = EXCLUDED.is_active;

-- ============================================================================
-- 3. MODIFIERS
-- ============================================================================
INSERT INTO modifiers (
    id, org_id, group_id, name, name_i18n, 
    price_paise, is_available, sort_order
)
VALUES
    -- TENANT 1: Raita Selection (Group 1)
    ('3a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', '2a000000-0000-4000-8000-000000000101', 'Burani Garlic Raita', '{"en": "Burani Garlic Raita"}'::jsonb, 4000, true, 10),
    ('3a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', '2a000000-0000-4000-8000-000000000101', 'Boondi Raita', '{"en": "Boondi Raita"}'::jsonb, 3000, true, 20),
    
    -- TENANT 1: Biryani Add-ons & Gravies (Group 2)
    ('3a000000-0000-4000-8000-000000000103', '7762b6af-d052-4e74-b917-39e3c56e7914', '2a000000-0000-4000-8000-000000000102', 'Extra Mirchi Ka Salan', '{"en": "Extra Mirchi Ka Salan"}'::jsonb, 3500, true, 10),
    ('3a000000-0000-4000-8000-000000000104', '7762b6af-d052-4e74-b917-39e3c56e7914', '2a000000-0000-4000-8000-000000000102', 'Golden Fried Barista Onions', '{"en": "Golden Fried Barista Onions"}'::jsonb, 2500, true, 20),
    ('3a000000-0000-4000-8000-000000000105', '7762b6af-d052-4e74-b917-39e3c56e7914', '2a000000-0000-4000-8000-000000000102', 'Extra Desi Ghee Dollop', '{"en": "Extra Desi Ghee Dollop"}'::jsonb, 3000, true, 30),
    ('3a000000-0000-4000-8000-000000000106', '7762b6af-d052-4e74-b917-39e3c56e7914', '2a000000-0000-4000-8000-000000000102', 'Boiled Egg (1 pc)', '{"en": "Boiled Egg (1 pc)"}'::jsonb, 2000, true, 40),
    ('3a000000-0000-4000-8000-000000000107', '7762b6af-d052-4e74-b917-39e3c56e7914', '2a000000-0000-4000-8000-000000000102', 'Extra Gravy Cup', '{"en": "Extra Gravy Cup"}'::jsonb, 3500, true, 50),

    -- TENANT 2: Raita Selection (Group 1)
    ('3b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', '2b000000-0000-4000-8000-000000000201', 'Burani Garlic Raita', '{"en": "Burani Garlic Raita"}'::jsonb, 4000, true, 10),
    ('3b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', '2b000000-0000-4000-8000-000000000201', 'Boondi Raita', '{"en": "Boondi Raita"}'::jsonb, 3000, true, 20),
    
    -- TENANT 2: Biryani Add-ons & Gravies (Group 2)
    ('3b000000-0000-4000-8000-000000000203', 'a0000000-0000-0000-0000-000000000001', '2b000000-0000-4000-8000-000000000202', 'Extra Mirchi Ka Salan', '{"en": "Extra Mirchi Ka Salan"}'::jsonb, 3500, true, 10),
    ('3b000000-0000-4000-8000-000000000204', 'a0000000-0000-0000-0000-000000000001', '2b000000-0000-4000-8000-000000000202', 'Golden Fried Barista Onions', '{"en": "Golden Fried Barista Onions"}'::jsonb, 2500, true, 20),
    ('3b000000-0000-4000-8000-000000000205', 'a0000000-0000-0000-0000-000000000001', '2b000000-0000-4000-8000-000000000202', 'Extra Desi Ghee Dollop', '{"en": "Extra Desi Ghee Dollop"}'::jsonb, 3000, true, 30),
    ('3b000000-0000-4000-8000-000000000206', 'a0000000-0000-0000-0000-000000000001', '2b000000-0000-4000-8000-000000000202', 'Boiled Egg (1 pc)', '{"en": "Boiled Egg (1 pc)"}'::jsonb, 2000, true, 40),
    ('3b000000-0000-4000-8000-000000000207', 'a0000000-0000-0000-0000-000000000001', '2b000000-0000-4000-8000-000000000202', 'Extra Gravy Cup', '{"en": "Extra Gravy Cup"}'::jsonb, 3500, true, 50)
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    name_i18n = EXCLUDED.name_i18n,
    price_paise = EXCLUDED.price_paise,
    is_available = EXCLUDED.is_available,
    sort_order = EXCLUDED.sort_order;

-- ============================================================================
-- 4. ITEM MODIFIER GROUPS (Mappings)
-- ============================================================================
INSERT INTO item_modifier_groups (
    item_id, group_id, org_id, sort_order
)
VALUES
    -- TENANT 1 Mappings (Attaching Raita & Gravies to the 6 Biryanis)
    ('1a000000-0000-4000-8000-000000000101', '2a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 1),
    ('1a000000-0000-4000-8000-000000000101', '2a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 2),
    ('1a000000-0000-4000-8000-000000000102', '2a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 1),
    ('1a000000-0000-4000-8000-000000000102', '2a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 2),
    ('1a000000-0000-4000-8000-000000000103', '2a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 1),
    ('1a000000-0000-4000-8000-000000000103', '2a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 2),
    ('1a000000-0000-4000-8000-000000000104', '2a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 1),
    ('1a000000-0000-4000-8000-000000000104', '2a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 2),
    ('1a000000-0000-4000-8000-000000000105', '2a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 1),
    ('1a000000-0000-4000-8000-000000000105', '2a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 2),
    ('1a000000-0000-4000-8000-000000000106', '2a000000-0000-4000-8000-000000000101', '7762b6af-d052-4e74-b917-39e3c56e7914', 1),
    ('1a000000-0000-4000-8000-000000000106', '2a000000-0000-4000-8000-000000000102', '7762b6af-d052-4e74-b917-39e3c56e7914', 2),

    -- TENANT 2 Mappings (Attaching Raita & Gravies to the 6 Biryanis)
    ('1b000000-0000-4000-8000-000000000201', '2b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 1),
    ('1b000000-0000-4000-8000-000000000201', '2b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 2),
    ('1b000000-0000-4000-8000-000000000202', '2b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 1),
    ('1b000000-0000-4000-8000-000000000202', '2b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 2),
    ('1b000000-0000-4000-8000-000000000203', '2b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 1),
    ('1b000000-0000-4000-8000-000000000203', '2b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 2),
    ('1b000000-0000-4000-8000-000000000204', '2b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 1),
    ('1b000000-0000-4000-8000-000000000204', '2b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 2),
    ('1b000000-0000-4000-8000-000000000205', '2b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 1),
    ('1b000000-0000-4000-8000-000000000205', '2b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 2),
    ('1b000000-0000-4000-8000-000000000206', '2b000000-0000-4000-8000-000000000201', 'a0000000-0000-0000-0000-000000000001', 1),
    ('1b000000-0000-4000-8000-000000000206', '2b000000-0000-4000-8000-000000000202', 'a0000000-0000-0000-0000-000000000001', 2)
ON CONFLICT (item_id, group_id) DO UPDATE SET
    sort_order = EXCLUDED.sort_order;

COMMIT;

