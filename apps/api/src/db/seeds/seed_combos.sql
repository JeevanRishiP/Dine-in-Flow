-- ============================================================================
-- Seed Curated Chef's Value Combos (10% Discounted Bundles)
-- Supports Royal Spice Bistro & Spice Garden tenants
-- ============================================================================

DO $$
DECLARE
  v_org_rsb uuid := '7762b6af-d052-4e74-b917-39e3c56e7914';
  v_org_sg  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_cat_rsb uuid := 'c0000000-0000-4000-8000-000000000001';
  v_cat_sg  uuid := 'c0000000-0000-4000-8000-000000000002';
BEGIN
  -- 1. Insert 'Combos' category with sort_order = 0 (Placed FIRST before Starters)
  INSERT INTO menu_categories (id, org_id, name, name_i18n, sort_order, is_active)
  VALUES 
    (v_cat_rsb, v_org_rsb, 'Combos', '{"en": "Combos & Feasts", "hi": "कॉम्बो थाली"}'::jsonb, 0, true),
    (v_cat_sg,  v_org_sg,  'Combos', '{"en": "Combos & Feasts", "hi": "कॉम्बो थाली"}'::jsonb, 0, true)
  ON CONFLICT (id) DO UPDATE SET 
    name = EXCLUDED.name,
    sort_order = 0,
    is_active = true;

  -- 2. Insert Combo Menu Items for Royal Spice Bistro (RSB)
  INSERT INTO menu_items (
    id, org_id, category_id, name, name_i18n, description_i18n, price_paise,
    veg_type, allergens, is_available, is_active, sort_order, prep_time_min,
    spice_level, rating, orders_count
  ) VALUES
    (
      'cb000000-0000-4000-8000-000000000001',
      v_org_rsb,
      v_cat_rsb,
      'Solo Executive Biryani Box',
      '{"en": "Solo Executive Biryani Box", "hi": "सोलो बिरयानी बॉक्स"}'::jsonb,
      '{"en": "1× Hyderabadi Chicken Dum Biryani, 1× Burani Garlic Raita & Mirchi Salan, 1× Chilled Masala Chaas, and 1× Warm Gulab Jamun. (A-la-carte ₹630 · Save ₹61)"}'::jsonb,
      56900,
      'NON_VEG',
      ARRAY['DAIRY'],
      true, true, 1, 15, 1, 4.9, 840
    ),
    (
      'cb000000-0000-4000-8000-000000000002',
      v_org_rsb,
      v_cat_rsb,
      'Delhi Highway Veg Thali Combo',
      '{"en": "Delhi Highway Veg Thali Combo", "hi": "दिल्ली हाईवे वेज थाली"}'::jsonb,
      '{"en": "1× Dal Makhani (slow-cooked 24 hrs), 1× Paneer Butter Masala, 2× Tandoori Butter Naan, and 1× Masala Chaas. (A-la-carte ₹940 · Save ₹91)"}'::jsonb,
      84900,
      'VEG',
      ARRAY['DAIRY', 'GLUTEN'],
      true, true, 2, 15, 1, 4.8, 620
    ),
    (
      'cb000000-0000-4000-8000-000000000003',
      v_org_rsb,
      v_cat_rsb,
      'Classic North Indian Curry Duo (Couple Feast)',
      '{"en": "Classic North Indian Curry Duo (Couple Feast)", "hi": "क्लासिक करी डुओ (2 व्यक्ति)"}'::jsonb,
      '{"en": "1× Velvety Butter Chicken, 1× Dal Makhani, 2× Butter Naan, 2× Refreshing Beverages, and 2× Warm Gulab Jamun. (A-la-carte ₹1,300 · Save ₹131)"}'::jsonb,
      116900,
      'NON_VEG',
      ARRAY['DAIRY', 'NUTS', 'GLUTEN'],
      true, true, 3, 20, 1, 4.9, 910
    ),
    (
      'cb000000-0000-4000-8000-000000000004',
      v_org_rsb,
      v_cat_rsb,
      'Royal Nawabi Biryani Feast (2-3 Pax)',
      '{"en": "Royal Nawabi Biryani Feast (2-3 Pax)", "hi": "रॉयल नवाबी बिरयानी दावत"}'::jsonb,
      '{"en": "1× Chicken Dum Biryani, 1× Awadhi Mutton Biryani, 1× Chicken Tikka starter, 2× Burani Raitas & Salan, and 2× Masala Chaas. (A-la-carte ₹1,580 · Save ₹161)"}'::jsonb,
      141900,
      'NON_VEG',
      ARRAY['DAIRY'],
      true, true, 4, 25, 2, 4.9, 750
    ),
    (
      'cb000000-0000-4000-8000-000000000005',
      v_org_rsb,
      v_cat_rsb,
      'Shahi Family Grand Feast (4-5 Pax)',
      '{"en": "Shahi Family Grand Feast (4-5 Pax)", "hi": "शाही फैमिली दावत (4-5 व्यक्ति)"}'::jsonb,
      '{"en": "1× Paneer Tikka, 1× Chicken Tikka, 1× Butter Chicken, 1× Dal Makhani, 1× Chicken Biryani, 4× Butter Naan, 4× Drinks, and 4× Sweets. (A-la-carte ₹3,100 · Save ₹311)"}'::jsonb,
      278900,
      'NON_VEG',
      ARRAY['DAIRY', 'NUTS', 'GLUTEN'],
      true, true, 5, 25, 1, 4.9, 430
    ),
    (
      'cb000000-0000-4000-8000-000000000006',
      v_org_rsb,
      v_cat_rsb,
      'Kebab & Curry Speed Lunch',
      '{"en": "Kebab & Curry Speed Lunch", "hi": "कबाब एंड करी लंच"}'::jsonb,
      '{"en": "1× Charcoal Grilled Chicken Tikka, 1× Dal Makhani, 2× Tandoori Roti, and 1× Fresh Lime Soda. (A-la-carte ₹900 · Save ₹91)"}'::jsonb,
      80900,
      'NON_VEG',
      ARRAY['DAIRY', 'GLUTEN'],
      true, true, 6, 15, 1, 4.8, 510
    )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    name_i18n = EXCLUDED.name_i18n,
    description_i18n = EXCLUDED.description_i18n,
    price_paise = EXCLUDED.price_paise,
    veg_type = EXCLUDED.veg_type,
    prep_time_min = EXCLUDED.prep_time_min,
    rating = EXCLUDED.rating,
    orders_count = EXCLUDED.orders_count,
    is_available = true,
    is_active = true;

END $$;
