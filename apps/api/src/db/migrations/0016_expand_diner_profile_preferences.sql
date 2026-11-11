-- ============================================================================
-- Migration 0016: Expand Diner Profiles Preferences JSONB
-- ============================================================================

ALTER TABLE diner_profiles
  ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Populate default structured preferences for seeded profiles
UPDATE diner_profiles
SET preferences = jsonb_build_object(
  'milkPreference', 'REGULAR_MILK',
  'sugarPreference', 'LESS_SUGAR',
  'hotBeverageTemp', 'EXTRA_HOT',
  'coldBeverageIce', 'LESS_ICE',
  'beverageStrength', 'STRONG_KADAK',
  'onionGarlicPreference', 'WITH_ONION_GARLIC',
  'cookingOilPreference', 'LESS_OIL_BUTTER',
  'crispinessPreference', 'EXTRA_CRISPY',
  'biryaniOnionPreference', 'EXTRA_FRIED_ONIONS',
  'dessertSweetness', 'MILD_SWEET',
  'dessertTemp', 'SERVED_WARM'
)
WHERE name = 'Rahul';

UPDATE diner_profiles
SET preferences = jsonb_build_object(
  'milkPreference', 'OAT_MILK',
  'sugarPreference', 'SUGAR_FREE',
  'hotBeverageTemp', 'REGULAR_HOT',
  'coldBeverageIce', 'NO_ICE',
  'beverageStrength', 'LIGHT_MILD',
  'onionGarlicPreference', 'NO_ONION_GARLIC',
  'cookingOilPreference', 'LESS_OIL_BUTTER',
  'dessertSweetness', 'MILD_SWEET',
  'nutAllergyPreference', 'NO_NUTS_ALLERGY'
)
WHERE name = 'Priya';

UPDATE diner_profiles
SET preferences = jsonb_build_object(
  'milkPreference', 'REGULAR_MILK',
  'sugarPreference', 'JAGGERY',
  'hotBeverageTemp', 'EXTRA_HOT',
  'coldBeverageIce', 'LESS_ICE',
  'beverageStrength', 'STRONG_KADAK',
  'onionGarlicPreference', 'WITH_ONION_GARLIC',
  'biryaniRaitaPreference', 'EXTRA_RAITA_SALAN',
  'dessertSweetness', 'REGULAR_SWEET',
  'dessertTemp', 'SERVED_WARM'
)
WHERE name = 'Dad';

UPDATE diner_profiles
SET preferences = jsonb_build_object(
  'milkPreference', 'REGULAR_MILK',
  'sugarPreference', 'LESS_SUGAR',
  'hotBeverageTemp', 'REGULAR_HOT',
  'beverageStrength', 'MEDIUM_STRENGTH',
  'onionGarlicPreference', 'NO_ONION_GARLIC',
  'cookingOilPreference', 'LESS_OIL_BUTTER',
  'dessertSweetness', 'MILD_SWEET',
  'dessertTemp', 'SERVED_WARM'
)
WHERE name = 'Mom';

