import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  getPortionPricing,
  isPortionApplicable,
  resolveItemModifierGroups,
  toggleChipInNotes,
  applyProfileToContext,
} from './customizer-utils.ts';
import type { MenuItem, DinerProfile } from '../../types/index.ts';
import { useOrderStore } from '../../store/useOrderStore.ts';

const SAMPLE_BIRYANI: MenuItem = {
  id: 'item-dum-biryani-1',
  name: 'Hyderabadi Chicken Dum Biryani',
  description: 'Aromatic basmati rice slow-cooked with royal spices and chicken.',
  category: 'Biryani & Rice',
  pricePaise: 38000, // ₹380
  dietaryTag: 'NON_VEG',
  spiceLevel: 'MEDIUM',
  cuisine: 'SOUTH_INDIAN',
  isHealthy: false,
  isAvailable: true,
  rating: 4.8,
  ordersCount: 1420,
  prepTimeMinutes: 25,
  imageUrl: 'https://example.com/biryani.jpg',
  modifiers: [
    { id: 'mod-salan', name: 'Extra Mirchi Ka Salan', pricePaise: 4000 },
    { id: 'mod-raita', name: 'Extra Boondi Raita', pricePaise: 3000 },
  ],
};

const SAMPLE_COFFEE: MenuItem = {
  id: 'item-filter-coffee',
  name: 'South Indian Filter Coffee',
  description: 'Strong chicory decoction frothed with fresh milk.',
  category: 'Beverages',
  pricePaise: 12000, // ₹120
  dietaryTag: 'VEG',
  spiceLevel: 'NONE',
  cuisine: 'SOUTH_INDIAN',
  isHealthy: false,
  isAvailable: true,
  rating: 4.9,
  ordersCount: 850,
  prepTimeMinutes: 5,
  imageUrl: 'https://example.com/coffee.jpg',
  modifiers: [
    { id: 'mod-sugar-free', name: 'Sugar-Free', pricePaise: 0 },
    { id: 'mod-jaggery', name: 'Jaggery Sweetened', pricePaise: 2000 },
    { id: 'mod-kadak', name: 'Extra Kadak Strong', pricePaise: 0 },
    { id: 'mod-oat-milk', name: 'Oat Milk Substitute', pricePaise: 5000 },
  ],
};

describe('ItemCustomizerModal pure functions & pricing economics', () => {
  it('computes portion pricing strictly in minor units (paise) with restaurant economics', () => {
    const pricing = getPortionPricing(SAMPLE_BIRYANI);
    assert.strictEqual(pricing.fullPaise, 38000);
    // 38000 * 0.62 = 23560, rounded to nearest 1000 => 24000 paise (₹240)
    assert.strictEqual(pricing.halfPaise, 24000);
    assert.strictEqual(pricing.upgradeDiffPaise, 14000);
    assert.strictEqual(Number.isInteger(pricing.fullPaise), true);
    assert.strictEqual(Number.isInteger(pricing.halfPaise), true);
  });

  it('correctly determines whether portion sizing applies based on dish category and name', () => {
    assert.strictEqual(isPortionApplicable(SAMPLE_BIRYANI), true);
    assert.strictEqual(isPortionApplicable(SAMPLE_COFFEE), false);

    const plainRice: MenuItem = {
      ...SAMPLE_BIRYANI,
      id: 'plain-rice-1',
      name: 'Steamed Plain Rice',
    };
    assert.strictEqual(isPortionApplicable(plainRice), false);
  });

  it('resolves item modifier groups clustering single-select vs multi-select add-ons', () => {
    const coffeeGroups = resolveItemModifierGroups(SAMPLE_COFFEE);
    assert.ok(coffeeGroups.length > 0);

    const sugarGroup = coffeeGroups.find((g) => g.id === 'grp-sugar');
    assert.ok(sugarGroup);
    assert.strictEqual(sugarGroup?.selectionType, 'SINGLE');
    assert.strictEqual(sugarGroup?.isRequired, true);
    assert.ok(sugarGroup?.modifiers.some((m) => m.name.includes('Sugar-Free')));

    const biryaniGroups = resolveItemModifierGroups(SAMPLE_BIRYANI);
    const addonsGroup = biryaniGroups.find((g) => g.selectionType === 'MULTIPLE');
    assert.ok(addonsGroup);
    assert.strictEqual(addonsGroup?.isRequired, false);
    assert.strictEqual(addonsGroup?.modifiers.length, 2);
  });

  it('manages mutually exclusive cook note chip clusters cleanly without conflicts', () => {
    let note = toggleChipInNotes('', '🚫 No Sugar');
    assert.strictEqual(note, '🚫 No Sugar');

    // Toggling conflicting '🍯 Less Sugar' should replace '🚫 No Sugar'
    note = toggleChipInNotes(note, '🍯 Less Sugar');
    assert.strictEqual(note, '🍯 Less Sugar');
    assert.strictEqual(note.includes('🚫 No Sugar'), false);

    // Toggling the same chip again should remove it
    note = toggleChipInNotes(note, '🍯 Less Sugar');
    assert.strictEqual(note, '');
  });

  it('intelligently applies diner profile preferences contextually to biryani dishes', () => {
    const profile: DinerProfile = {
      id: 'prof-dad-1',
      name: "Dad's Plate",
      spicePreference: 'MILD',
      kitchenInstructions: ['Less Oil', 'No Onion / Garlic'],
      preferences: {
        spicePreference: 'MILD',
        onionGarlicPreference: 'NO_ONION_GARLIC',
        biryaniOnionPreference: 'EXTRA_FRIED_ONIONS',
        cookingOilPreference: 'LESS_OIL_BUTTER',
      },
    };

    const applied = applyProfileToContext(profile, {
      category: SAMPLE_BIRYANI.category,
      itemName: SAMPLE_BIRYANI.name,
      availableModifierGroups: resolveItemModifierGroups(SAMPLE_BIRYANI),
    });

    assert.strictEqual(applied.appliedName, "Dad's Plate");
    assert.strictEqual(applied.spiceLevel, 'MILD');
    assert.ok(applied.chefNotes.includes('No Onion / Garlic'));
    assert.ok(applied.chefNotes.includes('Extra Fried Onions'));
  });

  it('dispatches customized item cart line directly into useOrderStore', () => {
    useOrderStore.getState().clearCart();
    assert.strictEqual(useOrderStore.getState().cartLines.length, 0);

    const { fullPaise } = getPortionPricing(SAMPLE_BIRYANI);

    useOrderStore.getState().addCartLine({
      cartLineId: 'test-cart-line-1',
      item: { ...SAMPLE_BIRYANI, pricePaise: fullPaise },
      portion: 'FULL',
      plateLabel: "Rishi's Plate",
      quantity: 1,
      spiceLevel: 'HOT',
      notes: 'Extra Dum Spicy',
      selectedModifiers: [
        { id: 'mod-salan', name: 'Extra Mirchi Ka Salan', pricePaise: 4000 },
      ],
    });

    const lines = useOrderStore.getState().cartLines;
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0]!.item.name, 'Hyderabadi Chicken Dum Biryani');
    assert.strictEqual(lines[0]!.plateLabel, "Rishi's Plate");
    assert.strictEqual(lines[0]!.spiceLevel, 'HOT');
    assert.strictEqual(lines[0]!.selectedModifiers[0]!.pricePaise, 4000);

    // Total should be 38000 + 4000 = 42000 paise (₹420)
    assert.strictEqual(useOrderStore.getState().getCartSubtotalPaise(), 42000);
  });
});
