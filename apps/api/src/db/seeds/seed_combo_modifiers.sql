-- ============================================================================
-- Seed Combo Modifiers for Extra Plates & Add-ons
-- ============================================================================

DO $$
DECLARE
  v_org_rsb uuid := '7762b6af-d052-4e74-b917-39e3c56e7914';
  v_org_sg  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_grp_rsb uuid := 'dd000000-0000-4000-8000-000000000001';
  v_grp_sg  uuid := 'dd000000-0000-4000-8000-000000000002';
  v_combo_ids uuid[] := ARRAY[
    'cb000000-0000-4000-8000-000000000001'::uuid,
    'cb000000-0000-4000-8000-000000000002'::uuid,
    'cb000000-0000-4000-8000-000000000003'::uuid,
    'cb000000-0000-4000-8000-000000000004'::uuid,
    'cb000000-0000-4000-8000-000000000005'::uuid,
    'cb000000-0000-4000-8000-000000000006'::uuid
  ];
  cid uuid;
BEGIN
  -- Insert modifier group for RSB and SG
  INSERT INTO modifier_groups (id, org_id, name, selection_type, min_selections, max_selections, is_required, is_active)
  VALUES
    (v_grp_rsb, v_org_rsb, 'Combo Extra Plates & Add-ons', 'MULTIPLE', 0, 10, false, true),
    (v_grp_sg,  v_org_sg,  'Combo Extra Plates & Add-ons', 'MULTIPLE', 0, 10, false, true)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, max_selections = 10, is_active = true;

  -- Insert modifiers for RSB
  INSERT INTO modifiers (id, org_id, group_id, name, price_paise, is_available, sort_order)
  VALUES
    ('dd000000-0000-4000-8000-000000000011', v_org_rsb, v_grp_rsb, 'Extra Plate: Hyderabadi Chicken Dum Biryani', 26000, true, 1),
    ('dd000000-0000-4000-8000-000000000012', v_org_rsb, v_grp_rsb, 'Extra Plate: Dal Makhani Bukhara', 26000, true, 2),
    ('dd000000-0000-4000-8000-000000000013', v_org_rsb, v_grp_rsb, 'Extra Plate: Paneer Butter Masala', 31000, true, 3),
    ('dd000000-0000-4000-8000-000000000014', v_org_rsb, v_grp_rsb, 'Extra Plate: Butter Chicken', 37000, true, 4),
    ('dd000000-0000-4000-8000-000000000015', v_org_rsb, v_grp_rsb, 'Extra Plate: Awadhi Gosht Biryani', 42000, true, 5),
    ('dd000000-0000-4000-8000-000000000016', v_org_rsb, v_grp_rsb, 'Extra Plate: Tandoori Chicken Tikka', 31000, true, 6),
    ('dd000000-0000-4000-8000-000000000017', v_org_rsb, v_grp_rsb, 'Extra Butter Naan', 6000, true, 7),
    ('dd000000-0000-4000-8000-000000000018', v_org_rsb, v_grp_rsb, 'Extra Refreshing Drink', 7900, true, 8),
    ('dd000000-0000-4000-8000-000000000019', v_org_rsb, v_grp_rsb, 'Extra Warm Gulab Jamun', 6000, true, 9),
    ('dd000000-0000-4000-8000-000000000020', v_org_rsb, v_grp_rsb, 'Upgrade to Garlic Naan', 2000, true, 10)
  ON CONFLICT (id) DO UPDATE SET price_paise = EXCLUDED.price_paise, name = EXCLUDED.name, is_available = true;

  -- Link group to all combo items
  FOREACH cid IN ARRAY v_combo_ids LOOP
    INSERT INTO item_modifier_groups (item_id, group_id, org_id, sort_order)
    VALUES (cid, v_grp_rsb, v_org_rsb, 1)
    ON CONFLICT (item_id, group_id) DO NOTHING;
  END LOOP;
END $$;
