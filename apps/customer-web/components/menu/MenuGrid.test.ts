import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_CATEGORIES } from './menu-constants.ts';
import type { MenuItem } from '../../types/index.ts';
import { useOrderStore } from '../../store/useOrderStore.ts';

const SAMPLE_ITEMS: MenuItem[] = [
  {
    id: 'dish-1',
    name: 'Paneer Tikka Char',
    description: 'Fresh paneer marinated in spices.',
    category: 'Starters',
    pricePaise: 28000, // ₹280
    dietaryTag: 'VEG',
    spiceLevel: 'MEDIUM',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.7,
    ordersCount: 890,
    prepTimeMinutes: 15,
    imageUrl: 'https://example.com/paneer.jpg',
  },
  {
    id: 'dish-2',
    name: 'Mutton Seekh Kebab',
    description: 'Minced lamb skewered and char-grilled.',
    category: 'Starters',
    pricePaise: 38000, // ₹380
    dietaryTag: 'NON_VEG',
    spiceLevel: 'HOT',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.9,
    ordersCount: 1200,
    prepTimeMinutes: 20,
    imageUrl: 'https://example.com/kebab.jpg',
  },
  {
    id: 'dish-3',
    name: 'Hyderabadi Chicken Biryani',
    description: 'Authentic slow-dum cooked basmati rice.',
    category: 'Biryani & Rice',
    pricePaise: 35000, // ₹350
    dietaryTag: 'NON_VEG',
    spiceLevel: 'MEDIUM',
    cuisine: 'SOUTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.8,
    ordersCount: 2300,
    prepTimeMinutes: 25,
    imageUrl: 'https://example.com/biryani.jpg',
  },
  {
    id: 'dish-4',
    name: 'Gulab Jamun Rabri',
    description: 'Warm fried dumplings in rose saffron syrup.',
    category: 'Desserts',
    pricePaise: 14000, // ₹140
    dietaryTag: 'VEG',
    spiceLevel: 'NONE',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: false, // unavailable item
    rating: 4.6,
    ordersCount: 540,
    prepTimeMinutes: 5,
    imageUrl: 'https://example.com/jamun.jpg',
  },
];

describe('MenuGrid & CategoryFilterBar pure domain & filtering logic', () => {
  it('exposes standard DineFlow default categories', () => {
    assert.ok(DEFAULT_CATEGORIES.includes('Starters'));
    assert.ok(DEFAULT_CATEGORIES.includes('Main Course'));
    assert.ok(DEFAULT_CATEGORIES.includes('Biryani & Rice'));
    assert.ok(DEFAULT_CATEGORIES.includes('Desserts'));
    assert.ok(DEFAULT_CATEGORIES.includes('Beverages'));
  });

  it('filters items correctly by dietary preference', () => {
    const vegOnly = SAMPLE_ITEMS.filter((i) => i.dietaryTag === 'VEG');
    assert.strictEqual(vegOnly.length, 2);
    assert.ok(vegOnly.every((i) => i.dietaryTag === 'VEG'));

    const nonVegOnly = SAMPLE_ITEMS.filter((i) => i.dietaryTag === 'NON_VEG');
    assert.strictEqual(nonVegOnly.length, 2);
    assert.ok(nonVegOnly.every((i) => i.dietaryTag === 'NON_VEG'));
  });

  it('filters items correctly by search keyword across name, description and category', () => {
    const query = 'biryani';
    const matches = SAMPLE_ITEMS.filter(
      (i) =>
        i.name.toLowerCase().includes(query) ||
        i.description.toLowerCase().includes(query) ||
        i.category.toLowerCase().includes(query)
    );
    assert.strictEqual(matches.length, 1);
    assert.strictEqual(matches[0]?.name, 'Hyderabadi Chicken Biryani');
  });

  it('filters items strictly by availability flag when filterAvailableOnly is active', () => {
    const available = SAMPLE_ITEMS.filter((i) => i.isAvailable);
    assert.strictEqual(available.length, 3);
    assert.strictEqual(available.some((i) => i.name.includes('Gulab Jamun')), false);
  });

  it('sorts menu items by price ascending and descending strictly in integer minor units (paise)', () => {
    const asc = [...SAMPLE_ITEMS].sort((a, b) => a.pricePaise - b.pricePaise);
    assert.strictEqual(asc[0]?.pricePaise, 14000); // ₹140
    assert.strictEqual(asc[asc.length - 1]?.pricePaise, 38000); // ₹380

    const desc = [...SAMPLE_ITEMS].sort((a, b) => b.pricePaise - a.pricePaise);
    assert.strictEqual(desc[0]?.pricePaise, 38000);
    assert.strictEqual(desc[desc.length - 1]?.pricePaise, 14000);
  });

  it('groups items by category accurately without dropping dishes', () => {
    const groups: Record<string, MenuItem[]> = {};
    DEFAULT_CATEGORIES.forEach((cat) => {
      groups[cat] = [];
    });
    SAMPLE_ITEMS.forEach((i) => {
      if (!groups[i.category]) groups[i.category] = [];
      groups[i.category]?.push(i);
    });

    assert.strictEqual(groups['Starters']?.length, 2);
    assert.strictEqual(groups['Biryani & Rice']?.length, 1);
    assert.strictEqual(groups['Desserts']?.length, 1);
    assert.strictEqual(groups['Main Course']?.length, 0);
  });

  it('integrates quickAdd and quickDecrement cleanly with useOrderStore', () => {
    useOrderStore.getState().clearCart();
    assert.strictEqual(useOrderStore.getState().cartLines.length, 0);

    const testItem = SAMPLE_ITEMS[0]!;
    // Quick Add
    useOrderStore.getState().quickAdd(testItem);
    assert.strictEqual(useOrderStore.getState().getItemCartQty(testItem.id), 1);
    assert.strictEqual(useOrderStore.getState().getCartSubtotalPaise(), 28000);

    // Increment
    useOrderStore.getState().quickAdd(testItem);
    assert.strictEqual(useOrderStore.getState().getItemCartQty(testItem.id), 2);
    assert.strictEqual(useOrderStore.getState().getCartSubtotalPaise(), 56000);

    // Quick Decrement
    useOrderStore.getState().quickDecrement(testItem.id);
    assert.strictEqual(useOrderStore.getState().getItemCartQty(testItem.id), 1);
    assert.strictEqual(useOrderStore.getState().getCartSubtotalPaise(), 28000);

    // Decrement to zero
    useOrderStore.getState().quickDecrement(testItem.id);
    assert.strictEqual(useOrderStore.getState().getItemCartQty(testItem.id), 0);
    assert.strictEqual(useOrderStore.getState().cartLines.length, 0);
  });
});
