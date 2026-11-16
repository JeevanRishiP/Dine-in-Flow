export const DEFAULT_CATEGORIES = [
  'Combos',
  'Starters',
  'Main Course',
  'Biryani & Rice',
  'Breads',
  'Desserts',
  'Beverages',
] as const;

export type MenuCategory = (typeof DEFAULT_CATEGORIES)[number];
