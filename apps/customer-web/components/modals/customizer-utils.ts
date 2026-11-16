import type {
  MenuItem,
  ModifierOption,
  ModifierGroup,
  DinerProfile,
} from '../../types';

// ============================================================================
// Helper Constants & Pure Functions for Dish Customization
// Rule 2.1: Minor units (integer paise) only, no floating-point money.
// ============================================================================

export const CATEGORY_COOK_NOTE_CHIPS: Record<string, string[]> = {
  Beverages: [
    '☕ Strong',
    '🧊 Less Ice',
    '🚫 No Sugar',
    '🍯 Less Sugar',
    '🥛 Oat Milk',
    '🥛 Almond Milk',
    '🔥 Extra Hot',
    '🍯 Jaggery',
  ],
  Desserts: [
    '🍨 Served Warm',
    '❄️ Served Chilled',
    '🍯 Less Sweet',
    '🚫 Without Nuts (Nut Allergy)',
    '🥜 Extra Pistachios & Almonds',
    '✨ Silver Vark',
  ],
  'Biryani & Rice': [
    '🔥 Extra Dum Heat',
    '🥗 Less Oil',
    '🧅 Extra Fried Onions (Birista)',
    '🍚 Extra Salan',
    '🥛 Extra Raita',
    '🚫 No Onion / No Garlic',
    '🍃 Mild Spice',
    '🌶️ Extra Spicy',
  ],
  Breads: [
    '🧈 Extra Butter',
    '🚫 No Butter (Dry)',
    '🔥 Crisp / Well Done',
    '✂️ Cut into 2 Pieces',
    '✂️ Cut into 4 Pieces',
    '🧀 Extra Cheese',
    '🧄 Extra Garlic',
  ],
  Starters: [
    '🔥 Extra Crispy / Charred',
    '🍋 Extra Lemon & Chat Masala',
    '🥗 Less Oil',
    '🧅 Extra Laccha Onions',
    '🍃 Mint Chutney on Side',
    '🌶️ Spicy / Teekha',
    '🍃 Mild / Less Spicy',
    '🚫 No Onion / No Garlic',
  ],
  'Main Course': [
    '🥗 Less Oil / Butter',
    '🧈 Extra Butter Gravy',
    '🍃 Mild Gravy',
    '🌶️ Spicy Gravy',
    '🧄 Extra Garlic Tadka',
    '🚫 No Onion / No Garlic',
    '🥣 Thicker Gravy',
    '🥣 Thinner Gravy',
  ],
};

export const MUTUALLY_EXCLUSIVE_CHIP_CLUSTERS: string[][] = [
  ['🚫 No Sugar', '🍯 Less Sugar', '🍯 Less Sweet'],
  ['🔥 Extra Hot', '🧊 Less Ice', '🍨 Served Warm', '❄️ Served Chilled'],
  ['🌶️ Extra Spicy', '🍃 Mild / Less Spicy', '🍃 Mild Spice'],
  ['🧈 Extra Butter', '🧈 Butter Brushed', '🥗 Less Oil / Butter', '🥗 Less Oil', '🚫 No Butter (Dry)', '🍃 Plain / No Butter'],
  ['🔥 Extra Dum Heat'],
];

export function toggleChipInNotes(curNotes: string, chip: string): string {
  const cur = (curNotes || '').trim();
  if (cur.includes(chip)) {
    return cur.replace(chip, '').replace(/\s+/g, ' ').trim();
  }
  const cluster = MUTUALLY_EXCLUSIVE_CHIP_CLUSTERS.find((c) => c.includes(chip));
  let cleaned = cur;
  if (cluster) {
    cluster.forEach((conflicting) => {
      if (conflicting !== chip && cleaned.includes(conflicting)) {
        cleaned = cleaned.replace(conflicting, '').replace(/\s+/g, ' ').trim();
      }
    });
  }
  return cleaned ? `${cleaned} ${chip}` : chip;
}

export function resolveItemModifierGroups(item: MenuItem): ModifierGroup[] {
  if (item.modifierGroups && item.modifierGroups.length > 0) {
    return item.modifierGroups;
  }
  if (!item.modifiers || item.modifiers.length === 0) {
    return [];
  }

  const sugarKeywords = ['sugar', 'jaggery', 'gud', 'sweet'];
  const tempKeywords = ['hot', 'warm', 'cold', 'chill', 'ice', 'temperature'];
  const strengthKeywords = ['kadak', 'strength', 'strong', 'light', 'mild brew', 'decoction'];
  const spiceKeywords = ['low spice', 'medium spice', 'spicy / teekha', 'teekha'];

  const sugarMods: ModifierOption[] = [];
  const tempMods: ModifierOption[] = [];
  const strengthMods: ModifierOption[] = [];
  const spiceMods: ModifierOption[] = [];
  const otherMods: ModifierOption[] = [];

  for (const m of item.modifiers) {
    const n = m.name.toLowerCase();
    if (sugarKeywords.some((k) => n.includes(k))) {
      sugarMods.push({ ...m, groupId: 'grp-sugar', groupName: 'Sugar Preference' });
    } else if (tempKeywords.some((k) => n.includes(k))) {
      tempMods.push({ ...m, groupId: 'grp-temp', groupName: 'Serving Temperature' });
    } else if (strengthKeywords.some((k) => n.includes(k)) && !n.includes('milk')) {
      strengthMods.push({ ...m, groupId: 'grp-strength', groupName: 'Milk & Decoction Strength' });
    } else if (spiceKeywords.some((k) => n.includes(k))) {
      spiceMods.push({ ...m, groupId: 'grp-spice', groupName: 'Spice Level' });
    } else {
      otherMods.push(m);
    }
  }

  const groups: ModifierGroup[] = [];

  if (strengthMods.length > 0) {
    groups.push({
      id: 'grp-strength',
      name: 'Milk & Decoction Strength',
      selectionType: 'SINGLE',
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      modifiers: strengthMods,
    });
  }

  if (tempMods.length > 0) {
    groups.push({
      id: 'grp-temp',
      name: 'Serving Temperature',
      selectionType: 'SINGLE',
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      modifiers: tempMods,
    });
  }

  if (sugarMods.length > 0) {
    groups.push({
      id: 'grp-sugar',
      name: 'Sugar Preference',
      selectionType: 'SINGLE',
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      modifiers: sugarMods,
    });
  }

  if (spiceMods.length > 0) {
    groups.push({
      id: 'grp-spice',
      name: 'Spice Level',
      selectionType: 'SINGLE',
      minSelections: 1,
      maxSelections: 1,
      isRequired: true,
      modifiers: spiceMods,
    });
  }

  if (otherMods.length > 0) {
    groups.push({
      id: `grp-addons-${item.id}`,
      name: item.modifiers.some((m) => m.pricePaise > 0) ? 'Recommended Add-ons & Extras' : 'Customization Options',
      selectionType: 'MULTIPLE',
      minSelections: 0,
      maxSelections: otherMods.length,
      isRequired: false,
      modifiers: otherMods.map((m) => ({ ...m, groupId: `grp-addons-${item.id}` })),
    });
  }

  return groups;
}

export const isPortionApplicable = (item: MenuItem): boolean => {
  if (
    item.category === 'Combos' ||
    item.category === 'Desserts' ||
    item.category === 'Beverages' ||
    item.category === 'Breads'
  ) {
    return false;
  }
  const nameLower = item.name.toLowerCase();
  if (nameLower.includes('steamed basmati rice') || nameLower.includes('plain rice')) {
    return false;
  }
  return (
    item.category === 'Biryani & Rice' ||
    item.category === 'Main Course' ||
    item.category === 'Starters'
  );
};

export const getPortionPricing = (item: MenuItem) => {
  const fullPaise = item.pricePaise;
  // Standard restaurant portion economics: Half plate is ~62% of full price rounded to nearest ₹10 (1000 paise)
  const halfPaise = item.halfPricePaise || Math.round((fullPaise * 0.62) / 1000) * 1000;
  const upgradeDiffPaise = Math.max(1000, fullPaise - halfPaise);
  return {
    fullPaise,
    halfPaise,
    upgradeDiffPaise,
  };
};

export const getNotePlaceholder = (category: string): string => {
  if (category === 'Beverages') return 'Specific note (e.g. no sugar, less ice, oat milk)...';
  if (category === 'Desserts') return 'Specific note (e.g. serve warm, no pistachios)...';
  if (category === 'Breads') return 'Specific note (e.g. well toasted, cut into halves)...';
  return 'Specific note for kitchen (e.g. less salt, well done)...';
};

export function applyProfileToContext(
  profile: DinerProfile,
  context: {
    category: string;
    itemName: string;
    availableModifierGroups?: ModifierGroup[];
  }
): {
  appliedName: string;
  spiceLevel: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
  selectedModifiers: ModifierOption[];
  chefNotes: string;
  toastMessage: string;
} {
  const p = profile.preferences || {};
  const cat = context.category || '';
  const itemLower = (context.itemName || '').toLowerCase();

  const isBeverage =
    cat === 'Beverages' ||
    itemLower.includes('coffee') ||
    itemLower.includes('tea') ||
    itemLower.includes('lassi') ||
    itemLower.includes('soda') ||
    itemLower.includes('chaas') ||
    itemLower.includes('shake');
  const isHotDrink = itemLower.includes('coffee') || itemLower.includes('tea') || itemLower.includes('kadak');
  const isColdDrink = itemLower.includes('lassi') || itemLower.includes('soda') || itemLower.includes('chaas') || itemLower.includes('cold');
  const isDessert =
    cat === 'Desserts' ||
    itemLower.includes('jamun') ||
    itemLower.includes('rabri') ||
    itemLower.includes('rasmalai') ||
    itemLower.includes('kulfi') ||
    itemLower.includes('halwa');
  const isBiryani =
    cat === 'Biryani & Rice' ||
    itemLower.includes('biryani') ||
    itemLower.includes('pulao') ||
    itemLower.includes('rice');
  const isStarter = cat === 'Starters' || itemLower.includes('tikka') || itemLower.includes('kebab') || itemLower.includes('fry');
  const isBread = cat === 'Breads' || itemLower.includes('naan') || itemLower.includes('roti') || itemLower.includes('paratha');

  const appliedName = profile.name.toLowerCase().includes('plate') ? profile.name : `${profile.name}'s Plate`;
  const selectedMods: ModifierOption[] = [];
  const notesList: string[] = [];
  let spiceLevel: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE' = 'MEDIUM';
  let toastMessage = `Applied ${profile.name}'s preferences 👨‍🍳`;

  if (isBeverage) {
    spiceLevel = 'NONE';
    const groups = context.availableModifierGroups || [];

    const sugarGrp = groups.find((g) => g.name.toLowerCase().includes('sugar') || g.id.includes('sugar'));
    if (sugarGrp && sugarGrp.modifiers.length > 0) {
      let targetMod: ModifierOption | undefined;
      if (p.sugarPreference === 'SUGAR_FREE') {
        targetMod = sugarGrp.modifiers.find((m) => m.name.toLowerCase().includes('free') || m.name.toLowerCase().includes('no sugar'));
      } else if (p.sugarPreference === 'LESS_SUGAR') {
        targetMod = sugarGrp.modifiers.find((m) => m.name.toLowerCase().includes('less'));
      } else if (p.sugarPreference === 'JAGGERY') {
        targetMod = sugarGrp.modifiers.find((m) => m.name.toLowerCase().includes('jaggery') || m.name.toLowerCase().includes('gud'));
      } else {
        targetMod = sugarGrp.modifiers.find((m) => m.name.toLowerCase().includes('regular'));
      }
      if (targetMod) selectedMods.push(targetMod);
    }

    if (isHotDrink) {
      const tempGrp = groups.find((g) => g.name.toLowerCase().includes('temp') || g.id.includes('temp'));
      if (tempGrp && tempGrp.modifiers.length > 0) {
        const targetTemp =
          p.hotBeverageTemp === 'EXTRA_HOT'
            ? tempGrp.modifiers.find((m) => m.name.toLowerCase().includes('extra hot'))
            : tempGrp.modifiers.find((m) => m.name.toLowerCase().includes('regular hot'));
        if (targetTemp) selectedMods.push(targetTemp);
      }
    }

    const strengthGrp = groups.find(
      (g) => g.name.toLowerCase().includes('strength') || g.name.toLowerCase().includes('milk') || g.id.includes('strength')
    );
    if (strengthGrp && strengthGrp.modifiers.length > 0) {
      if (p.milkPreference === 'OAT_MILK') {
        const oat = strengthGrp.modifiers.find((m) => m.name.toLowerCase().includes('oat'));
        if (oat) selectedMods.push(oat);
      } else if (p.milkPreference === 'ALMOND_MILK') {
        const almond = strengthGrp.modifiers.find((m) => m.name.toLowerCase().includes('almond'));
        if (almond) selectedMods.push(almond);
      } else if (p.beverageStrength === 'STRONG_KADAK') {
        const strong = strengthGrp.modifiers.find((m) => m.name.toLowerCase().includes('strong') || m.name.toLowerCase().includes('kadak'));
        if (strong) selectedMods.push(strong);
      } else if (p.beverageStrength === 'LIGHT_MILD') {
        const light = strengthGrp.modifiers.find((m) => m.name.toLowerCase().includes('light') || m.name.toLowerCase().includes('mild'));
        if (light) selectedMods.push(light);
      }
    }

    if (p.sugarPreference === 'SUGAR_FREE') notesList.push('Sugar-Free');
    else if (p.sugarPreference === 'LESS_SUGAR') notesList.push('Less Sugar');
    else if (p.sugarPreference === 'JAGGERY') notesList.push('Jaggery (Gud)');
    if (isHotDrink && p.hotBeverageTemp === 'EXTRA_HOT') notesList.push('Extra Hot');
    if (p.milkPreference === 'OAT_MILK') notesList.push('Oat Milk');
    if (p.beverageStrength === 'STRONG_KADAK') notesList.push('Strong / Kadak');
    if (isColdDrink && p.coldBeverageIce === 'NO_ICE') notesList.push('No Ice');
    else if (isColdDrink && p.coldBeverageIce === 'LESS_ICE') notesList.push('Less Ice');

    toastMessage = `Applied ${profile.name}'s beverage preferences (${notesList.join(', ') || 'Custom'}) ☕`;
  } else if (isDessert) {
    spiceLevel = 'NONE';
    const groups = context.availableModifierGroups || [];

    const nutMod = groups
      .flatMap((g) => g.modifiers)
      .find((m) => {
        const mn = m.name.toLowerCase();
        if (p.nutAllergyPreference === 'NO_NUTS_ALLERGY') return mn.includes('without nuts') || mn.includes('allergy');
        if (p.nutAllergyPreference === 'EXTRA_NUTS') return mn.includes('extra') && (mn.includes('nut') || mn.includes('pistachio'));
        return false;
      });
    if (nutMod) selectedMods.push(nutMod);

    const tempMod = groups
      .flatMap((g) => g.modifiers)
      .find((m) => {
        const mn = m.name.toLowerCase();
        if (p.dessertTemp === 'SERVED_WARM') return mn.includes('warm');
        if (p.dessertTemp === 'SERVED_CHILLED') return mn.includes('chilled');
        return false;
      });
    if (tempMod) selectedMods.push(tempMod);

    if (p.nutAllergyPreference === 'NO_NUTS_ALLERGY') notesList.push('No Nuts (Nut Allergy)');
    if (p.dessertTemp === 'SERVED_WARM') notesList.push('Served Warm');
    else if (p.dessertTemp === 'SERVED_CHILLED') notesList.push('Served Chilled');
    if (p.dessertSweetness === 'MILD_SWEET') notesList.push('Mild Sweetness');

    toastMessage = `Applied ${profile.name}'s dessert preferences (${notesList.join(', ') || 'Standard'}) 🍨`;
  } else if (isBiryani) {
    spiceLevel = (profile.spicePreference as string) === 'EXTRA_SPICY' ? 'HOT' : (profile.spicePreference || 'MEDIUM');
    if (p.onionGarlicPreference === 'NO_ONION_GARLIC') notesList.push('No Onion / Garlic (Jain)');
    if (p.cookingOilPreference === 'LESS_OIL_BUTTER') notesList.push('Less Butter / Oil');
    if (p.biryaniOnionPreference === 'EXTRA_FRIED_ONIONS') notesList.push('Extra Fried Onions (Birista)');
    if (p.biryaniRaitaPreference === 'EXTRA_RAITA_SALAN') notesList.push('Extra Raita & Salan');
    if (profile.spicePreference === 'MILD') notesList.push('Mild / Less Spicy');
    else if (profile.spicePreference === 'HOT' || (profile.spicePreference as string) === 'EXTRA_SPICY') notesList.push('Extra Dum Spicy');

    toastMessage = `Applied ${profile.name}'s biryani preferences (${profile.spicePreference} spice) 🍛`;
  } else if (isStarter) {
    spiceLevel = (profile.spicePreference as string) === 'EXTRA_SPICY' ? 'HOT' : (profile.spicePreference || 'MEDIUM');
    if (p.crispinessPreference === 'EXTRA_CRISPY') notesList.push('Extra Crispy / Charred');
    if (p.onionGarlicPreference === 'NO_ONION_GARLIC') notesList.push('No Onion / Garlic');
    if (p.cookingOilPreference === 'LESS_OIL_BUTTER') notesList.push('Less Oil');
    if (profile.spicePreference === 'MILD') notesList.push('Mild');
    else if (profile.spicePreference === 'HOT') notesList.push('Extra Spicy');

    toastMessage = `Applied ${profile.name}'s starter preferences (${profile.spicePreference} spice) 🍢`;
  } else if (isBread) {
    spiceLevel = 'NONE';
    if (p.cookingOilPreference === 'LESS_OIL_BUTTER') notesList.push('Without Butter (Dry)');
    if (p.crispinessPreference === 'EXTRA_CRISPY') notesList.push('Crisp Tandoor Bake');

    toastMessage = `Applied ${profile.name}'s bread preferences 🫓`;
  } else {
    spiceLevel = (profile.spicePreference as string) === 'EXTRA_SPICY' ? 'HOT' : (profile.spicePreference || 'MEDIUM');
    if (p.onionGarlicPreference === 'NO_ONION_GARLIC') notesList.push('No Onion / Garlic');
    if (p.cookingOilPreference === 'LESS_OIL_BUTTER') notesList.push('Less Butter / Oil');
    if (profile.spicePreference === 'MILD') notesList.push('Mild Gravy');
    else if (profile.spicePreference === 'HOT') notesList.push('Spicy Gravy');

    toastMessage = `Applied ${profile.name}'s curry preferences (${profile.spicePreference} spice) 🥘`;
  }

  return {
    appliedName,
    spiceLevel,
    selectedModifiers: selectedMods,
    chefNotes: notesList.join(', '),
    toastMessage,
  };
}
