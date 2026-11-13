'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  buildSignedQrTokenFromSearch,
  extractUrlTableAndOutlet,
  fetchOutletTableDirectory,
  fetchCurrentGuestSessionRemote,
  openSignedTableSession,
  openManualTableSession,
  type GuestSessionState,
  loadGuestSession,
  clearGuestSession,
  loadCustomerAuth,
  saveCustomerAuth,
  clearCustomerAuth,
  refreshCustomerSessionRemote,
  logoutCustomerRemote,
  resolveTenantIds,
  customerApiFetch,
  sanitizeTableDigits,
  matchHotelTable,
  type OutletTableInfo,
} from './lib/guest-session';

// ============================================================================
// Types & Data Models
// ============================================================================

export interface ModifierOption {
  id: string;
  name: string;
  pricePaise: number;
  groupId?: string;
  groupName?: string;
}

export interface ModifierGroup {
  id: string;
  name: string;
  selectionType: 'SINGLE' | 'MULTIPLE';
  minSelections: number;
  maxSelections: number;
  isRequired: boolean;
  modifiers: ModifierOption[];
}

export interface MenuItem {
  id: string;
  name: string;
  description: string;
  category: 'Combos' | 'Starters' | 'Main Course' | 'Biryani & Rice' | 'Breads' | 'Desserts' | 'Beverages';
  pricePaise: number;
  halfPricePaise?: number;
  dietaryTag: 'VEG' | 'NON_VEG';
  spiceLevel: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
  cuisine: 'NORTH_INDIAN' | 'SOUTH_INDIAN' | 'OTHER';
  isHealthy: boolean;
  isAvailable: boolean;
  rating: number;
  ordersCount: number;
  prepTimeMinutes: number;
  imageUrl: string;
  modifiers?: ModifierOption[];
  modifierGroups?: ModifierGroup[];
}

export interface DinerPreferences {
  // Food & Savory
  spicePreference?: 'MILD' | 'MEDIUM' | 'HOT' | 'EXTRA_SPICY' | 'NONE';
  onionGarlicPreference?: 'WITH_ONION_GARLIC' | 'NO_ONION_GARLIC';
  cookingOilPreference?: 'REGULAR_OIL' | 'LESS_OIL_BUTTER';
  crispinessPreference?: 'REGULAR' | 'EXTRA_CRISPY';
  biryaniRaitaPreference?: 'REGULAR' | 'EXTRA_RAITA_SALAN';
  biryaniOnionPreference?: 'REGULAR' | 'EXTRA_FRIED_ONIONS';

  // Hot & Cold Beverages
  milkPreference?: 'REGULAR_MILK' | 'OAT_MILK' | 'ALMOND_MILK' | 'NO_MILK';
  sugarPreference?: 'REGULAR_SUGAR' | 'LESS_SUGAR' | 'SUGAR_FREE' | 'JAGGERY' | 'EXTRA_SWEET';
  hotBeverageTemp?: 'REGULAR_HOT' | 'EXTRA_HOT';
  coldBeverageIce?: 'REGULAR_ICE' | 'LESS_ICE' | 'NO_ICE';
  beverageStrength?: 'STRONG_KADAK' | 'MEDIUM_STRENGTH' | 'LIGHT_MILD';

  // Desserts
  dessertSweetness?: 'REGULAR_SWEET' | 'MILD_SWEET' | 'EXTRA_SWEET';
  dessertTemp?: 'SERVED_WARM' | 'SERVED_CHILLED' | 'ROOM_TEMP';
  nutAllergyPreference?: 'REGULAR_NUTS' | 'EXTRA_NUTS' | 'NO_NUTS_ALLERGY';
}

export interface DinerProfile {
  id: string;
  name: string;
  relationshipTag?: 'ME' | 'PARTNER' | 'DAD' | 'MOM' | 'CHILD' | 'FRIEND' | 'GUEST';
  spicePreference: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
  dietaryPreference?: 'ANY' | 'VEG' | 'NON_VEG' | 'JAIN' | 'VEGAN';
  kitchenInstructions: string[];
  notes?: string;
  preferences?: DinerPreferences;
}

export interface ComboComponentConfig {
  id: string;
  name: string;
  categoryType: 'MAIN' | 'BREAD' | 'BEVERAGE' | 'DESSERT' | 'STARTER' | 'RICE';
  includedQty: number;
  extraPlatePricePaise: number;
  defaultPortion?: 'FULL' | 'HALF';
  allowPortionSwitch?: boolean;
  fullPricePaise?: number;
  halfPricePaise?: number;
  options?: string[];
  spiceChoice?: boolean;
  modifierId?: string;
}

export interface ComboDishPlate {
  plateId: string;
  plateNumber: number;
  customName: string;
  isExtraPlate: boolean;
  pricePaise: number;
  portion: 'FULL' | 'HALF';
  spice: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
  notes: string;
  selectedModifiers: ModifierOption[];
}

export interface ComboOffer {
  id: string;
  name: string;
  tag: string;
  badge: string;
  comboPricePaise: number;
  originalPricePaise: number;
  savingsPaise: number;
  discountPercent: number;
  vegType: 'VEG' | 'NON_VEG';
  prepTimeMinutes: number;
  rating: number;
  imageUrl: string;
  description: string;
  components: ComboComponentConfig[];
}

export interface CartLineItem {
  cartLineId: string;
  item: MenuItem;
  plateLabel?: string; // e.g. "Plate 1", "Plate 2" for per-plate customisation
  portion?: 'FULL' | 'HALF';
  quantity: number;
  spiceLevel?: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
  notes?: string;
  selectedModifiers: ModifierOption[];
  targetTableId?: string;
  targetTableNumber?: string;
}

interface TableOrderRecord {
  id: string;
  table_number: string;
  status: 'PENDING' | 'PREPARING' | 'CONFIRMED' | 'READY' | 'SERVED' | 'BILLED' | 'CANCELLED';
  subtotal_paise: number;
  tax_paise: number;
  total_paise: number;
  created_at: string;
  payment_status?: 'PAID' | 'PENDING' | 'FAILED' | 'AUTHORIZED' | 'REFUNDED' | null;
  payment_method?: string | null;
  payment_settled_at?: string | null;
  items: Array<{
    id: string;
    name_snapshot: string;
    unit_price_paise: number;
    quantity: number;
    line_total_paise: number;
    notes?: string;
    status?: string;
    created_at?: string;
    target_table_id?: string | null;
    target_table_number?: string | null;
    modifiers?: Array<{
      modifier_id?: string;
      name: string;
      price_paise: number;
    }>;
  }>;
}

interface FlattenedPlateItem {
  plateKey: string;
  orderId: string;
  orderNumber: string;
  tableId?: string | null;
  tableNumber: string;
  orderCreatedAt: string;
  itemCreatedAt: string;
  orderStatus: string;
  isPaid: boolean;
  paymentMethod: string | null;
  paymentSettledAt: string | null;
  itemId: string;
  itemName: string;
  plateName: string;
  portion: 'FULL' | 'HALF';
  plateIndex: number;
  totalPlatesForLine: number;
  basePricePaise: number;
  modifiers: Array<{ modifier_id?: string; name: string; price_paise: number }>;
  modifiersTotalPaise: number;
  plateTotalPaise: number;
  spiceLevel: string | null;
  kitchenNote: string | null;
  rawNotes?: string;
  isOnHold?: boolean;
  itemStatus?: string;
}

function formatOrderDateTime(iso?: string | null): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isDessertOrPostMealItem(name?: string, notes?: string | null): boolean {
  const str = `${name || ''} ${notes || ''}`.toLowerCase();
  return (
    str.includes('ice cream') ||
    str.includes('kulfi') ||
    str.includes('gulab jamun') ||
    str.includes('halwa') ||
    str.includes('dessert') ||
    str.includes('sweet') ||
    str.includes('rasgulla') ||
    str.includes('filter coffee') ||
    str.includes('masala chai') ||
    str.includes('coffee') ||
    str.includes('tea') ||
    str.includes('warm gulab jamun')
  );
}

function parseOrderItemNotes(notes?: string, itemName?: string) {
  let plateName: string | null = null;
  let portion: 'FULL' | 'HALF' = 'FULL';
  let spiceLevel: string | null = null;
  let kitchenNote: string | null = null;

  const raw = (notes || '').trim();

  // Detect portion
  if (
    /\[HALF\s*PLATE\]/i.test(raw) ||
    /\[HALF\]/i.test(raw) ||
    /\(Half\)/i.test(raw) ||
    (itemName && /\(Half\)/i.test(itemName))
  ) {
    portion = 'HALF';
  }

  // Detect custom plate name in brackets, e.g. [Rahul's Plate] or [Priya] or [Plate 1]
  const bracketMatches = Array.from(raw.matchAll(/\[([^\]]+)\]/g));
  for (const m of bracketMatches) {
    const rawContent = m[1];
    if (!rawContent) continue;
    const content = rawContent.trim();
    if (!/^(HALF\s*PLATE|HALF|FULL|FULL\s*PLATE)$/i.test(content)) {
      plateName = content;
      break;
    }
  }

  // Detect spice level
  const spiceMatch = raw.match(/Spice:\s*([A-Za-z]+)/i);
  if (spiceMatch && spiceMatch[1]) {
    spiceLevel = spiceMatch[1].toUpperCase();
  }

  // Clean note to the kitchen (taste preferences, cooking instructions)
  let cleaned = raw
    .replace(/\[[^\]]+\]/g, '')
    .replace(/Spice:\s*[A-Za-z]+/gi, '')
    .replace(/Add-ons:\s*[^·]+/gi, '')
    .replace(/[·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/^[,.\s]+|[,.\s]+$/g, '');

  if (cleaned.length > 0) {
    kitchenNote = cleaned;
  }

  return { plateName, portion, spiceLevel, kitchenNote };
}

// No fake front-end diner profiles: diner profiles are strictly fetched from and saved to the real database.
const DEFAULT_SAVED_PROFILES: DinerProfile[] = [];

// Helper to intelligently apply a profile's saved preferences contextually to a dish or plate
// Relevant preferences are applied (e.g. Biryani spice & fried onions for biryani; Oat Milk & Sugar-Free for coffee)
function applyProfileToContext(
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
    // ☕ BEVERAGE CONTEXT: strictly beverage preferences, zero food spice
    spiceLevel = 'NONE';
    const groups = context.availableModifierGroups || [];

    // 1. Sugar Preference
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

    // 2. Serving Temp (Hot drinks)
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

    // 3. Milk & Decoction Strength
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

    // Beverage Notes
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
    // 🍨 DESSERT CONTEXT: sweetness, temperature, nuts allergy
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
    // 🍛 BIRYANI CONTEXT: spice, fried onions, raita, jain/oil notes
    spiceLevel = (profile.spicePreference as any) === 'EXTRA_SPICY' ? 'HOT' : profile.spicePreference || 'MEDIUM';
    if (p.onionGarlicPreference === 'NO_ONION_GARLIC') notesList.push('No Onion / Garlic (Jain)');
    if (p.cookingOilPreference === 'LESS_OIL_BUTTER') notesList.push('Less Butter / Oil');
    if (p.biryaniOnionPreference === 'EXTRA_FRIED_ONIONS') notesList.push('Extra Fried Onions (Birista)');
    if (p.biryaniRaitaPreference === 'EXTRA_RAITA_SALAN') notesList.push('Extra Raita & Salan');
    if (profile.spicePreference === 'MILD') notesList.push('Mild / Less Spicy');
    else if (profile.spicePreference === 'HOT' || (profile.spicePreference as any) === 'EXTRA_SPICY') notesList.push('Extra Dum Spicy');

    toastMessage = `Applied ${profile.name}'s biryani preferences (${profile.spicePreference} spice) 🍛`;

  } else if (isStarter) {
    // 🍢 STARTER CONTEXT: spice, crispiness, less oil
    spiceLevel = (profile.spicePreference as any) === 'EXTRA_SPICY' ? 'HOT' : profile.spicePreference || 'MEDIUM';
    if (p.crispinessPreference === 'EXTRA_CRISPY') notesList.push('Extra Crispy / Charred');
    if (p.onionGarlicPreference === 'NO_ONION_GARLIC') notesList.push('No Onion / Garlic');
    if (p.cookingOilPreference === 'LESS_OIL_BUTTER') notesList.push('Less Oil');
    if (profile.spicePreference === 'MILD') notesList.push('Mild');
    else if (profile.spicePreference === 'HOT') notesList.push('Extra Spicy');

    toastMessage = `Applied ${profile.name}'s starter preferences (${profile.spicePreference} spice) 🍢`;

  } else if (isBread) {
    // 🫓 BREAD CONTEXT: butter, crispiness
    spiceLevel = 'NONE';
    if (p.cookingOilPreference === 'LESS_OIL_BUTTER') notesList.push('Without Butter (Dry)');
    if (p.crispinessPreference === 'EXTRA_CRISPY') notesList.push('Crisp Tandoor Bake');

    toastMessage = `Applied ${profile.name}'s bread preferences 🫓`;

  } else {
    // 🥘 CURRIES / MAIN COURSE: spice, oil, onion/garlic
    spiceLevel = (profile.spicePreference as any) === 'EXTRA_SPICY' ? 'HOT' : profile.spicePreference || 'MEDIUM';
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

// Helper to compute portion upgrade or downgrade pricing for combo plates
// Strictly implements Rules 4 & 5 (10% combo discount on upgrade, no combo discount on downgrade)
const getComboPlatePortionDelta = (
  comp: ComboComponentConfig,
  portion: 'FULL' | 'HALF',
): {
  portionDeltaPaise: number;
  diffForFullPlatePaise: number;
  isUpgrade: boolean;
  isDowngrade: boolean;
  label: string;
  fullButtonText: string;
  halfButtonText: string;
} => {
  if (!comp.allowPortionSwitch || !comp.fullPricePaise || !comp.halfPricePaise) {
    return {
      portionDeltaPaise: 0,
      diffForFullPlatePaise: 0,
      isUpgrade: false,
      isDowngrade: false,
      label: portion === 'HALF' ? 'Half Plate' : 'Full Plate',
      fullButtonText: 'Full Plate',
      halfButtonText: 'Half Plate',
    };
  }

  const F = comp.fullPricePaise;
  const H = comp.halfPricePaise;
  const F_combo = Math.round(F * 0.9);
  const H_combo = Math.round(H * 0.9);
  const def = comp.defaultPortion || 'FULL';

  if (def === 'HALF') {
    // Default is Half Plate (Rule 4)
    // Switch to Full Plate with 10% discount on full plate: upgradeDiff = F_combo - H_combo
    const upgradeDiffPaise = Math.max(0, F_combo - H_combo);
    if (portion === 'FULL') {
      return {
        portionDeltaPaise: upgradeDiffPaise,
        diffForFullPlatePaise: upgradeDiffPaise,
        isUpgrade: true,
        isDowngrade: false,
        label: 'Full Plate (Upgraded +10% OFF)',
        fullButtonText: `✓ Full Plate (+₹${(upgradeDiffPaise / 100).toFixed(0)})`,
        halfButtonText: 'Half Plate (Included)',
      };
    } else {
      return {
        portionDeltaPaise: 0,
        diffForFullPlatePaise: upgradeDiffPaise,
        isUpgrade: false,
        isDowngrade: false,
        label: 'Half Plate (Included)',
        fullButtonText: `Full Plate (+₹${(upgradeDiffPaise / 100).toFixed(0)})`,
        halfButtonText: '✓ Half Plate (Included)',
      };
    }
  } else {
    // Default is Full Plate (Rule 5)
    // If downgrade to Half: no combo discount for that item (actual price is H).
    // Difference amount = F_combo - H (e.g. ₹88)
    const diffPaise = Math.max(0, F_combo - H);
    const downgradeCreditPaise = H - F_combo;

    if (portion === 'HALF') {
      // In place of full plate, show difference amount with plus symbol (+₹diff) without full price:
      return {
        portionDeltaPaise: downgradeCreditPaise,
        diffForFullPlatePaise: diffPaise,
        isUpgrade: false,
        isDowngrade: true,
        label: 'Half Plate (A-la-carte)',
        fullButtonText: `Full Plate (+₹${(diffPaise / 100).toFixed(0)})`,
        halfButtonText: `✓ Half Plate (₹${(H / 100).toFixed(0)})`,
      };
    } else {
      return {
        portionDeltaPaise: 0,
        diffForFullPlatePaise: diffPaise,
        isUpgrade: false,
        isDowngrade: false,
        label: 'Full Plate (Included)',
        fullButtonText: '✓ Full Plate (Included in Feast)',
        halfButtonText: diffPaise > 0 ? `Half Plate (-₹${(diffPaise / 100).toFixed(0)})` : 'Half Plate',
      };
    }
  }
};

// Curated 10% Discounted Chef's Value Combos
const COMBO_OFFERS: ComboOffer[] = [
  {
    id: 'cb000000-0000-4000-8000-000000000001',
    name: 'Solo Executive Biryani Box',
    tag: '⚡ SOLO LUNCH',
    badge: '10% OFF · SAVE ₹61',
    comboPricePaise: 56900,
    originalPricePaise: 63000,
    savingsPaise: 6100,
    discountPercent: 10,
    vegType: 'NON_VEG',
    prepTimeMinutes: 15,
    rating: 4.9,
    imageUrl: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80',
    description: '1× Chicken Dum Biryani, 1× Burani Garlic Raita & Salan, 1× Masala Chaas, and 1× Warm Gulab Jamun.',
    components: [
      { id: 'c1-biryani', name: 'Hyderabadi Chicken Dum Biryani', categoryType: 'RICE', includedQty: 1, extraPlatePricePaise: 26000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 32000, halfPricePaise: 20000, modifierId: 'dd000000-0000-4000-8000-000000000011', options: ['Hyderabadi Chicken Dum Biryani', 'Royal Veg Dum Biryani'], spiceChoice: true },
      { id: 'c1-raita', name: 'Burani Garlic Raita & Mirchi Salan', categoryType: 'MAIN', includedQty: 1, extraPlatePricePaise: 4000 },
      { id: 'c1-drink', name: 'Chilled Masala Chaas', categoryType: 'BEVERAGE', includedQty: 1, extraPlatePricePaise: 7900, modifierId: 'dd000000-0000-4000-8000-000000000018', options: ['Masala Chaas', 'Fresh Lime Soda', 'Filter Coffee'] },
      { id: 'c1-sweet', name: 'Warm Gulab Jamun (1 pc)', categoryType: 'DESSERT', includedQty: 1, extraPlatePricePaise: 6000, modifierId: 'dd000000-0000-4000-8000-000000000019' },
    ],
  },
  {
    id: 'cb000000-0000-4000-8000-000000000002',
    name: 'Delhi Highway Veg Thali Combo',
    tag: '🌿 PURE VEG SPECIAL',
    badge: '10% OFF · SAVE ₹91',
    comboPricePaise: 84900,
    originalPricePaise: 94000,
    savingsPaise: 9100,
    discountPercent: 10,
    vegType: 'VEG',
    prepTimeMinutes: 15,
    rating: 4.8,
    imageUrl: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80',
    description: '1× Dal Makhani (slow-cooked 24 hrs), 1× Paneer Butter Masala, 2× Butter Naan, and 1× Masala Chaas.',
    components: [
      { id: 'c2-dal', name: 'Dal Makhani Bukhara', categoryType: 'MAIN', includedQty: 1, extraPlatePricePaise: 26000, defaultPortion: 'HALF', allowPortionSwitch: true, fullPricePaise: 29000, halfPricePaise: 18000, modifierId: 'dd000000-0000-4000-8000-000000000012' },
      { id: 'c2-paneer', name: 'Paneer Butter Masala', categoryType: 'MAIN', includedQty: 1, extraPlatePricePaise: 31000, defaultPortion: 'HALF', allowPortionSwitch: true, fullPricePaise: 34000, halfPricePaise: 21000, modifierId: 'dd000000-0000-4000-8000-000000000013', spiceChoice: true },
      { id: 'c2-bread', name: 'Clay Oven Butter Naan', categoryType: 'BREAD', includedQty: 2, extraPlatePricePaise: 6000, modifierId: 'dd000000-0000-4000-8000-000000000017', options: ['Butter Naan', 'Garlic Naan (+₹20)', 'Tandoori Roti'] },
      { id: 'c2-drink', name: 'Chilled Masala Chaas', categoryType: 'BEVERAGE', includedQty: 1, extraPlatePricePaise: 7900, modifierId: 'dd000000-0000-4000-8000-000000000018', options: ['Masala Chaas', 'Fresh Lime Soda', 'Mango Lassi (+₹30)'] },
    ],
  },
  {
    id: 'cb000000-0000-4000-8000-000000000003',
    name: 'Classic North Indian Curry Duo (Couple Feast)',
    tag: '❤️ COUPLE FEAST (2 PAX)',
    badge: '10% OFF · SAVE ₹131',
    comboPricePaise: 116900,
    originalPricePaise: 130000,
    savingsPaise: 13100,
    discountPercent: 10,
    vegType: 'NON_VEG',
    prepTimeMinutes: 20,
    rating: 4.9,
    imageUrl: 'https://images.unsplash.com/photo-1588166524941-3bf61a9c41db?auto=format&fit=crop&w=600&q=80',
    description: '1× Velvety Butter Chicken, 1× Dal Makhani, 2× Butter Naan, 2× Refreshing Beverages, and 2× Warm Gulab Jamuns.',
    components: [
      { id: 'c3-chicken', name: 'Butter Chicken Velvety Gravy', categoryType: 'MAIN', includedQty: 1, extraPlatePricePaise: 37000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 42000, halfPricePaise: 26000, modifierId: 'dd000000-0000-4000-8000-000000000014', spiceChoice: true },
      { id: 'c3-dal', name: 'Dal Makhani Bukhara', categoryType: 'MAIN', includedQty: 1, extraPlatePricePaise: 26000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 29000, halfPricePaise: 18000, modifierId: 'dd000000-0000-4000-8000-000000000012' },
      { id: 'c3-bread', name: 'Tandoori Butter Naan', categoryType: 'BREAD', includedQty: 2, extraPlatePricePaise: 6000, modifierId: 'dd000000-0000-4000-8000-000000000017', options: ['Butter Naan', 'Garlic Naan (+₹20)'] },
      { id: 'c3-drinks', name: 'Refreshing Beverages (2x)', categoryType: 'BEVERAGE', includedQty: 2, extraPlatePricePaise: 7900, modifierId: 'dd000000-0000-4000-8000-000000000018', options: ['Masala Chaas', 'Fresh Lime Soda', 'Filter Coffee'] },
      { id: 'c3-sweets', name: 'Warm Gulab Jamun (2 pcs)', categoryType: 'DESSERT', includedQty: 1, extraPlatePricePaise: 12000, modifierId: 'dd000000-0000-4000-8000-000000000019' },
    ],
  },
  {
    id: 'cb000000-0000-4000-8000-000000000004',
    name: 'Royal Nawabi Biryani Feast (2-3 Pax)',
    tag: '👑 BIRYANI LOVERS (2-3 PAX)',
    badge: '10% OFF · SAVE ₹161',
    comboPricePaise: 141900,
    originalPricePaise: 158000,
    savingsPaise: 16100,
    discountPercent: 10,
    vegType: 'NON_VEG',
    prepTimeMinutes: 25,
    rating: 4.9,
    imageUrl: 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=600&q=80',
    description: '1× Chicken Dum Biryani, 1× Awadhi Mutton Biryani, 1× Chicken Tikka starter, 2× Burani Raitas & Salan, and 2× Masala Chaas.',
    components: [
      { id: 'c4-cbiryani', name: 'Hyderabadi Chicken Dum Biryani', categoryType: 'RICE', includedQty: 1, extraPlatePricePaise: 34000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 32000, halfPricePaise: 20000, modifierId: 'dd000000-0000-4000-8000-000000000011', spiceChoice: true },
      { id: 'c4-mbiryani', name: 'Awadhi Gosht / Mutton Biryani', categoryType: 'RICE', includedQty: 1, extraPlatePricePaise: 42000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 46000, halfPricePaise: 29000, modifierId: 'dd000000-0000-4000-8000-000000000015', spiceChoice: true },
      { id: 'c4-starter', name: 'Tandoori Chicken Tikka starter', categoryType: 'STARTER', includedQty: 1, extraPlatePricePaise: 31000, defaultPortion: 'HALF', allowPortionSwitch: true, fullPricePaise: 35000, halfPricePaise: 22000, modifierId: 'dd000000-0000-4000-8000-000000000016', spiceChoice: true },
      { id: 'c4-raita', name: 'Burani Garlic Raita & Double Salan', categoryType: 'MAIN', includedQty: 2, extraPlatePricePaise: 4000 },
      { id: 'c4-drinks', name: 'Masala Chaas (2x)', categoryType: 'BEVERAGE', includedQty: 2, extraPlatePricePaise: 7900, modifierId: 'dd000000-0000-4000-8000-000000000018', options: ['Masala Chaas', 'Fresh Lime Soda', 'Filter Coffee'] },
    ],
  },
  {
    id: 'cb000000-0000-4000-8000-000000000005',
    name: 'Shahi Family Grand Feast (4-5 Pax)',
    tag: '👨‍👩‍👧‍👦 FAMILY FEAST (4-5 PAX)',
    badge: '10% OFF · SAVE ₹311',
    comboPricePaise: 278900,
    originalPricePaise: 310000,
    savingsPaise: 31100,
    discountPercent: 10,
    vegType: 'NON_VEG',
    prepTimeMinutes: 25,
    rating: 4.9,
    imageUrl: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=600&q=80',
    description: '1× Paneer Tikka, 1× Chicken Tikka, 1× Butter Chicken, 1× Dal Makhani, 1× Chicken Biryani, 4× Butter Naan, 4× Drinks, and 4× Sweets.',
    components: [
      { id: 'c5-starters', name: 'Tandoori Starters (Paneer & Chicken Tikka)', categoryType: 'STARTER', includedQty: 2, extraPlatePricePaise: 28000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 32000, halfPricePaise: 20000, modifierId: 'dd000000-0000-4000-8000-000000000016' },
      { id: 'c5-curries', name: 'Royal Curries (Butter Chicken & Dal Makhani)', categoryType: 'MAIN', includedQty: 2, extraPlatePricePaise: 34000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 42000, halfPricePaise: 26000, modifierId: 'dd000000-0000-4000-8000-000000000014' },
      { id: 'c5-biryani', name: 'Hyderabadi Chicken Dum Biryani', categoryType: 'RICE', includedQty: 1, extraPlatePricePaise: 34000, defaultPortion: 'FULL', allowPortionSwitch: true, fullPricePaise: 32000, halfPricePaise: 20000, modifierId: 'dd000000-0000-4000-8000-000000000011' },
      { id: 'c5-breads', name: 'Tandoori Butter Naan (4 pcs)', categoryType: 'BREAD', includedQty: 4, extraPlatePricePaise: 6000, modifierId: 'dd000000-0000-4000-8000-000000000017' },
      { id: 'c5-drinks', name: 'Refreshing Beverages (4 drinks)', categoryType: 'BEVERAGE', includedQty: 4, extraPlatePricePaise: 7900, modifierId: 'dd000000-0000-4000-8000-000000000018' },
      { id: 'c5-sweets', name: 'Mithai Platter (2 Gulab Jamun + 2 Rasmalai)', categoryType: 'DESSERT', includedQty: 4, extraPlatePricePaise: 6000, modifierId: 'dd000000-0000-4000-8000-000000000019' },
    ],
  },
  {
    id: 'cb000000-0000-4000-8000-000000000006',
    name: 'Kebab & Curry Speed Lunch',
    tag: '🍢 KEBAB & CURRY LUNCH',
    badge: '10% OFF · SAVE ₹91',
    comboPricePaise: 80900,
    originalPricePaise: 90000,
    savingsPaise: 9100,
    discountPercent: 10,
    vegType: 'NON_VEG',
    prepTimeMinutes: 15,
    rating: 4.8,
    imageUrl: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=600&q=80',
    description: '1× Charcoal Grilled Chicken Tikka, 1× Dal Makhani, 2× Tandoori Roti, and 1× Fresh Lime Soda.',
    components: [
      { id: 'c6-kebab', name: 'Chicken Tikka (Clay Tandoor Char)', categoryType: 'STARTER', includedQty: 1, extraPlatePricePaise: 31000, defaultPortion: 'HALF', allowPortionSwitch: true, fullPricePaise: 35000, halfPricePaise: 22000, modifierId: 'dd000000-0000-4000-8000-000000000016', spiceChoice: true },
      { id: 'c6-dal', name: 'Dal Makhani Bukhara', categoryType: 'MAIN', includedQty: 1, extraPlatePricePaise: 26000, defaultPortion: 'HALF', allowPortionSwitch: true, fullPricePaise: 29000, halfPricePaise: 18000, modifierId: 'dd000000-0000-4000-8000-000000000012' },
      { id: 'c6-breads', name: 'Tandoori Roti (2 pcs)', categoryType: 'BREAD', includedQty: 2, extraPlatePricePaise: 4000, modifierId: 'dd000000-0000-4000-8000-000000000017' },
      { id: 'c6-drink', name: 'Fresh Lime Soda', categoryType: 'BEVERAGE', includedQty: 1, extraPlatePricePaise: 7900, modifierId: 'dd000000-0000-4000-8000-000000000018', options: ['Fresh Lime Soda', 'Masala Chaas', 'Filter Coffee'] },
    ],
  },
];

// Pilot Menu with authentic Awadhi & Indian gastronomy + verified appetizing images
const PILOT_MENU: MenuItem[] = [
  // ── Combos & Feasts (First Category) ──
  ...COMBO_OFFERS.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    category: 'Combos' as const,
    pricePaise: c.comboPricePaise,
    dietaryTag: c.vegType,
    spiceLevel: 'MEDIUM' as const,
    cuisine: 'NORTH_INDIAN' as const,
    isHealthy: false,
    isAvailable: true,
    rating: c.rating,
    ordersCount: 850,
    prepTimeMinutes: c.prepTimeMinutes,
    imageUrl: c.imageUrl,
  })),
  // ── Starters ──
  {
    id: 'item-st-01',
    name: 'Paneer Tikka Charcoal Char',
    description: 'Fresh malai cottage cheese cubes marinated in Kashmiri deghi mirch, hung yogurt & yellow mustard, roasted on clay tandoor.',
    category: 'Starters',
    pricePaise: 28000,
    dietaryTag: 'VEG',
    spiceLevel: 'MEDIUM',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.8,
    ordersCount: 420,
    prepTimeMinutes: 15,
    imageUrl: 'https://images.unsplash.com/photo-1567184109411-b28f27034344?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-mint', name: 'Extra Mint Chutney', pricePaise: 2000 },
      { id: 'mod-cheese', name: 'Melted Cheese Melt', pricePaise: 4000 },
    ],
  },
  {
    id: 'item-st-02',
    name: 'Murgh Malai Kebab',
    description: 'Tender chicken morsels infused with green cardamom, clotted cream, white pepper, and roasted cashew paste.',
    category: 'Starters',
    pricePaise: 34000,
    dietaryTag: 'NON_VEG',
    spiceLevel: 'MILD',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.9,
    ordersCount: 680,
    prepTimeMinutes: 18,
    imageUrl: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-garlic', name: 'Garlic Butter Brush', pricePaise: 2500 },
      { id: 'mod-lemon', name: 'Spicy Masala Onions', pricePaise: 1500 },
    ],
  },
  {
    id: 'item-st-03',
    name: 'Crispy Corn Salt & Pepper',
    description: 'Golden sweet corn kernel tossed with scallions, crushed black pepper, toasted curry leaves, and bell pepper confetti.',
    category: 'Starters',
    pricePaise: 22000,
    dietaryTag: 'VEG',
    spiceLevel: 'MEDIUM',
    cuisine: 'OTHER',
    isHealthy: true,
    isAvailable: true,
    rating: 4.7,
    ordersCount: 310,
    prepTimeMinutes: 12,
    imageUrl: 'https://images.unsplash.com/photo-1551782450-a2132b4ba21d?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-lime', name: 'Extra Chaat Lime', pricePaise: 1000 },
    ],
  },
  {
    id: 'item-st-04',
    name: 'Tandoori Jumbo Prawns',
    description: 'Fresh coastal prawns marinated in yellow mustard, carom seeds, lime zest, and cooked over glowing charcoal.',
    category: 'Starters',
    pricePaise: 45000,
    dietaryTag: 'NON_VEG',
    spiceLevel: 'HOT',
    cuisine: 'NORTH_INDIAN',
    isHealthy: true,
    isAvailable: true,
    rating: 4.9,
    ordersCount: 290,
    prepTimeMinutes: 20,
    imageUrl: 'https://images.unsplash.com/photo-1559737558-2f5a35f4523b?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-butter', name: 'Herbed Garlic Butter', pricePaise: 3500 },
    ],
  },
  {
    id: 'item-st-05',
    name: 'Awadhi Dahi Ke Kebab',
    description: 'Silky melt-in-mouth hung yogurt patties stuffed with pomegranate gems, fresh mint, and mild green chili.',
    category: 'Starters',
    pricePaise: 27000,
    dietaryTag: 'VEG',
    spiceLevel: 'MILD',
    cuisine: 'NORTH_INDIAN',
    isHealthy: true,
    isAvailable: true,
    rating: 4.8,
    ordersCount: 340,
    prepTimeMinutes: 14,
    imageUrl: 'https://images.unsplash.com/photo-1540420773420-3366772f4999?auto=format&fit=crop&w=600&q=80',
  },

  // ── Main Course ──
  {
    id: 'item-mc-01',
    name: 'Dal Makhani Bukhara',
    description: 'Slow-simmered black lentils cooked overnight for 18 hours with vine-ripened tomatoes and churned white butter.',
    category: 'Main Course',
    pricePaise: 26000,
    dietaryTag: 'VEG',
    spiceLevel: 'MILD',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 5.0,
    ordersCount: 950,
    prepTimeMinutes: 10,
    imageUrl: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-cream', name: 'Extra Clotted Cream', pricePaise: 3000 },
    ],
  },
  {
    id: 'item-mc-02',
    name: 'Old Delhi Butter Chicken',
    description: 'Smoked pulled chicken tikka simmered in silky tomato-fenugreek gravy finished with honey and homemade white butter.',
    category: 'Main Course',
    pricePaise: 38000,
    dietaryTag: 'NON_VEG',
    spiceLevel: 'MILD',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.9,
    ordersCount: 1100,
    prepTimeMinutes: 15,
    imageUrl: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-boneless', name: '100% Boneless Cuts', pricePaise: 4000 },
      { id: 'mod-gravy', name: 'Extra Velvet Gravy', pricePaise: 5000 },
    ],
  },
  {
    id: 'item-mc-03',
    name: 'Paneer Butter Masala',
    description: 'Diced malai paneer simmered in velvety makhani gravy enriched with cashew paste and fragrant Kasuri methi.',
    category: 'Main Course',
    pricePaise: 31000,
    dietaryTag: 'VEG',
    spiceLevel: 'MEDIUM',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.8,
    ordersCount: 520,
    prepTimeMinutes: 15,
    imageUrl: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'item-mc-04',
    name: 'Mutton Rogan Josh',
    description: 'Tender baby mutton shanks braised in aromatic Kashmiri chili, cockscomb flower extract, and dried ginger.',
    category: 'Main Course',
    pricePaise: 44000,
    dietaryTag: 'NON_VEG',
    spiceLevel: 'HOT',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.9,
    ordersCount: 480,
    prepTimeMinutes: 20,
    imageUrl: 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'item-mc-05',
    name: 'Chettinad Pepper Curry',
    description: 'Robust South Indian style spiced curry freshly ground with black peppercorns, star anise, curry leaves & coconut.',
    category: 'Main Course',
    pricePaise: 36000,
    dietaryTag: 'NON_VEG',
    spiceLevel: 'HOT',
    cuisine: 'SOUTH_INDIAN',
    isHealthy: true,
    isAvailable: true,
    rating: 4.8,
    ordersCount: 290,
    prepTimeMinutes: 16,
    imageUrl: 'https://images.unsplash.com/photo-1610057099443-fde8c4d50f91?auto=format&fit=crop&w=600&q=80',
  },

  // ── Biryani & Rice ──
  {
    id: 'item-br-01',
    name: 'Dum Biryani Hyderabadi',
    description: 'Fragrant aged Basmati rice layered with spiced marinated meat, saffron milk, and caramelized shallots cooked in sealed clay handi.',
    category: 'Biryani & Rice',
    pricePaise: 39000,
    dietaryTag: 'NON_VEG',
    spiceLevel: 'HOT',
    cuisine: 'SOUTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 5.0,
    ordersCount: 1250,
    prepTimeMinutes: 18,
    imageUrl: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-salan', name: 'Extra Mirchi Ka Salan', pricePaise: 3000 },
      { id: 'mod-raita', name: 'Burani Garlic Raita', pricePaise: 4000 },
    ],
  },
  {
    id: 'item-br-02',
    name: 'Subz Nizami Biryani',
    description: 'Garden vegetables, baby potatoes, and paneer cubes cooked in dum with fresh mint, coriander, and organic rose water.',
    category: 'Biryani & Rice',
    pricePaise: 29000,
    dietaryTag: 'VEG',
    spiceLevel: 'MEDIUM',
    cuisine: 'SOUTH_INDIAN',
    isHealthy: true,
    isAvailable: true,
    rating: 4.7,
    ordersCount: 460,
    prepTimeMinutes: 15,
    imageUrl: 'https://images.unsplash.com/photo-1642821373181-696a54913e9a?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-veg-raita', name: 'Cucumber Mint Raita', pricePaise: 3000 },
    ],
  },

  // ── Breads ──
  {
    id: 'item-bd-01',
    name: 'Butter Garlic Naan',
    description: 'Soft tandoor-baked leavened bread generously topped with minced garlic, fresh cilantro, and melted dairy butter.',
    category: 'Breads',
    pricePaise: 8000,
    dietaryTag: 'VEG',
    spiceLevel: 'NONE',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.9,
    ordersCount: 880,
    prepTimeMinutes: 8,
    imageUrl: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?auto=format&fit=crop&w=600&q=80',
  },
  {
    id: 'item-bd-02',
    name: 'Cheese & Chili Naan',
    description: 'Crisp artisan naan stuffed with sharp cheddar, mozzarella, and green chilies, toasted to golden blistered perfection.',
    category: 'Breads',
    pricePaise: 12000,
    dietaryTag: 'VEG',
    spiceLevel: 'MEDIUM',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 4.8,
    ordersCount: 540,
    prepTimeMinutes: 10,
    imageUrl: 'https://images.unsplash.com/photo-1565557623262-b51c2513a641?auto=format&fit=crop&w=600&q=80',
  },

  // ── Desserts ──
  {
    id: 'item-ds-01',
    name: 'Gulab Jamun with Kesar Rabri',
    description: 'Warm fried milk dumplings served on a bed of chilled saffron-infused reduced milk and toasted pistachios.',
    category: 'Desserts',
    pricePaise: 14000,
    dietaryTag: 'VEG',
    spiceLevel: 'NONE',
    cuisine: 'NORTH_INDIAN',
    isHealthy: false,
    isAvailable: true,
    rating: 5.0,
    ordersCount: 790,
    prepTimeMinutes: 5,
    imageUrl: 'https://images.unsplash.com/photo-1589119908995-c6837fa14848?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-rabri', name: 'Extra Kesar Rabri', pricePaise: 4000 },
      { id: 'mod-nuts', name: 'Extra Roasted Pistachios', pricePaise: 3000 },
    ],
  },

  // ── Beverages ──
  {
    id: 'item-bv-01',
    name: 'Alphonso Mango Lassi',
    description: 'Thick churned artisanal yogurt blended with pure Ratnagiri Alphonso mango pulp and green cardamom.',
    category: 'Beverages',
    pricePaise: 12000,
    dietaryTag: 'VEG',
    spiceLevel: 'NONE',
    cuisine: 'NORTH_INDIAN',
    isHealthy: true,
    isAvailable: true,
    rating: 4.9,
    ordersCount: 620,
    prepTimeMinutes: 5,
    imageUrl: 'https://images.unsplash.com/photo-1543339308-43e59d6b73a6?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-mango-float', name: 'Fresh Mango Pulp Float', pricePaise: 3000 },
      { id: 'mod-malai', name: 'Dollop of Clotted Malai', pricePaise: 2500 },
    ],
  },
  {
    id: 'item-bv-02',
    name: 'Fresh Mint Lime Soda',
    description: 'Sparkling mineral water with freshly squeezed key limes, rock salt, crushed mint, and roasted cumin.',
    category: 'Beverages',
    pricePaise: 9000,
    dietaryTag: 'VEG',
    spiceLevel: 'NONE',
    cuisine: 'OTHER',
    isHealthy: true,
    isAvailable: true,
    rating: 4.7,
    ordersCount: 450,
    prepTimeMinutes: 4,
    imageUrl: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?auto=format&fit=crop&w=600&q=80',
    modifiers: [
      { id: 'mod-jeera', name: 'Roasted Cumin & Black Salt', pricePaise: 1500 },
    ],
  },
];

const CATEGORIES_LIST = [
  'Combos',
  'Starters',
  'Main Course',
  'Biryani & Rice',
  'Breads',
  'Desserts',
  'Beverages',
] as const;

// Category-intelligent kitchen instruction & preparation presets
const CATEGORY_COOK_NOTE_CHIPS: Record<string, string[]> = {
  Beverages: [
    '☕ Strong',
    '🧊 Less Ice',
    '🚫 No Sugar',
    '🍯 Less Sugar',
    '🥛 Oat Milk',
    '🧂 Salted',
    '🔥 Extra Hot',
  ],
  Desserts: [
    '🍯 Less Sweet',
    '🍨 Served Warm',
    '❄️ Served Chilled',
    '🚫 No Nuts (Allergy)',
    '🥛 Extra Rabri',
  ],
  Breads: [
    '🧈 Butter Brushed',
    '🚫 No Butter (Dry)',
    '🔥 Crispy & Well Done',
    '🧄 Extra Garlic',
  ],
  'Biryani & Rice': [
    '🌶️ Extra Spicy',
    '🍃 Mild / Less Spicy',
    '🧅 Extra Fried Onions',
    '🥣 Extra Raita',
    '🔥 Extra Dum Heat',
  ],
  Starters: [
    '🌶️ Extra Spicy',
    '🍃 Mild / Less Spicy',
    '🧅 No Onion / Garlic',
    '🔥 Crispy & Well Done',
    '🥗 Less Oil',
    '🧂 Less Salt',
    '🍋 Extra Lemon',
  ],
  'Main Course': [
    '🌶️ Extra Spicy',
    '🍃 Mild / Less Spicy',
    '🧅 No Onion / Garlic',
    '🥗 Less Oil / Butter',
    '🧂 Less Salt',
    '🧈 Extra Butter',
  ],
};

const DISH_RECOMMENDED_ADDONS: Record<string, ModifierOption[]> = {
  RICE: [
    { id: '3a000000-0000-4000-8000-000000000104', name: 'Golden Fried Barista Onions', pricePaise: 2500 },
    { id: '3a000000-0000-4000-8000-000000000105', name: 'Extra Desi Ghee Dollop', pricePaise: 3000 },
    { id: '3a000000-0000-4000-8000-000000000106', name: 'Boiled Egg (1 pc)', pricePaise: 2000 },
    { id: '3a000000-0000-4000-8000-000000000103', name: 'Extra Mirchi Ka Salan', pricePaise: 3500 },
    { id: 'f7762b6a-0000-0000-0000-000000000045', name: 'Extra Burani Garlic Raita', pricePaise: 3000 },
    { id: '3a000000-0000-4000-8000-000000000107', name: 'Extra Gravy Cup', pricePaise: 3500 },
  ],
  MAIN: [
    { id: 'f7762b6a-0000-0000-0000-000000000039', name: 'Extra Butter Dollop', pricePaise: 2500 },
    { id: 'f7762b6a-0000-0000-0000-000000000041', name: 'Extra Fresh Malai / Cream', pricePaise: 2000 },
    { id: 'f7762b6a-0000-0000-0000-000000000038', name: 'Less Butter / Less Oil', pricePaise: 0 },
    { id: 'f7762b6a-0000-0000-0000-000000000040', name: 'No Ginger Juliennes', pricePaise: 0 },
    { id: '3a000000-0000-4000-8000-000000000107', name: 'Extra Gravy Cup', pricePaise: 3500 },
  ],
  STARTER: [
    { id: 'f7762b6a-0000-0000-0000-000000000034', name: 'Extra Mint Chutney', pricePaise: 2000 },
    { id: 'f7762b6a-0000-0000-0000-000000000030', name: 'Well Done & Extra Crispy', pricePaise: 0 },
    { id: 'f7762b6a-0000-0000-0000-000000000031', name: 'Less Oil', pricePaise: 0 },
    { id: 'f7762b6a-0000-0000-0000-000000000032', name: 'No Onion / No Garlic', pricePaise: 0 },
  ],
};

const COOK_NOTE_CHIPS = CATEGORY_COOK_NOTE_CHIPS['Starters']!;

// Mutually exclusive cook note chips clusters: selecting one clears conflicting options
const MUTUALLY_EXCLUSIVE_CHIP_CLUSTERS: string[][] = [
  // Sugar options
  ['🚫 No Sugar', '🍯 Less Sugar', '🍯 Less Sweet'],
  // Temperature options
  ['🔥 Extra Hot', '🧊 Less Ice', '🍨 Served Warm', '❄️ Served Chilled'],
  // Spice options
  ['🌶️ Extra Spicy', '🍃 Mild / Less Spicy', '🍃 Mild Spice'],
  // Butter / Oil options
  ['🧈 Extra Butter', '🧈 Butter Brushed', '🥗 Less Oil / Butter', '🥗 Less Oil', '🚫 No Butter (Dry)', '🍃 Plain / No Butter'],
  // Dum heat
  ['🔥 Extra Dum Heat'],
];

function toggleChipInNotes(curNotes: string, chip: string): string {
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

// Helper to guarantee single-select vs multi-select grouping for any menu item
function resolveItemModifierGroups(item: MenuItem): ModifierGroup[] {
  if (item.modifierGroups && item.modifierGroups.length > 0) {
    return item.modifierGroups;
  }
  if (!item.modifiers || item.modifiers.length === 0) {
    return [];
  }

  // Safety Heuristic: cluster flat modifiers into Single-select vs Multi-select groups if not grouped yet
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

const isSpiceApplicable = (item: MenuItem) => {
  if (item.category === 'Combos' || item.category === 'Desserts' || item.category === 'Beverages' || item.category === 'Breads') {
    return false;
  }
  return item.spiceLevel !== 'NONE';
};

const getCustomisationTitle = (category: string) => {
  if (category === 'Beverages') return 'Beverage Preferences:';
  if (category === 'Desserts') return 'Serving & Sweetness Preferences:';
  if (category === 'Breads') return 'Bread Preparation:';
  return 'Chef Instructions:';
};

const getNotePlaceholder = (category: string) => {
  if (category === 'Beverages') return 'Specific note (e.g. no sugar, less ice, oat milk)...';
  if (category === 'Desserts') return 'Specific note (e.g. serve warm, no pistachios)...';
  if (category === 'Breads') return 'Specific note (e.g. well toasted, cut into halves)...';
  return 'Specific note for kitchen (e.g. less salt, well done)...';
};

const isPortionApplicable = (item: MenuItem): boolean => {
  // Not applicable for combos, drinks, desserts, or breads
  if (item.category === 'Combos' || item.category === 'Desserts' || item.category === 'Beverages' || item.category === 'Breads') {
    return false;
  }
  const nameLower = item.name.toLowerCase();
  // Simple plain basmati accompaniment is single-bowl
  if (nameLower.includes('steamed basmati rice') || nameLower.includes('plain rice')) {
    return false;
  }
  return (
    item.category === 'Biryani & Rice' ||
    item.category === 'Main Course' ||
    item.category === 'Starters'
  );
};

const getPortionPricing = (item: MenuItem) => {
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

const HERO_SLIDES = [
  {
    tag: "CHEF'S SIGNATURE",
    title: 'Royal Awadhi Feast',
    subtitle: 'Murgh Malai Kebab & Charcoal Paneer Tikka slow-roasted in clay tandoor.',
    img: 'https://images.unsplash.com/photo-1599488615731-7e5c2823ff28?auto=format&fit=crop&w=1200&q=80',
    categoryTarget: 'Starters',
    btnText: 'Explore Starters →',
  },
  {
    tag: 'FESTIVE OFFER',
    title: 'Flat 15% OFF Savings',
    subtitle: 'Enjoy 15% off on dining bills above ₹500 today with code ROYAL15.',
    img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=1200&q=80',
    couponCode: 'ROYAL15',
    btnText: 'Copy Coupon ROYAL15',
  },
  {
    tag: '18-HOUR SIMMER',
    title: 'Dal Makhani Bukhara',
    subtitle: 'Slow-simmered black lentils cooked overnight with farm churned butter.',
    img: 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=1200&q=80',
    categoryTarget: 'Main Course',
    btnText: 'View Main Course →',
  },
  {
    tag: 'ROYAL DESSERT',
    title: 'Kesar Rabri Gulab Jamun',
    subtitle: 'Complimentary on all orders above ₹1,000. Made with pure saffron.',
    img: 'https://images.unsplash.com/photo-1589119908995-c6837fa14848?auto=format&fit=crop&w=1200&q=80',
    categoryTarget: 'Desserts',
    btnText: 'Indulge in Sweets →',
  },
];

const OFFERS_DATA = [
  {
    id: 'off-01',
    code: 'ROYAL15',
    title: 'Flat 15% OFF',
    discountDesc: 'On orders above ₹500',
    validity: 'Valid today on dine-in',
    discountPaise: 15, // percent
  },
  {
    id: 'off-02',
    code: 'CHEFGIFT',
    title: 'Free Rabri Jamun',
    discountDesc: 'On orders above ₹1,000',
    validity: 'Complimentary dessert',
    discountPaise: 0,
  },
  {
    id: 'off-03',
    code: 'DINEFIRST',
    title: '₹100 Instant Off',
    discountDesc: 'Welcome offer for new diners',
    validity: 'First dine-in order',
    discountPaise: 10000,
  },
  {
    id: 'off-04',
    code: 'AWADHI50',
    title: '₹50 Off on Biryani',
    discountDesc: 'On any authentic handi biryani',
    validity: 'Valid till midnight',
    discountPaise: 5000,
  },
];

// ============================================================================
// Main Component
// ============================================================================

export default function CustomerDineInPage() {
  // Navigation View: 'home' (Discovery & Browse Feed) | 'menu' (Full Menu Page)
  const [currentView, setCurrentView] = useState<'home' | 'menu'>('home');

  // Table and Dining Session State (verified exclusively via signed QR token)
  const [selectedTable, setSelectedTable] = useState('--');
  const [tablePax, setTablePax] = useState(2);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [activeTableId, setActiveTableId] = useState<string>('');
  const [activeOrgId, setActiveOrgId] = useState<string>(() => resolveTenantIds().orgId);
  const [activeOutletId, setActiveOutletId] = useState<string>(() => resolveTenantIds().outletId);
  const [manualQrInput, setManualQrInput] = useState('');
  const [isTableVerified, setIsTableVerified] = useState(false);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isTopTableClosing, setIsTopTableClosing] = useState(false);
  const [outletTables, setOutletTables] = useState<OutletTableInfo[]>([]);
  const [outletTablesLoaded, setOutletTablesLoaded] = useState(false);
  const [tableNumberInput, setTableNumberInput] = useState('');
  const [tableSubmitLoading, setTableSubmitLoading] = useState(false);
  const [cartCheckoutTableDigits, setCartCheckoutTableDigits] = useState('');
  const [cartPlateEditingId, setCartPlateEditingId] = useState<string | null>(null);
  const [cartPlateDigits, setCartPlateDigits] = useState('');
  const [editingOrderPlateKey, setEditingOrderPlateKey] = useState<string | null>(null);
  const [editingOrderPlateDigits, setEditingOrderPlateDigits] = useState('');
  const [editingOrderPlateLoading, setEditingOrderPlateLoading] = useState(false);

  // Hero Carousel State
  const [heroIndex, setHeroIndex] = useState(0);

  // Home Section Inline Expansion (Only one expanded at a time)
  const [expandedSection, setExpandedSection] = useState<
    'offers' | 'top_sellers' | 'recommended' | 'favourites' | 'wishlist' | null
  >(null);

  // Wishlist Set
  const [wishlist, setWishlist] = useState<Set<string>>(new Set(['item-mc-01', 'item-st-02']));

  // Menu Navigation & Search
  const [activeCategory, setActiveCategory] = useState<string>('Starters');
  const [searchQuery, setSearchQuery] = useState('');
  const [dietaryFilter, setDietaryFilter] = useState<'ALL' | 'VEG' | 'NON_VEG'>('ALL');
  const [sortOption, setSortOption] = useState<'POPULAR' | 'PRICE_ASC' | 'PRICE_DESC' | 'RATING' | 'PREP_TIME'>('POPULAR');

  // Filter Funnel Sheet State
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [filterNorthIndian, setFilterNorthIndian] = useState(false);
  const [filterSouthIndian, setFilterSouthIndian] = useState(false);
  const [filterHealthy, setFilterHealthy] = useState(false);
  const [filterAvailableOnly, setFilterAvailableOnly] = useState(false);

  // Menu items list
  const [menuItems, setMenuItems] = useState<MenuItem[]>(PILOT_MENU);

  // Cart & Line Items (with robust localStorage persistence)
  const [cartLines, setCartLines] = useState<CartLineItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('dineflow_customer_cart_v2');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch {}
    }
    return [];
  });

  // Sync cartLines to localStorage whenever changed
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        if (cartLines.length > 0) {
          localStorage.setItem('dineflow_customer_cart_v2', JSON.stringify(cartLines));
        } else {
          localStorage.removeItem('dineflow_customer_cart_v2');
        }
      } catch {}
    }
  }, [cartLines]);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [couponInput, setCouponInput] = useState('');

  // Accordion-style in-place customisation state (Only one item expanded at a time)
  const [expandedAccordionItemId, setExpandedAccordionItemId] = useState<string | null>(null);
  const [accordionQty, setAccordionQty] = useState(1);
  const [accordionPortion, setAccordionPortion] = useState<'FULL' | 'HALF'>('FULL');
  const [accordionSpice, setAccordionSpice] = useState<'MILD' | 'MEDIUM' | 'HOT' | 'NONE'>('MEDIUM');
  const [accordionNote, setAccordionNote] = useState('');
  const [accordionModifiers, setAccordionModifiers] = useState<ModifierOption[]>([]);

  // Per-Plate Customisation State: the "one spicy biryani out of three" case
  const [isPerPlateSplit, setIsPerPlateSplit] = useState(false);
  const [activePlateIndex, setActivePlateIndex] = useState(1);
  const [plateConfigs, setPlateConfigs] = useState<
    Array<{
      plateIndex: number;
      customName?: string;
      portion?: 'FULL' | 'HALF';
      spice: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
      notes: string;
      modifiers: ModifierOption[];
    }>
  >([]);

  // ── Diner Profiles & Taste Preferences State ──
  // Saved diner profiles belong strictly to authenticated customers.
  // When logged out (!customerToken), dinerProfiles is empty and never displayed.
  const [dinerProfiles, setDinerProfiles] = useState<DinerProfile[]>([]);

  // Plate Naming & Profile Modal State
  const [plateNamingTarget, setPlateNamingTarget] = useState<{
    type: 'COMBO' | 'ITEM';
    compId?: string;
    plateId?: string;
    plateIndex?: number;
    currentName: string;
  } | null>(null);
  const [plateNameInput, setPlateNameInput] = useState('');
  const [showNewProfileForm, setShowNewProfileForm] = useState(false);
  const [newProfileSpice, setNewProfileSpice] = useState<'MILD' | 'MEDIUM' | 'HOT'>('MEDIUM');
  const [newProfileNotes, setNewProfileNotes] = useState('');

  // ── Item & Combo Customization State ──
  const [activeCustomizingItem, setActiveCustomizingItem] = useState<MenuItem | null>(null);
  const [activeComboOffer, setActiveComboOffer] = useState<ComboOffer | null>(null);
  const [comboDishPlates, setComboDishPlates] = useState<Record<string, ComboDishPlate[]>>({});
  const [activeDishPlateId, setActiveDishPlateId] = useState<Record<string, string>>({});
  const [comboDrinkChoices, setComboDrinkChoices] = useState<Record<string, string>>({});
  const [comboBreadType, setComboBreadType] = useState<Record<string, string>>({});
  const [comboExtraBreadsQty, setComboExtraBreadsQty] = useState(0);
  const [comboExtraDrinksQty, setComboExtraDrinksQty] = useState(0);

  // Fly-to-Cart Animation State
  const cartIconRef = useRef<HTMLButtonElement>(null);
  const [flyingGhost, setFlyingGhost] = useState<{
    startX: number;
    startY: number;
    targetX: number;
    targetY: number;
    imgUrl: string;
  } | null>(null);
  const [cartPulse, setCartPulse] = useState(false);

  // Toast message
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Orders History State: Only paid orders are visible (unpaid/pending items remain in cart)
  // Four sections for order status: PREPARING, ON_HOLD (Serve Later), SERVED, CANCELLED
  const [sessionOrders, setSessionOrders] = useState<TableOrderRecord[]>([]);
  const [isOrdersHistoryOpen, setIsOrdersHistoryOpen] = useState(false);
  const [ordersFilterTab, setOrdersFilterTab] = useState<'PREPARING' | 'ON_HOLD' | 'SERVED' | 'CANCELLED'>('PREPARING');
  const [releasedHoldPlateKeys, setReleasedHoldPlateKeys] = useState<Record<string, boolean>>({});
  const [expandedPlateKeys, setExpandedPlateKeys] = useState<Record<string, boolean>>({});

  const handleReleaseHold = (plateKeys: string[], itemName?: string) => {
    setReleasedHoldPlateKeys((prev) => {
      const next = { ...prev };
      plateKeys.forEach((k) => {
        next[k] = true;
      });
      return next;
    });
    setToastMessage(`🍳 Sent to kitchen! Chef will start preparing ${itemName || 'your item'} now.`);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Customer Authentication & Profile State
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isAuthClosing, setIsAuthClosing] = useState(false);
  const [authMode, setAuthMode] = useState<'SIGNIN' | 'SIGNUP'>('SIGNIN');
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [customerPhoneInput, setCustomerPhoneInput] = useState('');
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authEmailLocked, setAuthEmailLocked] = useState(false);
  const [authDisplayNameInput, setAuthDisplayNameInput] = useState('');
  const [googlePreRegToken, setGooglePreRegToken] = useState<string | null>(null);
  const [authChannelLabel, setAuthChannelLabel] = useState<'WhatsApp' | 'SMS' | null>(null);
  const [showDevGooglePicker, setShowDevGooglePicker] = useState(false);
  const [devGoogleEmailInput, setDevGoogleEmailInput] = useState('');
  const [devGoogleNameInput, setDevGoogleNameInput] = useState('');
  const [customerOtpInput, setCustomerOtpInput] = useState('');
  const [authStep, setAuthStep] = useState<'PHONE' | 'OTP'>('PHONE');
  const [authLoading, setAuthLoading] = useState(false);
  const [authDevCode, setAuthDevCode] = useState<string | null>(null);
  const [authError, setAuthError] = useState('');
  const [customerToken, setCustomerToken] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerProfile, setCustomerProfile] = useState<{
    phone: string;
    email?: string | null;
    displayName: string;
    loyaltyPoints: number;
    loyaltyTier: string;
  } | null>(null);
  const [editDisplayName, setEditDisplayName] = useState('');

  // Comprehensive Diner Profile Editor State (Accessible anytime from Profile Page & Plate Customizer)
  const [editingDinerProfile, setEditingDinerProfile] = useState<DinerProfile | null>(null);
  const [isNewDinerProfile, setIsNewDinerProfile] = useState(false);
  const [editorName, setEditorName] = useState('');
  const [editorSpice, setEditorSpice] = useState<DinerPreferences['spicePreference']>('MEDIUM');
  const [editorOnionGarlic, setEditorOnionGarlic] = useState<DinerPreferences['onionGarlicPreference']>('WITH_ONION_GARLIC');
  const [editorOil, setEditorOil] = useState<DinerPreferences['cookingOilPreference']>('REGULAR_OIL');
  const [editorCrispy, setEditorCrispy] = useState<DinerPreferences['crispinessPreference']>('REGULAR');
  const [editorBiryaniRaita, setEditorBiryaniRaita] = useState<DinerPreferences['biryaniRaitaPreference']>('REGULAR');
  const [editorBiryaniOnion, setEditorBiryaniOnion] = useState<DinerPreferences['biryaniOnionPreference']>('REGULAR');
  const [editorMilk, setEditorMilk] = useState<DinerPreferences['milkPreference']>('REGULAR_MILK');
  const [editorSugar, setEditorSugar] = useState<DinerPreferences['sugarPreference']>('REGULAR_SUGAR');
  const [editorHotTemp, setEditorHotTemp] = useState<DinerPreferences['hotBeverageTemp']>('REGULAR_HOT');
  const [editorColdIce, setEditorColdIce] = useState<DinerPreferences['coldBeverageIce']>('REGULAR_ICE');
  const [editorStrength, setEditorStrength] = useState<DinerPreferences['beverageStrength']>('MEDIUM_STRENGTH');
  const [editorDessertSweet, setEditorDessertSweet] = useState<DinerPreferences['dessertSweetness']>('REGULAR_SWEET');
  const [editorDessertTemp, setEditorDessertTemp] = useState<DinerPreferences['dessertTemp']>('SERVED_WARM');
  const [editorNutAllergy, setEditorNutAllergy] = useState<DinerPreferences['nutAllergyPreference']>('REGULAR_NUTS');
  const [editorNotes, setEditorNotes] = useState('');

  // Payment Settlement State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'UPI' | 'CASH'>('UPI');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentQrData, setPaymentQrData] = useState<{ paymentId: string; orderId?: string; sessionId?: string; qrCodeUrl: string; upiString: string; redirectUrl?: string } | null>(null);
  const [paymentSuccessData, setPaymentSuccessData] = useState<{ paymentId: string; totalPaise: number } | null>(null);

  // Chef AI Chat State
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSessionId, setAiSessionId] = useState<string | null>(null);
  const aiMessagesEndRef = useRef<HTMLDivElement>(null);
  const [aiMessages, setAiMessages] = useState<
    Array<{
      role: 'assistant' | 'user';
      text: string;
      proposedCartItems?: Array<{
        itemId: string;
        name: string;
        quantity: number;
        pricePaise: number;
      }>;
    }>
  >([
    {
      role: 'assistant',
      text: "Namaste! I'm Chef AI at Royal Spice Bistro. 👨‍🍳 Looking for dish recommendations, spice customisations, or pairing ideas for your table?",
    },
  ]);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Auto-scroll Chef AI conversation to bottom
  useEffect(() => {
    if (isAiOpen) {
      aiMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [aiMessages, aiLoading, isAiOpen]);

  // ── 1. Hero Carousel Auto-Rotation ─────────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % HERO_SLIDES.length);
    }, 4500);
    return () => clearInterval(timer);
  }, []);

  // ── 2. Table Directory, Manual / NFC / Signed QR Session & Drawers ──────────
  const [activeSlug, setActiveSlug] = useState<string | undefined>(undefined);

  const loadOutletTablesForTenant = useCallback(async (outletIdToLoad?: string, slugToLoad?: string) => {
    const dir = await fetchOutletTableDirectory(outletIdToLoad, slugToLoad);
    if (dir) {
      setOutletTables(dir.tables);
      setOutletTablesLoaded(true);
      if (dir.outletId) setActiveOutletId(dir.outletId);
      if (dir.orgId) setActiveOrgId(dir.orgId);
      return dir;
    }
    setOutletTablesLoaded(true);
    return null;
  }, []);

  const openTopTableDrawer = useCallback(() => {
    setIsTopTableClosing(false);
    setTableNumberInput((prev) => prev || (selectedTable !== '--' ? sanitizeTableDigits(selectedTable) : ''));
    setIsTableModalOpen(true);
    const tenant = resolveTenantIds(loadGuestSession());
    const targetOutlet = activeOutletId || tenant.outletId || undefined;
    if (!outletTablesLoaded || outletTables.length === 0) {
      void loadOutletTablesForTenant(targetOutlet, activeSlug);
    }
  }, [activeOutletId, activeSlug, loadOutletTablesForTenant, outletTables.length, outletTablesLoaded, selectedTable]);

  const closeTopTableDrawer = useCallback(() => {
    if (!isTableModalOpen || isTopTableClosing) return;
    setIsTopTableClosing(true);
    setTimeout(() => {
      setIsTableModalOpen(false);
      setIsTopTableClosing(false);
    }, 300);
  }, [isTableModalOpen, isTopTableClosing]);

  const openBottomAuthSheet = useCallback(
    (mode: 'SIGNIN' | 'SIGNUP' = 'SIGNIN') => {
      setIsAuthClosing(false);
      setAuthMode(mode);
      setAuthStep('PHONE');
      setAuthError('');
      setAuthDevCode(null);
      setShowDevGooglePicker(false);
      if (mode === 'SIGNIN') {
        setAuthEmailLocked(false);
        setGooglePreRegToken(null);
      }
      setIsAuthModalOpen(true);
    },
    [],
  );

  const closeBottomAuthSheet = useCallback(() => {
    if (!isAuthModalOpen || isAuthClosing) return;
    setIsAuthClosing(true);
    setTimeout(() => {
      setIsAuthModalOpen(false);
      setIsAuthClosing(false);
    }, 260);
  }, [isAuthClosing, isAuthModalOpen]);

  const getLiveTableValidation = useCallback(
    (digits: string): { matched: OutletTableInfo | null; error: string } => {
      if (!digits) return { matched: null, error: '' };
      const matched = matchHotelTable(digits, outletTables);
      if (!outletTablesLoaded) return { matched, error: '' };
      if (outletTables.length === 0) {
        return { matched: null, error: 'Table directory unavailable for this hotel outlet.' };
      }
      if (!matched) {
        return {
          matched: null,
          error: `Table ${digits} is wrong — please enter a valid table number at this hotel.`,
        };
      }
      return { matched, error: '' };
    },
    [outletTables, outletTablesLoaded],
  );

  const topTableValidation = useMemo(
    () => getLiveTableValidation(tableNumberInput),
    [getLiveTableValidation, tableNumberInput],
  );

  const cartCheckoutTableValidation = useMemo(
    () => getLiveTableValidation(cartCheckoutTableDigits),
    [cartCheckoutTableDigits, getLiveTableValidation],
  );

  const cartPlateValidation = useMemo(
    () => getLiveTableValidation(cartPlateDigits),
    [cartPlateDigits, getLiveTableValidation],
  );

  const orderPlateValidation = useMemo(
    () => getLiveTableValidation(editingOrderPlateDigits),
    [editingOrderPlateDigits, getLiveTableValidation],
  );

  const establishSignedTableSession = async (qrToken: string, pax: number = 2) => {
    const res = await openSignedTableSession(qrToken, pax);
    if (!res.ok) {
      setIsTableVerified(false);
      showToast(res.error);
      return null;
    }
    setActiveSessionId(res.session.sessionId);
    setActiveTableId(res.session.tableId);
    setActiveOrgId(res.session.orgId);
    setActiveOutletId(res.session.outletId);
    if (res.session.tableNumber) {
      setSelectedTable(res.session.tableNumber);
    }
    setIsTableVerified(true);
    void loadOutletTablesForTenant(res.session.outletId);
    fetchSessionOrders(res.session.sessionId);
    return res.session;
  };

  const establishManualTableSession = async (
    outletIdToUse: string | undefined,
    tableNumber: string,
    pax: number = 2,
    slugToUse?: string,
  ) => {
    const res = await openManualTableSession(outletIdToUse, tableNumber, pax, slugToUse ?? activeSlug);
    if (!res.ok) {
      showToast(res.error);
      return null;
    }
    setActiveSessionId(res.session.sessionId);
    setActiveTableId(res.session.tableId);
    setActiveOrgId(res.session.orgId);
    setActiveOutletId(res.session.outletId);
    setSelectedTable(res.session.tableNumber || tableNumber);
    setIsTableVerified(true);
    void loadOutletTablesForTenant(res.session.outletId, slugToUse ?? activeSlug);
    fetchSessionOrders(res.session.sessionId);
    return res.session;
  };

  const applyActiveGuestSession = useCallback(
    (sess: GuestSessionState, slugHint?: string) => {
      setActiveSessionId(sess.sessionId);
      setActiveTableId(sess.tableId);
      setActiveOrgId(sess.orgId);
      setActiveOutletId(sess.outletId);
      if (sess.tableNumber) {
        setSelectedTable(sess.tableNumber);
      }
      setIsTableVerified(true);
      void loadOutletTablesForTenant(sess.outletId, slugHint);
    },
    [loadOutletTablesForTenant],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let active = true;

    async function initializeSession() {
      const urlParams = new URLSearchParams(window.location.search);
      const { signedQrToken, tableNumberParam, outletIdParam, slugParam } = extractUrlTableAndOutlet(urlParams);
      const tenant = resolveTenantIds(loadGuestSession());
      const targetOutletId = outletIdParam || tenant.outletId || undefined;
      if (slugParam) setActiveSlug(slugParam);

      if (targetOutletId) {
        setActiveOutletId(targetOutletId);
      }
      void loadOutletTablesForTenant(targetOutletId, slugParam || undefined);

      if (signedQrToken) {
        await establishSignedTableSession(signedQrToken, tablePax);
        return;
      }

      if (tableNumberParam) {
        await establishManualTableSession(targetOutletId, tableNumberParam, tablePax, slugParam || undefined);
        return;
      }

      // Restore persistent temporary customer & active table from HttpOnly cookie (survives refresh & PhonePe tabs)
      const remote = await fetchCurrentGuestSessionRemote();
      if (!active) return;

      if (remote?.active && remote.session) {
        applyActiveGuestSession(remote.session, slugParam || undefined);
        void fetchSessionOrders(remote.session.sessionId);
        return;
      }

      if (remote?.dissolved) {
        setActiveSessionId('');
        setActiveTableId('');
        setSelectedTable('--');
        setIsTableVerified(false);
        if (!loadCustomerAuth()) {
          setSessionOrders([]);
        }
        if (!urlParams.get('payment_success')) {
          setIsTableModalOpen(true);
        }
        return;
      }

      const existing = loadGuestSession();
      if (existing && remote === null) {
        applyActiveGuestSession(existing, slugParam || undefined);
        void fetchSessionOrders(existing.sessionId);
        return;
      }

      // No table detected from QR, NFC link, or active cookie -> slide down top table drawer BEFORE login UI.
      if (!urlParams.get('payment_success')) {
        setIsTableModalOpen(true);
      }
    }

    void initializeSession();
    return () => {
      active = false;
    };
  }, []);

  // ── 3. Fetch Live Menu from API ───────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('payment_success')) {
        setCartLines([]);
        try {
          localStorage.removeItem('dineflow_customer_cart_v2');
        } catch {}
        setOrdersFilterTab('PREPARING');
        setIsOrdersHistoryOpen(true);
        showToast('Payment confirmed via PhonePe! Kitchen is preparing your dishes 🍳');
        window.history.replaceState({}, '', window.location.pathname);
        void fetchSessionOrders();
      } else if (urlParams.get('payment_cancelled') || urlParams.get('payment_failed')) {
        setIsCartOpen(true);
        showToast('⚠️ Payment was not completed. Your dishes are saved in your cart — tap below to retry!');
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  useEffect(() => {
    async function fetchLiveMenu() {
      const tenant = resolveTenantIds(loadGuestSession());
      const orgToFetch = activeOrgId || tenant.orgId;
      const outletToFetch = activeOutletId || tenant.outletId;
      if (!orgToFetch) return;
      try {
        const query = outletToFetch ? `?outlet_id=${encodeURIComponent(outletToFetch)}` : '';
        const res = await fetch(`/api/v1/public/menu/${encodeURIComponent(orgToFetch)}${query}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.items && data.items.length > 0) {
            const catMap: Record<string, any> = {};
            if (data.categories) {
              data.categories.forEach((c: any) => {
                catMap[c.id] = c.name;
              });
            }

            const mapped: MenuItem[] = data.items.map((it: any, idx: number) => {
              const itLower = (it.name || '').toLowerCase();
              const matchedPilot = PILOT_MENU.find((p) => {
                const pLower = p.name.toLowerCase();
                return pLower === itLower || pLower.includes(itLower) || itLower.includes(pLower.split(' ')[0]);
              });
              let cat = (it.category_name || catMap[it.category_id] || matchedPilot?.category || 'Main Course') as any;
              if (cat === 'Biryani' || cat === 'Rice & Biryani' || cat === 'Rice') {
                cat = 'Biryani & Rice';
              }
              const isNonSpicyCat = cat === 'Desserts' || cat === 'Beverages' || cat === 'Breads';
              let derivedSpice: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE' = 'NONE';
              if (!isNonSpicyCat) {
                if (it.spice_level !== undefined && it.spice_level !== null) {
                  derivedSpice = it.spice_level === 0 ? 'NONE' : it.spice_level > 1 ? 'HOT' : 'MEDIUM';
                } else {
                  derivedSpice = matchedPilot?.spiceLevel || 'MILD';
                }
              }

              // Read dynamic modifier groups from database if present, preserving SINGLE/MULTIPLE selection types
              const liveModifierGroups: ModifierGroup[] =
                Array.isArray(it.modifier_groups) && it.modifier_groups.length > 0
                  ? it.modifier_groups.map((mg: any) => {
                      const grpName =
                        typeof mg.name === 'object'
                          ? mg.name?.en || Object.values(mg.name)[0] || ''
                          : mg.name || '';
                      const selType =
                        mg.selection_type === 'SINGLE' || mg.max === 1 ? 'SINGLE' : 'MULTIPLE';
                      return {
                        id: mg.group_id,
                        name: grpName,
                        selectionType: selType as 'SINGLE' | 'MULTIPLE',
                        minSelections: mg.min ?? 0,
                        maxSelections: mg.max ?? (selType === 'SINGLE' ? 1 : 10),
                        isRequired: !!mg.required,
                        modifiers: (mg.modifiers || []).map((m: any) => ({
                          id: m.id,
                          name:
                            typeof m.name === 'object'
                              ? m.name?.en || Object.values(m.name)[0] || ''
                              : m.name || '',
                          pricePaise: m.price_paise ?? 0,
                          groupId: mg.group_id,
                          groupName: grpName,
                        })),
                      };
                    })
                  : matchedPilot?.modifierGroups || [];

              const liveModifiers: ModifierOption[] =
                liveModifierGroups.length > 0
                  ? liveModifierGroups.flatMap((g) => g.modifiers)
                  : matchedPilot?.modifiers || [];

              const coffeeImg = 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80';
              let resolvedImage = matchedPilot?.imageUrl || PILOT_MENU[idx % PILOT_MENU.length]?.imageUrl || '';
              if (itLower.includes('coffee')) {
                resolvedImage = coffeeImg;
              } else if (itLower.includes('mutton') || itLower.includes('gosht')) {
                resolvedImage = 'https://images.unsplash.com/photo-1633945274405-b6c8069047b0?auto=format&fit=crop&w=600&q=80';
              } else if (itLower.includes('prawn')) {
                resolvedImage = 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?auto=format&fit=crop&w=600&q=80';
              } else if (itLower.includes('egg') || itLower.includes('ande')) {
                resolvedImage = 'https://images.unsplash.com/photo-1589302168068-964664d93dc0?auto=format&fit=crop&w=600&q=80';
              } else if (itLower.includes('paneer') && itLower.includes('biryani')) {
                resolvedImage = 'https://images.unsplash.com/photo-1567184109411-b28f27034344?auto=format&fit=crop&w=600&q=80';
              } else if (itLower.includes('veg') && itLower.includes('biryani')) {
                resolvedImage = 'https://images.unsplash.com/photo-1642821373181-696a54913e9a?auto=format&fit=crop&w=600&q=80';
              } else if (itLower.includes('biryani')) {
                resolvedImage = 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=600&q=80';
              } else if (itLower.includes('jeera')) {
                resolvedImage = 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=600&q=80';
              } else if (itLower.includes('steamed') && itLower.includes('rice')) {
                resolvedImage = 'https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=600&q=80';
              }
              if (typeof it.image_url === 'string' && it.image_url.trim().length > 0) {
                resolvedImage = it.image_url.trim();
              }

              return {
                id: it.id,
                name: it.name,
                description: it.description || it.description_i18n?.en || matchedPilot?.description || '',
                category: cat,
                pricePaise: it.price_paise,
                dietaryTag: it.veg_type === 'VEG' ? 'VEG' : 'NON_VEG',
                spiceLevel: derivedSpice,
                cuisine: matchedPilot?.cuisine || (idx % 3 === 0 ? 'SOUTH_INDIAN' : 'NORTH_INDIAN'),
                isHealthy: matchedPilot?.isHealthy || false,
                isAvailable: it.is_available !== false,
                rating: it.rating !== undefined && it.rating !== null ? parseFloat(it.rating) : (matchedPilot?.rating || 4.8),
                ordersCount: it.orders_count !== undefined && it.orders_count !== null ? Number(it.orders_count) : (matchedPilot?.ordersCount || 350),
                prepTimeMinutes: it.prep_time_min !== undefined && it.prep_time_min !== null ? Number(it.prep_time_min) : (matchedPilot?.prepTimeMinutes || 15),
                imageUrl: resolvedImage,
                modifiers: liveModifiers,
                modifierGroups: liveModifierGroups,
              };
            });

            // Defensive deduplication by normalized item name (preferring items with modifier groups if duplicates exist)
            const seen = new Map<string, MenuItem>();
            for (const item of mapped) {
              const key = item.name.trim().toLowerCase();
              const existing = seen.get(key);
              if (!existing) {
                seen.set(key, item);
              } else if ((item.modifierGroups?.length || 0) > (existing.modifierGroups?.length || 0)) {
                seen.set(key, item);
              }
            }
            setMenuItems(Array.from(seen.values()));
          }
        }
      } catch {
        // Fallback cleanly to PILOT_MENU
      }
    }
    fetchLiveMenu();
  }, [activeOrgId, activeOutletId]);

  // ── 4. Fetch Orders History (Scoped strictly to logged-in account OR active temp customer ID) ──
  const fetchSessionOrders = async (_sessionId?: string, customerTokenOverride?: string) => {
    const custAuth = loadCustomerAuth();
    const guestSess = loadGuestSession();
    const hasCustomer = Boolean(customerTokenOverride || custAuth?.accessToken);
    const hasGuest = Boolean(guestSess?.guestSessionToken);
    if (!hasCustomer && !hasGuest) return;

    try {
      const res = await customerApiFetch('/api/v1/customer/orders/my', undefined, {
        preferToken: hasCustomer ? 'customer' : 'guest',
        ...(customerTokenOverride ? { tokenOverride: customerTokenOverride } : {}),
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setSessionOrders(data);
        }
      }
    } catch {}
  };

  useEffect(() => {
    if (!activeSessionId && !customerToken) return;
    const timer = setInterval(() => {
      void fetchSessionOrders(activeSessionId);
    }, 4000);
    return () => clearInterval(timer);
  }, [activeSessionId, customerToken]);

  // ── 5. Fetch Diner Profiles Strictly from Real Database ─────────────────
  const fetchCustomerDinerProfiles = useCallback(async (custTargetId?: string | null, tokenOverride?: string | null) => {
    const targetId = custTargetId || customerId;
    const authToken = tokenOverride || customerToken;
    if (!targetId || !authToken) {
      setDinerProfiles([]);
      return;
    }
    try {
      const res = await customerApiFetch(
        '/api/v1/auth/customer/diner-profiles',
        undefined,
        { preferToken: 'customer', tokenOverride: authToken, orgIdOverride: activeOrgId },
      );
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) {
          setDinerProfiles(
            data.map((p: any) => ({
              id: p.id,
              name: p.name,
              spicePreference: p.spice_preference || p.spicePreference || 'MEDIUM',
              dietaryPreference: p.dietary_preference || p.dietaryPreference || 'ANY',
              kitchenInstructions: p.kitchen_instructions || p.kitchenInstructions || [],
              notes: p.notes || '',
              preferences: p.preferences || {},
            }))
          );
          return;
        }
      }
      setDinerProfiles([]);
    } catch {
      setDinerProfiles([]);
    }
  }, [customerId, customerToken, activeOrgId]);

  // Restore Customer Profile & Diner Profiles on mount (via sessionStorage OR HttpOnly refresh cookie)
  useEffect(() => {
    let active = true;
    async function restoreCustomerSession() {
      try {
        const auth = loadCustomerAuth();
        if (auth?.accessToken && auth?.customerId) {
          setCustomerToken(auth.accessToken);
          setCustomerId(auth.customerId);
          const profRes = await customerApiFetch(
            '/api/v1/auth/customer/profile',
            undefined,
            { preferToken: 'customer', tokenOverride: auth.accessToken, orgIdOverride: activeOrgId },
          ).catch(() => null);
          if (profRes && profRes.ok) {
            const prof = await profRes.json();
            if (!active) return;
            setCustomerProfile(prof);
            setEditDisplayName(prof.displayName || '');
            fetchCustomerDinerProfiles(auth.customerId, auth.accessToken);
            void fetchSessionOrders(undefined, auth.accessToken);
            return;
          }
        }

        // Silent mobile session restore using persistent HttpOnly refresh cookie (`df_cust_rt`)
        const refreshed = await refreshCustomerSessionRemote(activeOrgId || undefined);
        if (!active || !refreshed) return;
        setCustomerToken(refreshed.accessToken);
        setCustomerId(refreshed.customerId);
        const profRes = await customerApiFetch(
          '/api/v1/auth/customer/profile',
          undefined,
          { preferToken: 'customer', tokenOverride: refreshed.accessToken, orgIdOverride: activeOrgId },
        ).catch(() => null);
        if (profRes && profRes.ok) {
          const prof = await profRes.json();
          if (!active) return;
          setCustomerProfile(prof);
          setEditDisplayName(prof.displayName || '');
        } else if (active) {
          setCustomerProfile({
            phone: refreshed.phone || '',
            email: refreshed.email ?? null,
            displayName: refreshed.displayName || '',
            loyaltyPoints: refreshed.loyaltyPoints ?? 0,
            loyaltyTier: 'Silver Club',
          });
          setEditDisplayName(refreshed.displayName || '');
        }
        fetchCustomerDinerProfiles(refreshed.customerId, refreshed.accessToken);
        void fetchSessionOrders(undefined, refreshed.accessToken);
      } catch {}
    }
    void restoreCustomerSession();
    return () => {
      active = false;
    };
  }, [fetchCustomerDinerProfiles, activeOrgId]);

  // Sync Diner Profiles: Only active when a customer is authenticated, strictly from database
  useEffect(() => {
    if (!customerToken || !customerId) {
      setDinerProfiles([]);
      return;
    }
    fetchCustomerDinerProfiles(customerId);
  }, [customerToken, customerId, fetchCustomerDinerProfiles]);

  // ── 6. Filtered Menu Items ─────────────────────────────────────────────────
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterNorthIndian) count++;
    if (filterSouthIndian) count++;
    if (filterHealthy) count++;
    if (filterAvailableOnly) count++;
    return count;
  }, [filterNorthIndian, filterSouthIndian, filterHealthy, filterAvailableOnly]);

  const filteredItems = useMemo(() => {
    return menuItems.filter((item) => {
      // Dietary filter chip
      if (dietaryFilter === 'VEG' && item.dietaryTag !== 'VEG') return false;
      if (dietaryFilter === 'NON_VEG' && item.dietaryTag !== 'NON_VEG') return false;

      // Filter Funnel Options
      if (filterNorthIndian && !filterSouthIndian && item.cuisine !== 'NORTH_INDIAN') return false;
      if (filterSouthIndian && !filterNorthIndian && item.cuisine !== 'SOUTH_INDIAN') return false;
      if (filterHealthy && !item.isHealthy) return false;
      if (filterAvailableOnly && !item.isAvailable) return false;

      // Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.description.toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q)
        );
      }
      return true;
    }).sort((a, b) => {
      if (sortOption === 'PRICE_ASC') return a.pricePaise - b.pricePaise;
      if (sortOption === 'PRICE_DESC') return b.pricePaise - a.pricePaise;
      if (sortOption === 'RATING') return b.rating - a.rating;
      if (sortOption === 'PREP_TIME') return a.prepTimeMinutes - b.prepTimeMinutes;
      return b.ordersCount - a.ordersCount; // Default: Popular
    });
  }, [
    menuItems,
    dietaryFilter,
    filterNorthIndian,
    filterSouthIndian,
    filterHealthy,
    filterAvailableOnly,
    searchQuery,
    sortOption,
  ]);

  // Group filtered items by category for Menu view
  const groupedItems = useMemo(() => {
    const groups: Record<string, MenuItem[]> = {};
    CATEGORIES_LIST.forEach((cat) => {
      groups[cat] = [];
    });
    filteredItems.forEach((item) => {
      if (!groups[item.category]) {
        groups[item.category] = [];
      }
      groups[item.category]!.push(item);
    });
    return groups;
  }, [filteredItems]);

  // ── 7. Category Scroll-Spy & Smooth Navigation ────────────────────────────
  const isManualScrollRef = useRef(false);
  const manualScrollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const scrollToCategory = (cat: string) => {
    setActiveCategory(cat);
    const pillEl = document.getElementById(`pill-${cat}`);
    if (pillEl) {
      pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    const el = document.getElementById(`cat-section-${cat}`);
    if (el) {
      isManualScrollRef.current = true;
      if (manualScrollTimerRef.current) clearTimeout(manualScrollTimerRef.current);
      manualScrollTimerRef.current = setTimeout(() => {
        isManualScrollRef.current = false;
      }, 700);
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (currentView !== 'menu') return;
    const handleScroll = () => {
      if (isManualScrollRef.current) return;

      // 1. Check if user reached near the bottom of the page (e.g. final category like Beverages)
      const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight;
      const scrollBottom = window.innerHeight + window.scrollY;
      const isNearBottom = scrollHeight - scrollBottom <= 80;

      if (isNearBottom) {
        const availableCats = CATEGORIES_LIST.filter((c) => (groupedItems[c] || []).length > 0);
        if (availableCats.length > 0) {
          const lastCat = availableCats[availableCats.length - 1];
          if (lastCat) {
            setActiveCategory((prev) => {
              if (prev !== lastCat) {
                const pillEl = document.getElementById(`pill-${lastCat}`);
                if (pillEl) {
                  pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }
                return lastCat;
              }
              return prev;
            });
            return;
          }
        }
      }

      // 2. Viewport-mid check: section becomes active as its header/content enters middle of screen
      const viewportMid = window.innerHeight * 0.5;
      let candidateCat: string | null = null;

      for (const cat of CATEGORIES_LIST) {
        const el = document.getElementById(`cat-section-${cat}`);
        if (el) {
          const rect = el.getBoundingClientRect();
          // The section top has reached the middle of viewport (or above), and has not scrolled off the top
          if (rect.top <= viewportMid && rect.bottom > 120) {
            candidateCat = cat;
          }
        }
      }

      if (candidateCat) {
        const chosen = candidateCat;
        setActiveCategory((prev) => {
          if (prev !== chosen) {
            const pillEl = document.getElementById(`pill-${chosen}`);
            if (pillEl) {
              pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
            }
            return chosen;
          }
          return prev;
        });
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [currentView, groupedItems]);

  // ── 8. Home Discovery Rows Data ───────────────────────────────────────────
  // Top Sellers: sorted by orders count
  const topSellers = useMemo(() => {
    return [...menuItems].sort((a, b) => b.ordersCount - a.ordersCount).slice(0, 6);
  }, [menuItems]);

  // Recommended for you (Signed-in only): tailored items
  const recommendedItems = useMemo(() => {
    return menuItems.filter((i) => i.rating >= 4.8).slice(0, 5);
  }, [menuItems]);

  // Your Favourite Orders (Signed-in only): ordered items from past history
  const favouriteItems = useMemo(() => {
    const orderedNames = new Set(
      sessionOrders.flatMap((o) => o.items.map((it) => it.name_snapshot.toLowerCase()))
    );
    const matched = menuItems.filter((m) => orderedNames.has(m.name.toLowerCase()));
    return matched.length > 0 ? matched : [menuItems[1]!, menuItems[5]!, menuItems[8]!].filter(Boolean);
  }, [sessionOrders, menuItems]);

  // Wishlisted Items
  const wishlistedItems = useMemo(() => {
    return menuItems.filter((m) => wishlist.has(m.id));
  }, [menuItems, wishlist]);

  const toggleWishlist = (itemId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setWishlist((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
        showToast('Removed from favorites');
      } else {
        next.add(itemId);
        showToast('Added to favorites ❤️');
      }
      return next;
    });
  };

  // ── 9. Cart Calculation & Operations ───────────────────────────────────────
  const cartItemCount = useMemo(() => cartLines.reduce((acc, c) => acc + c.quantity, 0), [cartLines]);

  const cartSubtotalPaise = useMemo(() => {
    return cartLines.reduce((acc, c) => {
      const modsTotal = c.selectedModifiers.reduce((mAcc, m) => mAcc + m.pricePaise, 0);
      return acc + (c.item.pricePaise + modsTotal) * c.quantity;
    }, 0);
  }, [cartLines]);

  const discountPaise = useMemo(() => {
    if (!appliedCoupon) return 0;
    if (appliedCoupon === 'ROYAL15') {
      return cartSubtotalPaise >= 50000 ? Math.round(cartSubtotalPaise * 0.15) : 0;
    }
    if (appliedCoupon === 'DINEFIRST') {
      return 10000;
    }
    if (appliedCoupon === 'AWADHI50') {
      return 5000;
    }
    return 0;
  }, [appliedCoupon, cartSubtotalPaise]);

  const netSubtotalPaise = Math.max(0, cartSubtotalPaise - discountPaise);
  const gstPaise = Math.round(netSubtotalPaise * 0.05);
  const cartGrandTotalPaise = netSubtotalPaise + gstPaise;

  // ── Flatten Session Orders into Individual Plates with Customisations & Note to Kitchen ──
  // Rule: Only PAID orders are visible in this section. If an order is not paid, it remains in the cart only.
  const flattenedPlates: FlattenedPlateItem[] = useMemo(() => {
    const list: FlattenedPlateItem[] = [];

    sessionOrders.forEach((ord) => {
      const isPaid =
        ord.payment_status === 'PAID' ||
        ord.status === 'CONFIRMED' ||
        ord.status === 'PREPARING' ||
        ord.status === 'READY' ||
        ord.status === 'SERVED' ||
        ord.status === 'BILLED';
      // Strict rule: Only paid orders are visible in this section. Unpaid/pending remain in the cart only.
      if (!isPaid) return;

      const orderNumber = ord.id.slice(0, 6).toUpperCase();

      ord.items.forEach((it) => {
        const qty = Math.max(1, it.quantity || 1);
        const parsed = parseOrderItemNotes(it.notes, it.name_snapshot);
        const itemModifiers = Array.isArray(it.modifiers) ? it.modifiers : [];
        const modsTotalPaise = itemModifiers.reduce((sum, m) => sum + (Number(m.price_paise) || 0), 0);
        const isPostMeal = isDessertOrPostMealItem(it.name_snapshot, it.notes);

        // Calculate minor unit base price per plate
        const basePricePaise = it.unit_price_paise || (it.line_total_paise ? Math.round(it.line_total_paise / qty) : 0);
        const plateTotalPaise = basePricePaise + modsTotalPaise;

        for (let pIdx = 1; pIdx <= qty; pIdx++) {
          let resolvedPlateName: string;
          if (parsed.plateName) {
            resolvedPlateName = qty > 1 && !parsed.plateName.includes(`${pIdx}`)
              ? `${parsed.plateName} (Plate ${pIdx})`
              : parsed.plateName;
          } else {
            resolvedPlateName = `Plate ${pIdx}`;
          }

          const plateKey = `${ord.id}-${it.id}-${pIdx}`;
          const isReleased = !!releasedHoldPlateKeys[plateKey];
          const plateItemStatus = (it as { status?: string }).status || ord.status;
          const isPlateServed = plateItemStatus === 'SERVED' || ord.status === 'SERVED' || ord.status === 'BILLED';
          const isPlateCancelled = plateItemStatus === 'CANCELLED' || ord.status === 'CANCELLED';
          const isOnHold =
            isPaid &&
            isPostMeal &&
            !isReleased &&
            !isPlateServed &&
            !isPlateCancelled &&
            (plateItemStatus === 'PENDING' ||
              plateItemStatus === 'CONFIRMED' ||
              ord.status === 'CONFIRMED' ||
              ord.status === 'PREPARING');

          list.push({
            plateKey,
            orderId: ord.id,
            orderNumber,
            tableId: it.target_table_id || null,
            tableNumber: it.target_table_number || ord.table_number || selectedTable || '--',
            orderCreatedAt: ord.created_at,
            itemCreatedAt: it.created_at || ord.created_at,
            orderStatus: isPlateServed ? 'SERVED' : isPlateCancelled ? 'CANCELLED' : ord.status,
            isPaid,
            paymentMethod: ord.payment_method || (isPaid ? 'UPI' : null),
            paymentSettledAt: ord.payment_settled_at || (isPaid ? ord.created_at : null),
            itemId: it.id,
            itemName: it.name_snapshot,
            plateName: resolvedPlateName,
            portion: parsed.portion,
            plateIndex: pIdx,
            totalPlatesForLine: qty,
            basePricePaise,
            modifiers: itemModifiers,
            modifiersTotalPaise: modsTotalPaise,
            plateTotalPaise,
            spiceLevel: parsed.spiceLevel,
            kitchenNote: parsed.kitchenNote,
            rawNotes: it.notes,
            isOnHold,
            itemStatus: plateItemStatus,
          });
        }
      });
    });

    return list;
  }, [sessionOrders, selectedTable, releasedHoldPlateKeys]);

  // Four distinct order sections: PREPARING (Cooking), ON_HOLD (Serve Later), SERVED, CANCELLED
  const onHoldPlates = useMemo(
    () => flattenedPlates.filter((p) => p.isOnHold),
    [flattenedPlates],
  );

  const preparingPlates = useMemo(
    () =>
      flattenedPlates.filter(
        (p) =>
          !p.isOnHold &&
          (p.orderStatus === 'PREPARING' ||
            p.orderStatus === 'CONFIRMED' ||
            p.orderStatus === 'READY' ||
            p.orderStatus === 'PENDING'),
      ),
    [flattenedPlates],
  );

  const servedPlates = useMemo(
    () =>
      flattenedPlates.filter(
        (p) => p.orderStatus === 'SERVED' || p.orderStatus === 'BILLED',
      ),
    [flattenedPlates],
  );

  const cancelledPlates = useMemo(
    () => flattenedPlates.filter((p) => p.orderStatus === 'CANCELLED'),
    [flattenedPlates],
  );

  const togglePlateExpanded = (plateKey: string) => {
    setExpandedPlateKeys((prev) => ({
      ...prev,
      [plateKey]: !prev[plateKey],
    }));
  };

  const handleToggleExpandAllPlates = (platesToToggle: FlattenedPlateItem[]) => {
    const allExpanded = platesToToggle.length > 0 && platesToToggle.every((p) => expandedPlateKeys[p.plateKey]);
    const nextState: Record<string, boolean> = { ...expandedPlateKeys };
    platesToToggle.forEach((p) => {
      nextState[p.plateKey] = !allExpanded;
    });
    setExpandedPlateKeys(nextState);
  };

  // Fly-to-Cart Trigger
  const triggerFlyToCart = (e: React.MouseEvent, imgUrl: string) => {
    if (!cartIconRef.current) return;
    const targetRect = cartIconRef.current.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const deltaX = targetRect.left + targetRect.width / 2 - startX;
    const deltaY = targetRect.top + targetRect.height / 2 - startY;

    setFlyingGhost({
      startX,
      startY,
      targetX: deltaX,
      targetY: deltaY,
      imgUrl,
    });

    setTimeout(() => {
      setFlyingGhost(null);
      setCartPulse(true);
      setTimeout(() => setCartPulse(false), 400);
    }, 380);
  };

  // Add Item to Cart (Direct or with Customization)
  const handleQuickAdd = (item: MenuItem, e: React.MouseEvent) => {
    e.stopPropagation();
    // If item has modifiers or requires customization, open accordion
    if (item.modifiers && item.modifiers.length > 0) {
      handleOpenAccordion(item);
      return;
    }

    triggerFlyToCart(e, item.imageUrl);

    setCartLines((prev) => {
      const existingIdx = prev.findIndex((c) => c.item.id === item.id && !c.plateLabel && !c.notes);
      if (existingIdx >= 0) {
        const copy = [...prev];
        copy[existingIdx] = {
          ...copy[existingIdx]!,
          quantity: copy[existingIdx]!.quantity + 1,
        };
        return copy;
      }
      return [
        ...prev,
        {
          cartLineId: `${item.id}-${Date.now()}`,
          item,
          quantity: 1,
          spiceLevel: item.spiceLevel,
          selectedModifiers: [],
        },
      ];
    });
  };

  const handleQuickDecrement = (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCartLines((prev) => {
      const idx = prev.findIndex((c) => c.item.id === itemId);
      if (idx < 0) return prev;
      const target = prev[idx]!;
      if (target.quantity <= 1) {
        return prev.filter((_, i) => i !== idx);
      }
      const copy = [...prev];
      copy[idx] = { ...target, quantity: target.quantity - 1 };
      return copy;
    });
  };

  // Accordion Open / Configure
  const handleOpenAccordion = (item: MenuItem) => {
    if (item.category === 'Combos' || COMBO_OFFERS.some((c) => c.id === item.id)) {
      const combo = COMBO_OFFERS.find((c) => c.id === item.id) || COMBO_OFFERS[0]!;
      openComboCustomizer(combo);
      return;
    }

    const groups = resolveItemModifierGroups(item);
    const initialMods: ModifierOption[] = [];
    groups.forEach((g) => {
      if (g.selectionType === 'SINGLE' && g.isRequired && g.modifiers.length > 0) {
        const preferred =
          g.modifiers.find((m) => {
            const nl = m.name.toLowerCase();
            return (
              (nl.includes('regular') || nl.includes('medium') || nl.includes('normal') || nl.includes('standard')) &&
              m.pricePaise === 0
            );
          }) ||
          g.modifiers.find((m) => m.pricePaise === 0) ||
          g.modifiers[0];
        if (preferred) {
          initialMods.push(preferred);
        }
      }
    });

    setExpandedAccordionItemId(item.id);
    setActiveCustomizingItem(item);
    setAccordionQty(1);
    setAccordionPortion('FULL');
    setAccordionSpice(item.spiceLevel);
    setAccordionNote('');
    setAccordionModifiers(initialMods);
    setIsPerPlateSplit(false);
    setActivePlateIndex(1);
    setPlateConfigs([
      {
        plateIndex: 1,
        portion: 'FULL',
        spice: item.spiceLevel,
        notes: '',
        modifiers: [...initialMods],
      },
    ]);
  };

  // ── Homepage Navigation Handlers (Navigates to Menu, Scrolls to Product at Top & Opens Customizer) ──
  const navigateToMenuItem = (item: MenuItem) => {
    setSearchQuery('');
    if (dietaryFilter !== 'ALL' && item.dietaryTag !== dietaryFilter) {
      setDietaryFilter('ALL');
    }
    setCurrentView('menu');
    setActiveCategory(item.category);
    const pillEl = document.getElementById(`pill-${item.category}`);
    if (pillEl) {
      pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    handleOpenAccordion(item);
    setTimeout(() => {
      const el = document.getElementById(`menu-item-${item.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('item-highlight-pulse');
        setTimeout(() => el.classList.remove('item-highlight-pulse'), 2500);
      } else {
        const catEl = document.getElementById(`cat-section-${item.category}`);
        if (catEl) {
          catEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 120);
  };

  const navigateToCombo = (combo: ComboOffer) => {
    setSearchQuery('');
    setDietaryFilter('ALL');
    setCurrentView('menu');
    setActiveCategory('Combos');
    const pillEl = document.getElementById('pill-Combos');
    if (pillEl) {
      pillEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
    openComboCustomizer(combo);
    setTimeout(() => {
      const el = document.getElementById(`menu-item-${combo.id}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.classList.add('item-highlight-pulse');
        setTimeout(() => el.classList.remove('item-highlight-pulse'), 2500);
      } else {
        const catEl = document.getElementById('cat-section-Combos');
        if (catEl) {
          catEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    }, 120);
  };

  // When quantity changes in accordion and per-plate is active, update plateConfigs
  const handleAccordionQtyChange = (newQty: number) => {
    const q = Math.max(1, newQty);
    setAccordionQty(q);
    if (isPerPlateSplit) {
      setPlateConfigs((prev) => {
        const updated = [...prev];
        while (updated.length < q) {
          updated.push({
            plateIndex: updated.length + 1,
            portion: accordionPortion,
            spice: accordionSpice,
            notes: '',
            modifiers: [...accordionModifiers],
          });
        }
        return updated.slice(0, q);
      });
      setActivePlateIndex((curr) => Math.min(curr, q));
    }
  };

  const handleTogglePerPlateSplit = () => {
    const nextVal = !isPerPlateSplit;
    setIsPerPlateSplit(nextVal);
    setActivePlateIndex(1);
    if (nextVal) {
      const initialConfigs = Array.from({ length: accordionQty }, (_, i) => ({
        plateIndex: i + 1,
        portion: accordionPortion,
        spice: accordionSpice,
        notes: accordionNote ? `${accordionNote} (Plate ${i + 1})` : '',
        modifiers: [...accordionModifiers],
      }));
      setPlateConfigs(initialConfigs);
    }
  };

  // Add Configured Accordion Item to Cart
  const handleAddAccordionToCart = (item: MenuItem, e: React.MouseEvent) => {
    triggerFlyToCart(e, item.imageUrl);
    const { fullPaise, halfPaise } = getPortionPricing(item);

    if (isPerPlateSplit && accordionQty > 1) {
      // Split into N distinct cart lines: Plate 1, Plate 2...
      const newLines: CartLineItem[] = plateConfigs.map((cfg) => {
        const isHalf = cfg.portion === 'HALF';
        const basePaise = isHalf ? halfPaise : fullPaise;
        const portionTag = isHalf ? ' [HALF]' : '';
        const plateName = cfg.customName && cfg.customName.trim() ? cfg.customName.trim() : `Plate ${cfg.plateIndex}`;
        return {
          cartLineId: `${item.id}-plate-${cfg.plateIndex}-${Date.now()}-${Math.random()}`,
          item: { ...item, pricePaise: basePaise },
          portion: cfg.portion || 'FULL',
          plateLabel: `${plateName}${isHalf ? ' (Half)' : ''}`,
          quantity: 1,
          spiceLevel: cfg.spice,
          notes: `${cfg.notes || ''}${portionTag}`.trim() || undefined,
          selectedModifiers: cfg.modifiers,
        };
      });
      setCartLines((prev) => [...prev, ...newLines]);
    } else {
      // Combined single line for N plates
      const isHalf = accordionPortion === 'HALF';
      const basePaise = isHalf ? halfPaise : fullPaise;
      const portionTag = isHalf ? ' [HALF]' : '';
      const customName = plateConfigs[0]?.customName && plateConfigs[0].customName.trim() ? plateConfigs[0].customName.trim() : undefined;
      const newLine: CartLineItem = {
        cartLineId: `${item.id}-${Date.now()}-${Math.random()}`,
        item: { ...item, pricePaise: basePaise },
        portion: accordionPortion,
        plateLabel: customName ? `${customName}${isHalf ? ' (Half)' : ''}` : undefined,
        quantity: accordionQty,
        spiceLevel: accordionSpice,
        notes: `${accordionNote || ''}${portionTag}`.trim() || undefined,
        selectedModifiers: accordionModifiers,
      };
      setCartLines((prev) => [...prev, newLine]);
    }

    setExpandedAccordionItemId(null);
    setActiveCustomizingItem(null);
    showToast(`Added ${item.name} to cart! 🍽️`);
  };

  // ── Combo Customization Handlers ──
  const openComboCustomizer = (combo: ComboOffer) => {
    setActiveComboOffer(combo);
    const initialDishPlates: Record<string, ComboDishPlate[]> = {};
    const initialActivePlateIds: Record<string, string> = {};
    const defaultDrinks: Record<string, string> = {};
    const defaultBreadType: Record<string, string> = {};

    combo.components.forEach((c) => {
      if (c.categoryType === 'MAIN' || c.categoryType === 'RICE' || c.categoryType === 'STARTER') {
        const plates: ComboDishPlate[] = [];
        const count = Math.max(1, c.includedQty || 1);
        for (let i = 1; i <= count; i++) {
          const pId = `${c.id}-plate-${i}`;
          plates.push({
            plateId: pId,
            plateNumber: i,
            customName: `Plate ${i}`,
            isExtraPlate: false,
            pricePaise: 0,
            portion: c.defaultPortion || 'FULL',
            spice: c.spiceChoice ? 'MEDIUM' : 'NONE',
            notes: '',
            selectedModifiers: [],
          });
        }
        initialDishPlates[c.id] = plates;
        initialActivePlateIds[c.id] = plates[0]!.plateId;
      }

      if (c.categoryType === 'BEVERAGE' && c.options && c.options.length > 0) {
        defaultDrinks[c.id] = c.options[0]!;
      }
      if (c.categoryType === 'BREAD' && c.options && c.options.length > 0) {
        defaultBreadType[c.id] = c.options[0]!;
      }
    });

    setComboDishPlates(initialDishPlates);
    setActiveDishPlateId(initialActivePlateIds);
    setComboDrinkChoices(defaultDrinks);
    setComboBreadType(defaultBreadType);
    setComboExtraBreadsQty(0);
    setComboExtraDrinksQty(0);
  };

  const handleAddDishPlate = (comp: ComboComponentConfig) => {
    const curPlates = comboDishPlates[comp.id] || [];
    const nextNum = curPlates.length + 1;
    const newPlateId = `${comp.id}-extra-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newPlate: ComboDishPlate = {
      plateId: newPlateId,
      plateNumber: nextNum,
      customName: `Plate ${nextNum}`,
      isExtraPlate: true,
      pricePaise: comp.extraPlatePricePaise,
      portion: comp.defaultPortion || 'FULL',
      spice: comp.spiceChoice ? 'MEDIUM' : 'NONE',
      notes: '',
      selectedModifiers: [],
    };

    setComboDishPlates((prev) => ({
      ...prev,
      [comp.id]: [...(prev[comp.id] || []), newPlate],
    }));
    setActiveDishPlateId((prev) => ({
      ...prev,
      [comp.id]: newPlateId,
    }));
  };

  const handleRemoveDishPlate = (compId: string, plateId: string) => {
    setComboDishPlates((prev) => {
      const list = prev[compId] || [];
      const filtered = list.filter((p) => p.plateId !== plateId);
      return {
        ...prev,
        [compId]: filtered,
      };
    });
    setActiveDishPlateId((prev) => {
      const list = (comboDishPlates[compId] || []).filter((p) => p.plateId !== plateId);
      return {
        ...prev,
        [compId]: list[0]?.plateId || '',
      };
    });
  };

  const handleUpdateDishPlateName = (compId: string, plateId: string, newName: string) => {
    setComboDishPlates((prev) => ({
      ...prev,
      [compId]: (prev[compId] || []).map((p) =>
        p.plateId === plateId ? { ...p, customName: newName } : p
      ),
    }));
  };

  const handleUpdateDishPlatePortion = (compId: string, plateId: string, portion: 'FULL' | 'HALF') => {
    setComboDishPlates((prev) => ({
      ...prev,
      [compId]: (prev[compId] || []).map((p) =>
        p.plateId === plateId ? { ...p, portion } : p
      ),
    }));
  };

  const handleUpdateDishPlateSpice = (compId: string, plateId: string, spice: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE') => {
    setComboDishPlates((prev) => ({
      ...prev,
      [compId]: (prev[compId] || []).map((p) =>
        p.plateId === plateId ? { ...p, spice } : p
      ),
    }));
  };

  const handleUpdateDishPlateNotes = (compId: string, plateId: string, notes: string) => {
    setComboDishPlates((prev) => ({
      ...prev,
      [compId]: (prev[compId] || []).map((p) =>
        p.plateId === plateId ? { ...p, notes } : p
      ),
    }));
  };

  const handleToggleDishPlateChip = (compId: string, plateId: string, chip: string) => {
    setComboDishPlates((prev) => {
      const list = prev[compId] || [];
      return {
        ...prev,
        [compId]: list.map((p) => {
          if (p.plateId === plateId) {
            const updatedNotes = toggleChipInNotes(p.notes, chip);
            return { ...p, notes: updatedNotes };
          }
          return p;
        }),
      };
    });
  };

  const handleToggleDishPlateModifier = (compId: string, plateId: string, mod: ModifierOption) => {
    setComboDishPlates((prev) => {
      const list = prev[compId] || [];
      return {
        ...prev,
        [compId]: list.map((p) => {
          if (p.plateId === plateId) {
            const exists = p.selectedModifiers.some((m) => m.id === mod.id);
            const updatedMods = exists
              ? p.selectedModifiers.filter((m) => m.id !== mod.id)
              : [...p.selectedModifiers, mod];
            return { ...p, selectedModifiers: updatedMods };
          }
          return p;
        }),
      };
    });
  };

  // ── Plate Naming & Diner Profile Handlers ──
  const handleOpenPlateNamingModal = (target: {
    type: 'COMBO' | 'ITEM';
    compId?: string;
    plateId?: string;
    plateIndex?: number;
    currentName: string;
  }) => {
    setPlateNamingTarget(target);
    setPlateNameInput(target.currentName || '');
    setShowNewProfileForm(false);
  };

  const handleApplyProfileToPlate = (profile: DinerProfile) => {
    if (!plateNamingTarget) return;

    if (plateNamingTarget.type === 'COMBO' && plateNamingTarget.compId && plateNamingTarget.plateId) {
      const comp = activeComboOffer?.components.find((c) => c.id === plateNamingTarget.compId);
      const catType = comp?.categoryType || 'MAIN';
      const cat =
        catType === 'RICE'
          ? 'Biryani & Rice'
          : catType === 'BEVERAGE'
          ? 'Beverages'
          : catType === 'DESSERT'
          ? 'Desserts'
          : catType === 'STARTER'
          ? 'Starters'
          : 'Main Course';

      const applied = applyProfileToContext(profile, {
        category: cat,
        itemName: comp?.name || '',
        availableModifierGroups: [],
      });

      setComboDishPlates((prev) => {
        const list = prev[plateNamingTarget.compId!] || [];
        return {
          ...prev,
          [plateNamingTarget.compId!]: list.map((p) => {
            if (p.plateId === plateNamingTarget.plateId) {
              return {
                ...p,
                customName: applied.appliedName,
                spice: applied.spiceLevel !== 'NONE' ? applied.spiceLevel : p.spice,
                notes: applied.chefNotes || p.notes,
                selectedModifiers: applied.selectedModifiers.length > 0 ? applied.selectedModifiers : p.selectedModifiers,
              };
            }
            return p;
          }),
        };
      });

      showToast(applied.toastMessage);
      setPlateNamingTarget(null);
      return;
    }

    if (plateNamingTarget.type === 'ITEM') {
      const currentItem =
        activeCustomizingItem ||
        menuItems.find((m) => m.id === expandedAccordionItemId) ||
        PILOT_MENU.find((m) => m.id === expandedAccordionItemId);
      const cat = currentItem?.category || 'Main Course';
      const itemName = currentItem?.name || '';
      const groups = currentItem ? resolveItemModifierGroups(currentItem) : [];

      const applied = applyProfileToContext(profile, {
        category: cat,
        itemName,
        availableModifierGroups: groups,
      });

      const isMultiPlate = isPerPlateSplit && accordionQty > 1;
      if (isMultiPlate && plateNamingTarget.plateIndex) {
        setPlateConfigs((prev) =>
          prev.map((p) => {
            if (p.plateIndex === plateNamingTarget.plateIndex) {
              return {
                ...p,
                customName: applied.appliedName,
                spice: applied.spiceLevel !== 'NONE' ? applied.spiceLevel : p.spice,
                notes: applied.chefNotes || p.notes,
                modifiers: applied.selectedModifiers.length > 0 ? applied.selectedModifiers : p.modifiers,
              };
            }
            return p;
          })
        );
      } else {
        if (applied.spiceLevel !== 'NONE') setAccordionSpice(applied.spiceLevel);
        setAccordionNote(applied.chefNotes);
        if (applied.selectedModifiers.length > 0) {
          setAccordionModifiers((prev) => {
            const groupIdsToReplace = new Set(applied.selectedModifiers.map((m) => m.groupId).filter(Boolean));
            const filtered = prev.filter((m) => !m.groupId || !groupIdsToReplace.has(m.groupId));
            return [...filtered, ...applied.selectedModifiers];
          });
        }
        setPlateConfigs((prev) =>
          prev.map((p, idx) =>
            idx === 0
              ? {
                  ...p,
                  customName: applied.appliedName,
                  spice: applied.spiceLevel !== 'NONE' ? applied.spiceLevel : p.spice,
                  notes: applied.chefNotes,
                }
              : p
          )
        );
      }

      showToast(applied.toastMessage);
      setPlateNamingTarget(null);
    }
  };

  const handleApplyProfileToEntireFeast = (profile: DinerProfile) => {
    if (!activeComboOffer) return;

    setComboDishPlates((prev) => {
      const updated = { ...prev };
      activeComboOffer.components.forEach((comp) => {
        const catType = comp.categoryType;
        const cat =
          catType === 'RICE'
            ? 'Biryani & Rice'
            : catType === 'BEVERAGE'
            ? 'Beverages'
            : catType === 'DESSERT'
            ? 'Desserts'
            : catType === 'STARTER'
            ? 'Starters'
            : 'Main Course';

        const applied = applyProfileToContext(profile, {
          category: cat,
          itemName: comp.name,
          availableModifierGroups: [],
        });

        const list = updated[comp.id] || [];
        updated[comp.id] = list.map((p, idx) => {
          if (idx === 0) {
            return {
              ...p,
              customName: applied.appliedName,
              spice: applied.spiceLevel !== 'NONE' ? applied.spiceLevel : p.spice,
              notes: applied.chefNotes || p.notes,
              selectedModifiers: applied.selectedModifiers.length > 0 ? applied.selectedModifiers : p.selectedModifiers,
            };
          }
          return p;
        });
      });
      return updated;
    });

    showToast(`Applied ${profile.name}'s feast preferences across Biryani, Drinks & Desserts! 👨‍🍳`);
    setPlateNamingTarget(null);
  };

  // ── Profile Preferences Editor Handlers (Open/Edit/Create/Save/Delete) ──
  const handleStartEditProfile = (profile: DinerProfile) => {
    setEditingDinerProfile(profile);
    setIsNewDinerProfile(false);
    setEditorName(profile.name);
    setEditorSpice(profile.preferences?.spicePreference || (profile.spicePreference as any) || 'MEDIUM');
    setEditorOnionGarlic(profile.preferences?.onionGarlicPreference || 'WITH_ONION_GARLIC');
    setEditorOil(profile.preferences?.cookingOilPreference || 'REGULAR_OIL');
    setEditorCrispy(profile.preferences?.crispinessPreference || 'REGULAR');
    setEditorBiryaniRaita(profile.preferences?.biryaniRaitaPreference || 'REGULAR');
    setEditorBiryaniOnion(profile.preferences?.biryaniOnionPreference || 'REGULAR');
    setEditorMilk(profile.preferences?.milkPreference || 'REGULAR_MILK');
    setEditorSugar(profile.preferences?.sugarPreference || 'REGULAR_SUGAR');
    setEditorHotTemp(profile.preferences?.hotBeverageTemp || 'REGULAR_HOT');
    setEditorColdIce(profile.preferences?.coldBeverageIce || 'REGULAR_ICE');
    setEditorStrength(profile.preferences?.beverageStrength || 'MEDIUM_STRENGTH');
    setEditorDessertSweet(profile.preferences?.dessertSweetness || 'REGULAR_SWEET');
    setEditorDessertTemp(profile.preferences?.dessertTemp || 'SERVED_WARM');
    setEditorNutAllergy(profile.preferences?.nutAllergyPreference || 'REGULAR_NUTS');
    setEditorNotes(profile.notes || '');
  };

  const handleStartCreateProfile = (initialName = '') => {
    const newTemplate: DinerProfile = {
      id: `dp-${Date.now()}`,
      name: initialName || 'New Diner',
      spicePreference: 'MEDIUM',
      kitchenInstructions: [],
      preferences: {
        spicePreference: 'MEDIUM',
        onionGarlicPreference: 'WITH_ONION_GARLIC',
        cookingOilPreference: 'REGULAR_OIL',
        crispinessPreference: 'REGULAR',
        biryaniRaitaPreference: 'REGULAR',
        biryaniOnionPreference: 'REGULAR',
        milkPreference: 'REGULAR_MILK',
        sugarPreference: 'REGULAR_SUGAR',
        hotBeverageTemp: 'REGULAR_HOT',
        coldBeverageIce: 'REGULAR_ICE',
        beverageStrength: 'MEDIUM_STRENGTH',
        dessertSweetness: 'REGULAR_SWEET',
        dessertTemp: 'SERVED_WARM',
        nutAllergyPreference: 'REGULAR_NUTS',
      },
    };
    setEditingDinerProfile(newTemplate);
    setIsNewDinerProfile(true);
    setEditorName(initialName);
    setEditorSpice('MEDIUM');
    setEditorOnionGarlic('WITH_ONION_GARLIC');
    setEditorOil('REGULAR_OIL');
    setEditorCrispy('REGULAR');
    setEditorBiryaniRaita('REGULAR');
    setEditorBiryaniOnion('REGULAR');
    setEditorMilk('REGULAR_MILK');
    setEditorSugar('REGULAR_SUGAR');
    setEditorHotTemp('REGULAR_HOT');
    setEditorColdIce('REGULAR_ICE');
    setEditorStrength('MEDIUM_STRENGTH');
    setEditorDessertSweet('REGULAR_SWEET');
    setEditorDessertTemp('SERVED_WARM');
    setEditorNutAllergy('REGULAR_NUTS');
    setEditorNotes('');
  };

  const handleSaveProfileForm = () => {
    if (!editingDinerProfile) return;
    const trimmedName = editorName.trim() || 'Diner';

    const instructions: string[] = [];
    if (editorSpice === 'MILD') instructions.push('Mild');
    else if (editorSpice === 'HOT' || editorSpice === 'EXTRA_SPICY') instructions.push('Extra Spicy');
    if (editorOnionGarlic === 'NO_ONION_GARLIC') instructions.push('No Onion / Garlic');
    if (editorOil === 'LESS_OIL_BUTTER') instructions.push('Less Oil');
    if (editorCrispy === 'EXTRA_CRISPY') instructions.push('Extra Crispy');
    if (editorMilk === 'OAT_MILK') instructions.push('Oat Milk');
    if (editorSugar === 'SUGAR_FREE') instructions.push('Sugar-Free');
    else if (editorSugar === 'LESS_SUGAR') instructions.push('Less Sugar');
    else if (editorSugar === 'JAGGERY') instructions.push('Jaggery (Gud)');
    if (editorNutAllergy === 'NO_NUTS_ALLERGY') instructions.push('No Nuts');

    const updatedProfile: DinerProfile = {
      id: editingDinerProfile.id,
      name: trimmedName,
      spicePreference: editorSpice === 'EXTRA_SPICY' ? 'HOT' : (editorSpice as any) || 'MEDIUM',
      dietaryPreference: editorOnionGarlic === 'NO_ONION_GARLIC' ? 'JAIN' : 'ANY',
      kitchenInstructions: instructions,
      notes: editorNotes.trim(),
      preferences: {
        spicePreference: editorSpice,
        onionGarlicPreference: editorOnionGarlic,
        cookingOilPreference: editorOil,
        crispinessPreference: editorCrispy,
        biryaniRaitaPreference: editorBiryaniRaita,
        biryaniOnionPreference: editorBiryaniOnion,
        milkPreference: editorMilk,
        sugarPreference: editorSugar,
        hotBeverageTemp: editorHotTemp,
        coldBeverageIce: editorColdIce,
        beverageStrength: editorStrength,
        dessertSweetness: editorDessertSweet,
        dessertTemp: editorDessertTemp,
        nutAllergyPreference: editorNutAllergy,
      },
    };

    // Save strictly to real PostgreSQL database
    if (isNewDinerProfile) {
      if (customerToken && customerId) {
        customerApiFetch(
          '/api/v1/auth/customer/diner-profiles',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: trimmedName,
              relationshipTag: 'FRIEND',
              spicePreference: updatedProfile.spicePreference,
              dietaryPreference: updatedProfile.dietaryPreference,
              kitchenInstructions: updatedProfile.kitchenInstructions,
              notes: updatedProfile.notes,
              preferences: updatedProfile.preferences,
            }),
          },
          { preferToken: 'customer', tokenOverride: customerToken, orgIdOverride: activeOrgId },
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((saved) => {
            if (saved) {
              const realProfile: DinerProfile = {
                id: saved.id,
                name: saved.name,
                spicePreference: saved.spice_preference || saved.spicePreference || 'MEDIUM',
                dietaryPreference: saved.dietary_preference || saved.dietaryPreference || 'ANY',
                kitchenInstructions: saved.kitchen_instructions || saved.kitchenInstructions || [],
                notes: saved.notes || '',
                preferences: saved.preferences || {},
              };
              setDinerProfiles((prev) => [...prev.filter((p) => p.id !== updatedProfile.id), realProfile]);
            }
          })
          .catch(() => {});
      } else {
        setDinerProfiles((prev) => [...prev, updatedProfile]);
      }
    } else {
      // Editing existing profile in real database
      if (customerToken && editingDinerProfile?.id) {
        customerApiFetch(
          `/api/v1/auth/customer/diner-profiles/${encodeURIComponent(editingDinerProfile.id)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: trimmedName,
              relationshipTag: 'FRIEND',
              spicePreference: updatedProfile.spicePreference,
              dietaryPreference: updatedProfile.dietaryPreference,
              kitchenInstructions: updatedProfile.kitchenInstructions,
              notes: updatedProfile.notes,
              preferences: updatedProfile.preferences,
            }),
          },
          { preferToken: 'customer', tokenOverride: customerToken, orgIdOverride: activeOrgId },
        )
          .then((r) => (r.ok ? r.json() : null))
          .then((saved) => {
            if (saved) {
              setDinerProfiles((prev) =>
                prev.map((p) =>
                  p.id === saved.id
                    ? {
                        id: saved.id,
                        name: saved.name,
                        spicePreference: saved.spice_preference || saved.spicePreference || 'MEDIUM',
                        dietaryPreference: saved.dietary_preference || saved.dietaryPreference || 'ANY',
                        kitchenInstructions: saved.kitchen_instructions || saved.kitchenInstructions || [],
                        notes: saved.notes || '',
                        preferences: saved.preferences || {},
                      }
                    : p
                )
              );
            }
          })
          .catch(() => {});
      } else {
        setDinerProfiles((prev) => prev.map((p) => (p.id === updatedProfile.id ? updatedProfile : p)));
      }
    }

    showToast(`Saved ${trimmedName}'s preferences in database! 👨‍🍳`);
    setEditingDinerProfile(null);
  };

  const handleDeleteDinerProfile = (id: string) => {
    if (customerToken) {
      customerApiFetch(
        '/api/v1/auth/customer/diner-profiles/delete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        },
        { preferToken: 'customer', tokenOverride: customerToken, orgIdOverride: activeOrgId },
      ).catch(() => {});
    }
    setDinerProfiles((prev) => prev.filter((p) => p.id !== id));
    showToast('Profile removed from database');
  };

  const handleSaveCustomPlateName = () => {
    if (!plateNamingTarget) return;
    const trimmed = plateNameInput.trim();
    if (!trimmed) {
      setPlateNamingTarget(null);
      return;
    }

    if (plateNamingTarget.type === 'COMBO' && plateNamingTarget.compId && plateNamingTarget.plateId) {
      setComboDishPlates((prev) => {
        const list = prev[plateNamingTarget.compId!] || [];
        return {
          ...prev,
          [plateNamingTarget.compId!]: list.map((p) =>
            p.plateId === plateNamingTarget.plateId ? { ...p, customName: trimmed } : p
          ),
        };
      });
    } else if (plateNamingTarget.type === 'ITEM') {
      const isMultiPlate = isPerPlateSplit && accordionQty > 1;
      if (isMultiPlate && plateNamingTarget.plateIndex) {
        setPlateConfigs((prev) =>
          prev.map((p) =>
            p.plateIndex === plateNamingTarget.plateIndex ? { ...p, customName: trimmed } : p
          )
        );
      } else {
        setPlateConfigs((prev) =>
          prev.map((p, idx) => (idx === 0 ? { ...p, customName: trimmed } : p))
        );
      }
    }

    showToast(`Plate named "${trimmed}" 🍽️`);
    setPlateNamingTarget(null);
  };

  const handleSaveNewProfile = async () => {
    const trimmed = plateNameInput.trim();
    if (!trimmed) {
      showToast('Please enter a name for the diner profile');
      return;
    }

    const instructions = newProfileNotes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    let createdId = `dp-${Date.now()}`;
    if (customerToken && customerId) {
      try {
        const res = await customerApiFetch(
          '/api/v1/auth/customer/diner-profiles',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: trimmed,
              relationshipTag: 'FRIEND',
              spicePreference: newProfileSpice,
              dietaryPreference: 'ANY',
              kitchenInstructions: instructions.length > 0 ? instructions : ['Regular Spice', 'Standard Prep'],
              notes: 'Custom dining profile',
            }),
          },
          { preferToken: 'customer', tokenOverride: customerToken, orgIdOverride: activeOrgId },
        );
        if (res.ok) {
          const saved = await res.json();
          createdId = saved.id;
        }
      } catch {}
    }

    const newProfile: DinerProfile = {
      id: createdId,
      name: trimmed,
      spicePreference: newProfileSpice,
      dietaryPreference: 'ANY',
      kitchenInstructions: instructions.length > 0 ? instructions : ['Regular Spice', 'Standard Prep'],
      notes: 'Custom dining profile',
    };

    setDinerProfiles((prev) => [...prev, newProfile]);
    handleApplyProfileToPlate(newProfile);
    setShowNewProfileForm(false);
    setNewProfileNotes('');
  };

  const handleAddComboToCart = () => {
    if (!activeComboOffer) return;

    // Find live matching MenuItem from menuItems (or fallback to PILOT_MENU)
    const matchingItem =
      menuItems.find((m) => m.id === activeComboOffer.id) ||
      PILOT_MENU.find((p) => p.id === activeComboOffer.id) || {
        id: activeComboOffer.id,
        name: activeComboOffer.name,
        description: activeComboOffer.description,
        category: 'Combos' as const,
        pricePaise: activeComboOffer.comboPricePaise,
        dietaryTag: activeComboOffer.vegType,
        spiceLevel: 'MEDIUM' as const,
        cuisine: 'NORTH_INDIAN' as const,
        isHealthy: false,
        isAvailable: true,
        rating: activeComboOffer.rating,
        ordersCount: 850,
        prepTimeMinutes: activeComboOffer.prepTimeMinutes,
        imageUrl: activeComboOffer.imageUrl,
      };

    // Calculate additions
    let extraPlatesAndModifiersSum = 0;
    const selectedMods: ModifierOption[] = [];
    const instructions: string[] = [];

    activeComboOffer.components.forEach((c) => {
      if (c.categoryType === 'MAIN' || c.categoryType === 'RICE' || c.categoryType === 'STARTER') {
        const plates = comboDishPlates[c.id] || [];
        const dishSummary: string[] = [];

        plates.forEach((p) => {
          // Extra plate charge
          if (p.isExtraPlate && p.pricePaise > 0) {
            extraPlatesAndModifiersSum += p.pricePaise;
            selectedMods.push({
              id: c.modifierId || `mod-extra-${p.plateId}`,
              name: `Extra Plate: ${c.name} (${p.customName})`,
              pricePaise: p.pricePaise,
              groupId: 'dd000000-0000-4000-8000-000000000001',
            });
          }

          // Portion upgrade / downgrade adjustment (Rules 4 & 5)
          const portionDelta = getComboPlatePortionDelta(c, p.portion || 'FULL');
          if (portionDelta.portionDeltaPaise !== 0) {
            extraPlatesAndModifiersSum += portionDelta.portionDeltaPaise;
            selectedMods.push({
              id: `mod-portion-${p.plateId}`,
              name: `${portionDelta.isUpgrade ? 'Full Plate Upgrade' : 'Half Plate Portion'}: ${c.name} (${p.customName})`,
              pricePaise: portionDelta.portionDeltaPaise,
              groupId: 'dd000000-0000-4000-8000-000000000002',
            });
          }

          // Add-on modifiers charges
          p.selectedModifiers.forEach((m) => {
            extraPlatesAndModifiersSum += m.pricePaise;
            selectedMods.push({
              id: m.id,
              name: `${m.name} [for ${p.customName}]`,
              pricePaise: m.pricePaise,
              groupId: m.groupId || 'dd000000-0000-4000-8000-000000000001',
            });
          });

          // Format notes for kitchen
          const parts: string[] = [];
          if (c.allowPortionSwitch && p.portion) parts.push(p.portion === 'HALF' ? 'Half Plate' : 'Full Plate');
          if (p.spice && p.spice !== 'NONE') parts.push(`${p.spice} spice`);
          if (p.notes.trim()) parts.push(p.notes.trim());
          if (p.selectedModifiers.length > 0) {
            parts.push(`Add-ons: ${p.selectedModifiers.map((m) => m.name).join(', ')}`);
          }
          const detailsStr = parts.length > 0 ? ` (${parts.join(' · ')})` : '';
          const extraTag = p.isExtraPlate ? ' [Extra Plate]' : '';
          dishSummary.push(`[${p.customName}${extraTag}]${detailsStr}`);
        });

        if (dishSummary.length > 0) {
          instructions.push(`${c.name}: ${dishSummary.join(' | ')}`);
        }
      } else if (c.categoryType === 'BREAD') {
        const bType = comboBreadType[c.id] || c.name;
        const totalBreads = c.includedQty + comboExtraBreadsQty;
        instructions.push(`${totalBreads}x ${bType}`);
      } else if (c.categoryType === 'BEVERAGE') {
        const dChoice = comboDrinkChoices[c.id] || c.name;
        const totalDrinks = c.includedQty + comboExtraDrinksQty;
        instructions.push(`${totalDrinks}x Drink (${dChoice})`);
      } else if (c.categoryType === 'DESSERT') {
        instructions.push(c.name);
      }
    });

    const breadComp = activeComboOffer.components.find((c) => c.categoryType === 'BREAD');
    const extraBreadsSum = comboExtraBreadsQty * (breadComp?.extraPlatePricePaise || 6000);
    const extraDrinksSum = comboExtraDrinksQty * 7900;
    const isGarlicNaan = Object.values(comboBreadType).some((b) => b.includes('Garlic'));
    const breadUpgradeSum = isGarlicNaan ? 2000 : 0;

    if (comboExtraBreadsQty > 0) {
      selectedMods.push({
        id: 'dd000000-0000-4000-8000-000000000017',
        name: `${comboExtraBreadsQty}x Extra Butter Naan`,
        pricePaise: extraBreadsSum,
        groupId: 'dd000000-0000-4000-8000-000000000001',
      });
    }

    if (comboExtraDrinksQty > 0) {
      selectedMods.push({
        id: 'dd000000-0000-4000-8000-000000000018',
        name: `${comboExtraDrinksQty}x Extra Beverage`,
        pricePaise: extraDrinksSum,
        groupId: 'dd000000-0000-4000-8000-000000000001',
      });
    }

    if (breadUpgradeSum > 0) {
      selectedMods.push({
        id: 'dd000000-0000-4000-8000-000000000020',
        name: 'Upgrade to Garlic Naan (+₹20)',
        pricePaise: breadUpgradeSum,
        groupId: 'dd000000-0000-4000-8000-000000000001',
      });
    }

    const fullNotes = instructions.join(' || ');

    const newLine: CartLineItem = {
      cartLineId: `combo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      item: matchingItem,
      quantity: 1,
      portion: 'FULL',
      spiceLevel: 'NONE',
      notes: fullNotes,
      selectedModifiers: selectedMods,
      plateLabel: activeComboOffer.tag,
    };

    setCartLines((prev) => [...prev, newLine]);
    setActiveComboOffer(null);
    showToast(`Added ${activeComboOffer.name} to order! 🍽️`);
    setCartPulse(true);
    setTimeout(() => setCartPulse(false), 800);
  };

  // Remove Line from Cart Drawer
  const handleRemoveCartLine = (cartLineId: string) => {
    setCartLines((prev) => prev.filter((c) => c.cartLineId !== cartLineId));
  };

  // Apply Coupon
  const handleApplyCoupon = (code: string) => {
    const found = OFFERS_DATA.find((o) => o.code.toUpperCase() === code.trim().toUpperCase());
    if (found) {
      setAppliedCoupon(found.code);
      setCouponInput(found.code);
      showToast(`Coupon ${found.code} applied! 🎉`);
    } else {
      showToast('Invalid coupon code');
    }
  };

  // ── 10. Real Order Placement with Cook Notes & Modifiers ────────────────────
  // PAYMENT FLOW CONFIGURATION:
  // If true, PhonePe / Razorpay payment is compulsory before placing order.
  // Currently set to false temporarily for direct kitchen dine-in testing.
  // Full payment logic (PhonePe UPI QR, Simulator, Webhooks) is preserved below.
  const REQUIRE_UPFRONT_PAYMENT = false;

  const handleAssignCartLineTable = (cartLineId: string, targetTable: OutletTableInfo) => {
    setCartLines((prev) => {
      const next: CartLineItem[] = [];
      for (const line of prev) {
        if (line.cartLineId !== cartLineId) {
          next.push(line);
          continue;
        }
        if (line.quantity > 1) {
          // Split 1 plate onto the newly chosen table while keeping remaining plates on current table
          next.push({ ...line, quantity: line.quantity - 1 });
          next.push({
            ...line,
            cartLineId: `${line.cartLineId}-tbl-${Date.now()}`,
            plateLabel: line.plateLabel ? `${line.plateLabel} (Split)` : `Table ${targetTable.table_number} Plate`,
            quantity: 1,
            targetTableId: targetTable.id,
            targetTableNumber: targetTable.table_number,
          });
        } else {
          next.push({
            ...line,
            targetTableId: targetTable.id,
            targetTableNumber: targetTable.table_number,
          });
        }
      }
      return next;
    });
    setCartPlateEditingId(null);
    setCartPlateDigits('');
    showToast(`Assigned plate to Table ${targetTable.table_number} ✓`);
  };

  const handleMoveOrderPlateTable = async (plate: FlattenedPlateItem, targetTable: OutletTableInfo) => {
    if (editingOrderPlateLoading) return;
    setEditingOrderPlateLoading(true);
    try {
      const res = await customerApiFetch(
        `/api/v1/customer/orders/${encodeURIComponent(plate.orderId)}/items/${encodeURIComponent(plate.itemId)}/table`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            target_table_id: targetTable.id,
            plate_index: plate.plateIndex,
          }),
        },
        { preferToken: 'guest' },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || err.message || 'Unable to change plate table right now.');
        return;
      }
      setEditingOrderPlateKey(null);
      setEditingOrderPlateDigits('');
      if (activeSessionId) {
        await fetchSessionOrders(activeSessionId);
      }
      showToast(`Moved ${plate.itemName} (${plate.plateName}) to Table ${targetTable.table_number} ✓`);
    } catch {
      showToast('Network error updating plate table.');
    } finally {
      setEditingOrderPlateLoading(false);
    }
  };

  const handlePlaceOrder = async () => {
    if (cartLines.length === 0 || isPlacingOrder) return;
    let guestSession = loadGuestSession();
    let currentSessionId = activeSessionId || guestSession?.sessionId || '';

    // If user closed the top table prompt earlier without choosing a table, require & save at checkout.
    if (!currentSessionId || !guestSession?.guestSessionToken) {
      const tenant = resolveTenantIds(guestSession);
      const targetOutlet = activeOutletId || tenant.outletId || undefined;
      if (!cartCheckoutTableValidation.matched) {
        showToast('Please enter a valid hotel table number in the checkout box below before paying.');
        return;
      }
      const created = await establishManualTableSession(
        targetOutlet,
        cartCheckoutTableValidation.matched.table_number,
        tablePax,
      );
      if (!created) return;
      guestSession = created;
      currentSessionId = created.sessionId;
      setCartCheckoutTableDigits('');
    }

    setIsPlacingOrder(true);

    try {
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      // Map cart lines into backend items payload
      const itemsPayload = cartLines
        .map((c) => {
          let validMenuUuid = c.item.id;
          if (!uuidPattern.test(validMenuUuid)) {
            const matchingLiveItem = menuItems.find(
              (m) => m.name.toLowerCase() === c.item.name.toLowerCase() && uuidPattern.test(m.id)
            );
            validMenuUuid = matchingLiveItem ? matchingLiveItem.id : '';
          }
          if (!uuidPattern.test(validMenuUuid)) return null;

          const modifierText = c.selectedModifiers && c.selectedModifiers.length > 0
            ? `Add-ons: ${c.selectedModifiers.map((m) => m.name).join(', ')}`
            : '';
          const portionBadge = c.portion === 'HALF' ? '[HALF PLATE]' : '';
          const noteWithPlate = [
            c.plateLabel ? `[${c.plateLabel}]` : '',
            portionBadge,
            c.spiceLevel && c.spiceLevel !== 'NONE' ? `Spice: ${c.spiceLevel}` : '',
            modifierText,
            c.notes ? c.notes : '',
          ].filter(Boolean).join(' · ');

          const validModifiers = (c.selectedModifiers || [])
            .filter((m) => uuidPattern.test(m.id))
            .map((m) => ({ modifier_id: m.id }));

          return {
            menu_item_id: validMenuUuid,
            quantity: c.quantity,
            portion: c.portion || 'FULL',
            modifiers: validModifiers,
            notes: noteWithPlate || undefined,
            ...(c.targetTableId && uuidPattern.test(c.targetTableId)
              ? { target_table_id: c.targetTableId }
              : {}),
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      if (itemsPayload.length === 0) {
        showToast('Menu items are still syncing from restaurant catalog. Please try again.');
        setIsPlacingOrder(false);
        return;
      }

      const orderBody = {
        session_id: currentSessionId,
        idempotency_key: crypto.randomUUID(),
        items: itemsPayload,
      };

      const res = await customerApiFetch(
        '/api/v1/customer/orders',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(orderBody),
        },
        { preferToken: loadCustomerAuth() ? 'customer' : 'guest' },
      );

      if (res.ok) {
        const orderData = await res.json();
        setSessionOrders((prev) => {
          if (prev.some((o) => o.id === orderData.id)) return prev;
          const optimisticOrd: TableOrderRecord = {
            id: orderData.id,
            table_number: selectedTable,
            status: 'PENDING',
            subtotal_paise: orderData.subtotal_paise || cartSubtotalPaise,
            tax_paise: orderData.tax_paise || gstPaise,
            total_paise: orderData.total_paise || cartGrandTotalPaise,
            created_at: orderData.created_at || new Date().toISOString(),
            payment_status: 'PENDING',
            payment_method: selectedPaymentMethod,
            items: (orderData.items && orderData.items.length > 0)
              ? orderData.items.map((it: any) => ({
                  id: it.id,
                  name_snapshot: it.name_snapshot,
                  unit_price_paise: it.unit_price_paise,
                  quantity: it.quantity,
                  line_total_paise: it.line_total_paise,
                  notes: it.notes,
                  target_table_id: it.target_table_id || null,
                  target_table_number: it.target_table_number || null,
                  modifiers: it.modifiers || [],
                }))
              : cartLines.map((c, cIdx) => ({
                  id: `opt-item-${cIdx}-${Date.now()}`,
                  name_snapshot: c.item.name,
                  unit_price_paise: c.item.pricePaise,
                  quantity: c.quantity,
                  line_total_paise: c.item.pricePaise * c.quantity,
                  notes: c.notes,
                  target_table_id: c.targetTableId || null,
                  target_table_number: c.targetTableNumber || null,
                  modifiers: (c.selectedModifiers || []).map((m) => ({ name: m.name, price_paise: m.pricePaise })),
                })),
          };
          return [optimisticOrd, ...prev];
        });

        try {
          const payRes = await customerApiFetch(
            '/api/v1/customer/payments',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                order_id: orderData.id,
                idempotency_key: crypto.randomUUID(),
                method: selectedPaymentMethod === 'UPI' ? 'UPI' : 'PAY_AT_COUNTER',
              }),
            },
            { preferToken: 'guest' },
          );

          if (payRes.ok) {
            const payData = await payRes.json();
            if (selectedPaymentMethod === 'CASH') {
              setCartLines([]);
              setIsCartOpen(false);
              fetchSessionOrders(currentSessionId);
              setOrdersFilterTab('PREPARING');
              setIsOrdersHistoryOpen(true);
              showToast('Order placed! Counter/cash payment request sent — staff will confirm settlement 💵');
            } else {
              const checkout = payData.checkoutPayload || {};
              if (!checkout.redirectUrl && !checkout.qrCodeUrl && !checkout.upiString) {
                showToast('Payment gateway session created, awaiting checkout details.');
              }
              setPaymentQrData({
                paymentId: payData.id,
                orderId: orderData.id,
                sessionId: currentSessionId,
                redirectUrl: checkout.redirectUrl,
                qrCodeUrl: checkout.qrCodeUrl || '',
                upiString: checkout.upiString || '',
              });
              setIsPaymentModalOpen(true);
            }
          } else {
            const payErr = await payRes.json().catch(() => ({}));
            showToast(payErr.detail || payErr.message || 'Unable to initialize payment. Your order is saved.');
          }
        } catch {
          showToast('Unable to initialize payment gateway.');
        }
      } else {
        const errJson = await res.json().catch(() => ({}));
        console.error('Order placement failed:', errJson);
        showToast(errJson.detail || errJson.message || 'Unable to place order. Please review your cart.');
      }
    } catch (e) {
      console.error('Order error:', e);
      showToast('Network error while placing order.');
    } finally {
      setIsPlacingOrder(false);
    }
  };

  // ── 11. Customer Authentication (WhatsApp OTP + Google + Persistent Session) ─
  const applyAuthenticatedCustomer = async (
    data: {
      accessToken: string;
      customerId: string;
      phone?: string;
      email?: string | null;
      displayName?: string | null;
      loyaltyPoints?: number;
    },
    fallbackPhone: string,
    targetOrgId: string,
  ) => {
    saveCustomerAuth({ accessToken: data.accessToken, customerId: data.customerId });
    setCustomerToken(data.accessToken);
    setCustomerId(data.customerId);

    const profRes = await customerApiFetch(
      '/api/v1/auth/customer/profile',
      undefined,
      { preferToken: 'customer', tokenOverride: data.accessToken, orgIdOverride: targetOrgId },
    ).catch(() => null);

    if (profRes && profRes.ok) {
      const prof = await profRes.json();
      setCustomerProfile(prof);
      setEditDisplayName(prof.displayName || '');
    } else {
      setCustomerProfile({
        phone: data.phone || fallbackPhone,
        email: data.email ?? null,
        displayName: data.displayName || '',
        loyaltyPoints: data.loyaltyPoints ?? 0,
        loyaltyTier: 'Silver Club',
      });
      setEditDisplayName(data.displayName || '');
    }

    await fetchCustomerDinerProfiles(data.customerId, data.accessToken);
    void fetchSessionOrders(undefined, data.accessToken);
    closeBottomAuthSheet();
    setAuthStep('PHONE');
    setAuthDevCode(null);
    setCustomerOtpInput('');
    setGooglePreRegToken(null);
    setAuthEmailLocked(false);
    setShowDevGooglePicker(false);
    showToast(
      data.displayName
        ? `Signed in as ${data.displayName}!`
        : 'Signed in successfully! Your mobile session is saved.'
    );
  };

  const resolveCustomerAuthOrgId = (): string => {
    const tenant = resolveTenantIds(loadGuestSession());
    return activeOrgId || tenant.orgId;
  };

  const formatNormalizedPhone = (raw: string): string => {
    const cleaned = raw.trim().replace(/[^\d+]/g, '');
    if (!cleaned) return '';
    return cleaned.startsWith('+') ? cleaned : `+91${cleaned}`;
  };

  const handleRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthDevCode(null);
    setAuthChannelLabel(null);
    const targetOrgId = resolveCustomerAuthOrgId();
    if (!targetOrgId) {
      setAuthError('Select a hotel table first before signing in.');
      setAuthLoading(false);
      return;
    }

    const formattedPhone = formatNormalizedPhone(customerPhoneInput);
    if (!/^\+\d{10,15}$/.test(formattedPhone)) {
      setAuthError('Enter a valid 10-digit mobile number.');
      setAuthLoading(false);
      return;
    }

    const emailTrimmed = authEmailInput.trim();
    if (authMode === 'SIGNUP' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed)) {
      setAuthError('Enter a valid email ID to link to your mobile number.');
      setAuthLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/v1/auth/customer/otp/request', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': targetOrgId,
        },
        body: JSON.stringify({
          phone: formattedPhone,
          mode: authMode,
          ...(authMode === 'SIGNUP' ? { email: emailTrimmed } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthError(data.detail || data.message || 'Unable to send WhatsApp OTP code.');
        return;
      }
      if (data.channel === 'WHATSAPP') {
        setAuthChannelLabel('WhatsApp');
      } else {
        setAuthChannelLabel('SMS');
      }
      if (data.devCode) {
        setAuthDevCode(data.devCode);
        setCustomerOtpInput(data.devCode);
      } else {
        setCustomerOtpInput('');
      }
      setAuthStep('OTP');
    } catch {
      setAuthError('Network error requesting OTP.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    const targetOrgId = resolveCustomerAuthOrgId();
    if (!targetOrgId) {
      setAuthError('Select a hotel table first before verifying OTP.');
      setAuthLoading(false);
      return;
    }
    const formattedPhone = formatNormalizedPhone(customerPhoneInput);
    const enteredCode = customerOtpInput.trim();
    const emailTrimmed = authEmailInput.trim();

    try {
      const res = await fetch('/api/v1/auth/customer/otp/verify', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': targetOrgId,
        },
        body: JSON.stringify({
          phone: formattedPhone,
          code: enteredCode,
          ...(authMode === 'SIGNUP' && emailTrimmed ? { email: emailTrimmed } : {}),
          ...(authDisplayNameInput.trim() ? { displayName: authDisplayNameInput.trim() } : {}),
          ...(googlePreRegToken ? { googlePreRegToken } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.accessToken && data.customerId) {
        await applyAuthenticatedCustomer(data, formattedPhone, targetOrgId);
        return;
      }
      setAuthError(data.detail || data.message || 'Invalid verification code. Please check and try again.');
    } catch {
      setAuthError('Network error connecting to authentication API.');
    } finally {
      setAuthLoading(false);
    }
  };

  const submitGoogleAuthPayload = async (payload: {
    idToken?: string;
    devMockEmail?: string;
    devMockName?: string;
  }) => {
    const targetOrgId = resolveCustomerAuthOrgId();
    if (!targetOrgId) {
      setAuthError('Select a hotel table first before signing in with Google.');
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/v1/auth/customer/google', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': targetOrgId,
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAuthError(data.detail || data.message || 'Google sign-in failed.');
        return;
      }
      if (data.registered && data.accessToken && data.customerId) {
        await applyAuthenticatedCustomer(data, data.phone || '', targetOrgId);
        return;
      }
      // Email is not registered -> route directly to registration to link mobile via WhatsApp OTP.
      setAuthMode('SIGNUP');
      setAuthStep('PHONE');
      setAuthEmailInput(data.email || payload.devMockEmail || '');
      setAuthEmailLocked(true);
      setGooglePreRegToken(data.googlePreRegToken || null);
      if (data.suggestedName || payload.devMockName) {
        setAuthDisplayNameInput(data.suggestedName || payload.devMockName || '');
      }
      setShowDevGooglePicker(false);
      setAuthError(
        `${data.email || 'This Google email'} is not registered yet. Enter your mobile number to verify via WhatsApp OTP and complete sign up.`,
      );
    } catch {
      setAuthError('Network error during Google sign-in.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleGoogleLoginClick = () => {
    setAuthError('');
    const googleClientId = process.env['NEXT_PUBLIC_GOOGLE_CLIENT_ID'] || '';
    if (!googleClientId) {
      if (process.env.NODE_ENV !== 'production') {
        setShowDevGooglePicker((prev) => !prev);
      } else {
        setAuthError('Google Sign-In is not configured for this environment yet.');
      }
      return;
    }

    interface GoogleAccountsGlobal {
      accounts?: {
        id?: {
          initialize: (cfg: { client_id: string; callback: (resp: { credential?: string }) => void }) => void;
          prompt: () => void;
        };
      };
    }

    const startGisPrompt = () => {
      const googleGlobal = (window as unknown as { google?: GoogleAccountsGlobal }).google;
      if (!googleGlobal?.accounts?.id) {
        setAuthError('Google Identity Services could not initialize.');
        return;
      }
      googleGlobal.accounts.id.initialize({
        client_id: googleClientId,
        callback: (resp: { credential?: string }) => {
          if (resp.credential) {
            void submitGoogleAuthPayload({ idToken: resp.credential });
          } else {
            setAuthError('No Google credential returned.');
          }
        },
      });
      googleGlobal.accounts.id.prompt();
    };

    const existingGoogle = (window as unknown as { google?: GoogleAccountsGlobal }).google;
    if (existingGoogle?.accounts?.id) {
      startGisPrompt();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = startGisPrompt;
    script.onerror = () => setAuthError('Failed to load Google Sign-In script.');
    document.head.appendChild(script);
  };

  // Profile Name Update in Database
  const handleUpdateProfileName = async () => {
    if (!customerToken || !editDisplayName.trim()) return;
    try {
      const res = await customerApiFetch(
        '/api/v1/auth/customer/profile',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: editDisplayName.trim() }),
        },
        { preferToken: 'customer', tokenOverride: customerToken, orgIdOverride: activeOrgId },
      );
      if (res.ok) {
        const updated = await res.json();
        setCustomerProfile(updated);
        showToast(`Saved name "${updated.displayName}" in database! ✓`);
      }
    } catch {}
  };

  // ── 12. Payment Settlement Flow ───────────────────────────────────────────
  const handleInitiatePayment = async () => {
    if (cartLines.length > 0) {
      await handlePlaceOrder();
      return;
    }
    const targetOrder = sessionOrders.find((o) => o.status !== 'CANCELLED' && o.status !== 'BILLED') || sessionOrders[0];
    if (!targetOrder) {
      showToast('No active unpaid order found for this table.');
      return;
    }

    setPaymentLoading(true);
    try {
      const res = await customerApiFetch(
        '/api/v1/customer/payments',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            order_id: targetOrder.id,
            idempotency_key: crypto.randomUUID(),
            method: selectedPaymentMethod === 'UPI' ? 'UPI' : 'PAY_AT_COUNTER',
          }),
        },
        { preferToken: 'guest' },
      );

      if (res.ok) {
        const payData = await res.json();
        if (selectedPaymentMethod === 'CASH') {
          setCartLines([]);
          setIsCartOpen(false);
          if (activeSessionId) fetchSessionOrders(activeSessionId);
          setOrdersFilterTab('PREPARING');
          setIsOrdersHistoryOpen(true);
          showToast('Counter payment request sent — please pay staff at table/counter 💵');
        } else {
          const checkout = payData.checkoutPayload || {};
          setPaymentQrData({
            paymentId: payData.id,
            orderId: targetOrder.id,
            sessionId: activeSessionId,
            redirectUrl: checkout.redirectUrl,
            qrCodeUrl: checkout.qrCodeUrl || '',
            upiString: checkout.upiString || '',
          });
          setIsPaymentModalOpen(true);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        showToast(err.detail || err.message || 'Unable to start payment.');
      }
    } catch (err) {
      console.error('Payment initiation error:', err);
      showToast('Payment initiation failed.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleConfirmUpiPayment = async () => {
    if (!paymentQrData) return;
    setPaymentLoading(true);
    try {
      const targetOrderId = paymentQrData.orderId;
      const targetOrder = sessionOrders.find((o) => (targetOrderId ? o.id === targetOrderId : o.status !== 'CANCELLED')) || sessionOrders[0];

      setPaymentSuccessData({
        paymentId: paymentQrData.paymentId,
        totalPaise: targetOrder ? targetOrder.total_paise : cartGrandTotalPaise,
      });
      setCartLines([]);
      try {
        localStorage.removeItem('dineflow_customer_cart_v2');
      } catch {}
      setIsCartOpen(false);
      setPaymentQrData(null);
      setIsPaymentModalOpen(false);
      const targetSessionId = paymentQrData.sessionId || activeSessionId;
      if (targetSessionId) {
        await fetchSessionOrders(targetSessionId);
      }
      setOrdersFilterTab('PREPARING');
      setIsOrdersHistoryOpen(true);
      showToast('Payment confirmed! Kitchen is preparing your dishes 🍳');
    } catch (err) {
      console.error('Payment confirmation error:', err);
    } finally {
      setPaymentLoading(false);
    }
  };

  // Auto-polling for active QR payment: when user scans QR on mobile and approves,
  // desktop detects it automatically via interval + window focus!
  useEffect(() => {
    if (!isPaymentModalOpen || !paymentQrData?.paymentId || paymentLoading) return;
    const paymentId = paymentQrData.paymentId;
    if (paymentId.startsWith('pay_')) return;

    let isSubscribed = true;
    const checkPaymentOnce = async () => {
      try {
        const vRes = await customerApiFetch(
          `/api/v1/customer/payments/${encodeURIComponent(paymentId)}/verify`,
          undefined,
          { preferToken: 'guest' },
        );
        if (vRes.ok && isSubscribed) {
          const vData = await vRes.json();
          if (vData.status === 'PAID') {
            clearInterval(pollInterval);
            await handleConfirmUpiPayment();
          }
        }
      } catch {}
    };

    const pollInterval = setInterval(() => void checkPaymentOnce(), 2500);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkPaymentOnce();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [isPaymentModalOpen, paymentQrData?.paymentId, paymentLoading]);

  // ── 13. Chef AI Send ──────────────────────────────────────────────────────
  const handleSendAiMessage = async (customPrompt?: string) => {
    const promptToSend = customPrompt || aiInput;
    if (!promptToSend.trim() || aiLoading) return;

    const guestSession = loadGuestSession();
    const tenant = resolveTenantIds(guestSession);
    const targetOrgId = activeOrgId || tenant.orgId;
    const targetOutletId = activeOutletId || tenant.outletId;

    if (!guestSession?.guestSessionToken || !targetOrgId || !targetOutletId) {
      showToast('Scan your table QR code to chat with the AI concierge.');
      return;
    }

    const userMsg = promptToSend.trim();
    setAiMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    if (!customPrompt) setAiInput('');
    setAiLoading(true);

    try {
      const sendRequest = async (sessionIdToUse: string | null) => {
        const payload: Record<string, unknown> = {
          org_id: targetOrgId,
          outlet_id: targetOutletId,
          message: userMsg,
        };
        if (sessionIdToUse) {
          payload['session_id'] = sessionIdToUse;
        }
        if (activeSessionId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(activeSessionId)) {
          payload['table_session_id'] = activeSessionId;
        }
        return customerApiFetch(
          '/api/v1/public/ai/chat',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
          { preferToken: 'guest' },
        );
      };

      let res = await sendRequest(aiSessionId);
      if (res.status === 404 && aiSessionId) {
        setAiSessionId(null);
        res = await sendRequest(null);
      }

      if (res.ok) {
        const data = await res.json();
        if (data.sessionId) {
          setAiSessionId(data.sessionId);
        }
        const replyText =
          data.answer ||
          data.reply ||
          data.message ||
          'How can I help you explore our menu today?';
        setAiMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text: replyText,
            proposedCartItems: Array.isArray(data.proposedCartItems) && data.proposedCartItems.length > 0
              ? data.proposedCartItems
              : undefined,
          },
        ]);
      } else {
        const errBody = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null;
        setAiMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            text:
              errBody?.detail ||
              errBody?.message ||
              'Chef AI had trouble reaching the kitchen assistant right now. Please try again in a moment.',
          },
        ]);
      }
    } catch {
      setAiMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: 'Network error while reaching Chef AI. Please try sending your question again.',
        },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  const handleAddProposedItemToCart = (proposed: {
    itemId: string;
    name: string;
    quantity: number;
    pricePaise: number;
  }) => {
    const matched = menuItems.find(
      (m) => m.id === proposed.itemId || m.name.toLowerCase() === proposed.name.toLowerCase(),
    );
    if (matched) {
      setCartLines((prev) => {
        const existingIdx = prev.findIndex((c) => c.item.id === matched.id && !c.plateLabel && !c.notes);
        if (existingIdx >= 0) {
          const copy = [...prev];
          copy[existingIdx] = {
            ...copy[existingIdx]!,
            quantity: copy[existingIdx]!.quantity + (proposed.quantity || 1),
          };
          return copy;
        }
        return [
          ...prev,
          {
            cartLineId: `${matched.id}-${Date.now()}`,
            item: matched,
            quantity: proposed.quantity || 1,
            spiceLevel: matched.spiceLevel,
            selectedModifiers: [],
          },
        ];
      });
      showToast(`Added ${matched.name} to cart! 🛒`);
    } else {
      showToast(`Dish "${proposed.name}" added to order!`);
    }
  };

  // Helper: check quantity of an item currently in cart
  const getItemCartQty = (itemId: string) => {
    return cartLines.filter((c) => c.item.id === itemId).reduce((acc, c) => acc + c.quantity, 0);
  };

  // Section Expansion Toggle (Only one expanded at a time)
  const toggleSectionExpand = (section: 'offers' | 'top_sellers' | 'recommended' | 'favourites' | 'wishlist') => {
    setExpandedSection((prev) => (prev === section ? null : section));
  };

  // Deep link action from Hero Carousel
  const handleHeroAction = (slide: (typeof HERO_SLIDES)[0]) => {
    if (slide.couponCode) {
      navigator.clipboard.writeText(slide.couponCode);
      handleApplyCoupon(slide.couponCode);
      return;
    }
    if (slide.categoryTarget) {
      setCurrentView('menu');
      setActiveCategory(slide.categoryTarget);
      setTimeout(() => {
        const targetEl = document.getElementById(`cat-section-${slide.categoryTarget}`);
        if (targetEl) {
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      }, 150);
    }
  };

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <div style={{ minHeight: '100vh', paddingBottom: cartItemCount > 0 ? '110px' : '80px', position: 'relative' }}>
      {/* ─── Flying Ghost Animation Element ──────────────────────────────── */}
      {flyingGhost && (
        <img
          src={flyingGhost.imgUrl}
          alt="Adding to cart"
          className="fly-ghost-element"
          style={
            {
              left: `${flyingGhost.startX - 22}px`,
              top: `${flyingGhost.startY - 22}px`,
              '--target-x': `${flyingGhost.targetX}px`,
              '--target-y': `${flyingGhost.targetY}px`,
            } as React.CSSProperties
          }
        />
      )}

      {/* ─── Toast Notification ─────────────────────────────────────────── */}
      {toastMessage && (
        <div
          style={{
            position: 'fixed',
            top: '70px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(17, 24, 39, 0.95)',
            color: '#fbbf24',
            padding: '8px 18px',
            borderRadius: '999px',
            fontSize: '0.84rem',
            fontWeight: 700,
            border: '1px solid rgba(245, 158, 11, 0.4)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
            zIndex: 1000,
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          VIEW 1: HOME PAGE (Discovery & Browse Feed - Claude Spec)
         ══════════════════════════════════════════════════════════════════════ */}
      {currentView === 'home' && (
        <div style={{ maxWidth: '600px', margin: '0 auto', padding: '0 16px' }}>
          {/* 1. Top Nav Bar */}
          <header className="top-nav-bar" style={{ margin: '0 -16px', padding: '10px 16px' }}>
            <div className="nav-left-brand">
              <div style={{ fontSize: '1.4rem' }}>👑</div>
              <div>
                <div className="brand-title">Royal Spice Bistro</div>
                <button
                  className="table-badge-btn"
                  onClick={openTopTableDrawer}
                  title="Click to change or verify table"
                >
                  <span
                    style={{
                      width: '6px',
                      height: '6px',
                      borderRadius: '50%',
                      background: isTableVerified ? '#10b981' : '#f59e0b',
                    }}
                  ></span>
                  <span>Table {selectedTable}</span>
                  <span style={{ fontSize: '0.65rem', opacity: 0.8 }}>▼</span>
                </button>
              </div>
            </div>

            <div className="nav-right-actions">
              {/* Language Switcher - Removed when logged in */}
              {!customerToken && (
                <button
                  className="nav-icon-btn"
                  title="Switch Language"
                  onClick={() => showToast('Language: English (UK) active')}
                >
                  <span style={{ fontSize: '0.85rem', fontWeight: 800 }}>EN</span>
                </button>
              )}

              {/* Orders History Icon - Only shows badge for paid dishes */}
              <button
                className="nav-icon-btn"
                onClick={() => setIsOrdersHistoryOpen(true)}
                title="View Table Orders"
              >
                <span>📋</span>
                {flattenedPlates.length > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-3px',
                      right: '-3px',
                      background: '#10b981',
                      color: '#000',
                      borderRadius: '50%',
                      width: '16px',
                      height: '16px',
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {flattenedPlates.length}
                  </span>
                )}
              </button>

              {/* Profile Icon */}
              <button
                className="nav-icon-btn"
                onClick={() => setIsProfileOpen(true)}
                title={customerToken ? 'My Account & Preferences' : 'Dining Profiles & Sign In'}
              >
                {customerToken ? (
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fbbf24' }}>
                    {customerProfile?.displayName ? customerProfile.displayName.slice(0, 2).toUpperCase() : 'ME'}
                  </span>
                ) : (
                  <span>👤</span>
                )}
              </button>

              {/* Cart Icon (ALWAYS visible, independent of cart bar) */}
              <button
                ref={cartIconRef}
                className={`nav-icon-btn nav-cart-btn ${cartPulse ? 'cart-icon-pulse' : ''}`}
                onClick={() => setIsCartOpen(true)}
                title="View Shopping Cart"
              >
                <span>🛒</span>
                {cartItemCount > 0 && <span className="cart-count-badge">{cartItemCount}</span>}
              </button>
            </div>
          </header>

          {/* 2. Hero Section (Auto-rotating Banner Carousel) */}
          <div className="hero-carousel-container">
            <div className="hero-slide-wrapper">
              <img
                src={HERO_SLIDES[heroIndex]!.img}
                alt={HERO_SLIDES[heroIndex]!.title}
                className="hero-slide-img"
              />
              <div className="hero-slide-gradient">
                <span className="hero-slide-tag">{HERO_SLIDES[heroIndex]!.tag}</span>
                <h1 className="hero-slide-title">{HERO_SLIDES[heroIndex]!.title}</h1>
                <p className="hero-slide-subtitle">{HERO_SLIDES[heroIndex]!.subtitle}</p>
                <button
                  className="hero-action-btn"
                  onClick={() => handleHeroAction(HERO_SLIDES[heroIndex]!)}
                >
                  {HERO_SLIDES[heroIndex]!.btnText}
                </button>
              </div>
            </div>
          </div>

          {/* Dots Indicator */}
          <div className="hero-dots-container">
            {HERO_SLIDES.map((_, idx) => (
              <div
                key={idx}
                className={`hero-dot ${idx === heroIndex ? 'active' : ''}`}
                onClick={() => setHeroIndex(idx)}
              />
            ))}
          </div>

          {/* 3. Offers and Coupons */}
          <section className="home-section">
            <div className="home-section-header">
              <div className="section-title-wrap">
                <span style={{ fontSize: '1.1rem' }}>🏷️</span>
                <h2 className="section-heading">Offers & Coupons</h2>
              </div>
              <button
                className="section-see-all-btn"
                onClick={() => toggleSectionExpand('offers')}
              >
                <span>{expandedSection === 'offers' ? 'Show less ▲' : 'See all →'}</span>
              </button>
            </div>

            {expandedSection === 'offers' ? (
              <div className="home-expanded-grid">
                {OFFERS_DATA.map((off) => (
                  <div key={off.id} className="offer-coupon-card" style={{ maxWidth: '100%' }}>
                    <div>
                      <div className="offer-card-badge">{off.validity}</div>
                      <div className="offer-card-title">{off.title}</div>
                      <div className="offer-card-desc">{off.discountDesc}</div>
                    </div>
                    <div className="offer-card-footer">
                      <span className="offer-code-chip">{off.code}</span>
                      <button
                        className="offer-apply-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(off.code);
                          handleApplyCoupon(off.code);
                        }}
                      >
                        {appliedCoupon === off.code ? 'Applied ✓' : 'Copy & Apply'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="home-horizontal-scroll">
                {OFFERS_DATA.map((off) => (
                  <div key={off.id} className="offer-coupon-card">
                    <div>
                      <div className="offer-card-badge">{off.validity}</div>
                      <div className="offer-card-title">{off.title}</div>
                      <div className="offer-card-desc">{off.discountDesc}</div>
                    </div>
                    <div className="offer-card-footer">
                      <span className="offer-code-chip">{off.code}</span>
                      <button
                        className="offer-apply-btn"
                        onClick={() => {
                          navigator.clipboard.writeText(off.code);
                          handleApplyCoupon(off.code);
                        }}
                      >
                        {appliedCoupon === off.code ? 'Applied ✓' : 'Copy'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 🔥 Top Combos & Feasts Horizontal Rail */}
          <section className="home-section">
            <div className="home-section-header">
              <div className="section-title-wrap">
                <span style={{ fontSize: '1.2rem' }}>🔥</span>
                <h2 className="section-heading">Top Combos & Feasts</h2>
                <span
                  className="section-badge-count"
                  style={{
                    background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                    color: '#000',
                    fontWeight: 800,
                  }}
                >
                  10% OFF
                </span>
              </div>
              <button
                className="section-see-all-btn"
                onClick={() => {
                  setCurrentView('menu');
                  setActiveCategory('Combos');
                  setTimeout(() => {
                    const el = document.getElementById('cat-section-Combos');
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 80);
                }}
              >
                <span>View All Combos →</span>
              </button>
            </div>

            <div className="home-horizontal-scroll">
              {COMBO_OFFERS.map((combo) => (
                <div
                  key={combo.id}
                  className="combo-offer-card"
                  onClick={() => navigateToCombo(combo)}
                >
                  <div className="combo-card-banner">
                    <img
                      src={combo.imageUrl}
                      alt={combo.name}
                      className="combo-card-img"
                      loading="lazy"
                    />
                    <span className="combo-card-badge">{combo.badge}</span>
                    <span className="combo-card-pax-tag">{combo.tag}</span>
                    <button
                      className={`combo-wishlist-btn ${wishlist.has(combo.id) ? 'hearted' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWishlist(combo.id, e);
                      }}
                      title={wishlist.has(combo.id) ? 'In favorites' : 'Add to favorites'}
                    >
                      {wishlist.has(combo.id) ? '❤️' : '🤍'}
                    </button>
                  </div>
                  <div className="combo-card-content">
                    <div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginBottom: '4px',
                        }}
                      >
                        <span style={{ fontSize: '0.72rem' }}>
                          {combo.vegType === 'VEG' ? '🟢' : '🔴'}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 700 }}>
                          ★ {combo.rating}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                          ⏱️ {combo.prepTimeMinutes} mins
                        </span>
                      </div>
                      <div className="combo-card-title">{combo.name}</div>
                      <div className="combo-card-desc">{combo.description}</div>
                    </div>
                    <div className="combo-card-footer">
                      <div className="combo-price-wrap">
                        <span className="combo-current-price">
                          ₹{(combo.comboPricePaise / 100).toFixed(0)}
                        </span>
                        <span className="combo-original-price">
                          ₹{(combo.originalPricePaise / 100).toFixed(0)}
                        </span>
                      </div>
                      <button
                        className="combo-add-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          navigateToCombo(combo);
                        }}
                      >
                        Customize & Add +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Top Sellers */}
          <section className="home-section">
            <div className="home-section-header">
              <div className="section-title-wrap">
                <span style={{ fontSize: '1.1rem' }}>🔥</span>
                <h2 className="section-heading">Top Sellers</h2>
                <span className="section-badge-count">{topSellers.length} dishes</span>
              </div>
              <button
                className="section-see-all-btn"
                onClick={() => toggleSectionExpand('top_sellers')}
              >
                <span>{expandedSection === 'top_sellers' ? 'Show less ▲' : 'See all →'}</span>
              </button>
            </div>

            {expandedSection === 'top_sellers' ? (
              <div className="home-expanded-grid">
                {topSellers.map((item) => (
                  <SquareItemCard
                    key={item.id}
                    item={item}
                    qty={getItemCartQty(item.id)}
                    isHearted={wishlist.has(item.id)}
                    onToggleHeart={(e) => toggleWishlist(item.id, e)}
                    onAdd={(e) => handleQuickAdd(item, e)}
                    onDecrement={(e) => handleQuickDecrement(item.id, e)}
                    onOpenAccordion={() => navigateToMenuItem(item)}
                  />
                ))}
              </div>
            ) : (
              <div className="home-horizontal-scroll">
                {topSellers.map((item) => (
                  <SquareItemCard
                    key={item.id}
                    item={item}
                    qty={getItemCartQty(item.id)}
                    isHearted={wishlist.has(item.id)}
                    onToggleHeart={(e) => toggleWishlist(item.id, e)}
                    onAdd={(e) => handleQuickAdd(item, e)}
                    onDecrement={(e) => handleQuickDecrement(item.id, e)}
                    onOpenAccordion={() => navigateToMenuItem(item)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* 5. Recommended For You (Signed-in only, hidden for guests) */}
          {customerToken && (
            <section className="home-section">
              <div className="home-section-header">
                <div className="section-title-wrap">
                  <span style={{ fontSize: '1.1rem' }}>✨</span>
                  <h2 className="section-heading">Recommended for You</h2>
                </div>
                <button
                  className="section-see-all-btn"
                  onClick={() => toggleSectionExpand('recommended')}
                >
                  <span>{expandedSection === 'recommended' ? 'Show less ▲' : 'See all →'}</span>
                </button>
              </div>

              {expandedSection === 'recommended' ? (
                <div className="home-expanded-grid">
                  {recommendedItems.map((item) => (
                    <SquareItemCard
                      key={item.id}
                      item={item}
                      qty={getItemCartQty(item.id)}
                      isHearted={wishlist.has(item.id)}
                      onToggleHeart={(e) => toggleWishlist(item.id, e)}
                      onAdd={(e) => handleQuickAdd(item, e)}
                      onDecrement={(e) => handleQuickDecrement(item.id, e)}
                      onOpenAccordion={() => navigateToMenuItem(item)}
                    />
                  ))}
                </div>
              ) : (
                <div className="home-horizontal-scroll">
                  {recommendedItems.map((item) => (
                    <SquareItemCard
                      key={item.id}
                      item={item}
                      qty={getItemCartQty(item.id)}
                      isHearted={wishlist.has(item.id)}
                      onToggleHeart={(e) => toggleWishlist(item.id, e)}
                      onAdd={(e) => handleQuickAdd(item, e)}
                      onDecrement={(e) => handleQuickDecrement(item.id, e)}
                      onOpenAccordion={() => navigateToMenuItem(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 6. Your Favourite Orders (Signed-in only) */}
          {customerToken && favouriteItems.length > 0 && (
            <section className="home-section">
              <div className="home-section-header">
                <div className="section-title-wrap">
                  <span style={{ fontSize: '1.1rem' }}>❤️</span>
                  <h2 className="section-heading">Your Favourite Orders</h2>
                </div>
                <button
                  className="section-see-all-btn"
                  onClick={() => toggleSectionExpand('favourites')}
                >
                  <span>{expandedSection === 'favourites' ? 'Show less ▲' : 'See all →'}</span>
                </button>
              </div>

              {expandedSection === 'favourites' ? (
                <div className="home-expanded-grid">
                  {favouriteItems.map((item) => (
                    <SquareItemCard
                      key={item.id}
                      item={item}
                      qty={getItemCartQty(item.id)}
                      isHearted={wishlist.has(item.id)}
                      onToggleHeart={(e) => toggleWishlist(item.id, e)}
                      onAdd={(e) => handleQuickAdd(item, e)}
                      onDecrement={(e) => handleQuickDecrement(item.id, e)}
                      onOpenAccordion={() => navigateToMenuItem(item)}
                    />
                  ))}
                </div>
              ) : (
                <div className="home-horizontal-scroll">
                  {favouriteItems.map((item) => (
                    <SquareItemCard
                      key={item.id}
                      item={item}
                      qty={getItemCartQty(item.id)}
                      isHearted={wishlist.has(item.id)}
                      onToggleHeart={(e) => toggleWishlist(item.id, e)}
                      onAdd={(e) => handleQuickAdd(item, e)}
                      onDecrement={(e) => handleQuickDecrement(item.id, e)}
                      onOpenAccordion={() => navigateToMenuItem(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* 7. Wishlisted (Signed-in only) */}
          {customerToken && wishlistedItems.length > 0 && (
            <section className="home-section">
              <div className="home-section-header">
                <div className="section-title-wrap">
                  <span style={{ fontSize: '1.1rem' }}>🔖</span>
                  <h2 className="section-heading">Wishlisted</h2>
                </div>
                <button
                  className="section-see-all-btn"
                  onClick={() => toggleSectionExpand('wishlist')}
                >
                  <span>{expandedSection === 'wishlist' ? 'Show less ▲' : 'See all →'}</span>
                </button>
              </div>

              {expandedSection === 'wishlist' ? (
                <div className="home-expanded-grid">
                  {wishlistedItems.map((item) => (
                    <SquareItemCard
                      key={item.id}
                      item={item}
                      qty={getItemCartQty(item.id)}
                      isHearted={true}
                      onToggleHeart={(e) => toggleWishlist(item.id, e)}
                      onAdd={(e) => handleQuickAdd(item, e)}
                      onDecrement={(e) => handleQuickDecrement(item.id, e)}
                      onOpenAccordion={() => navigateToMenuItem(item)}
                    />
                  ))}
                </div>
              ) : (
                <div className="home-horizontal-scroll">
                  {wishlistedItems.map((item) => (
                    <SquareItemCard
                      key={item.id}
                      item={item}
                      qty={getItemCartQty(item.id)}
                      isHearted={true}
                      onToggleHeart={(e) => toggleWishlist(item.id, e)}
                      onAdd={(e) => handleQuickAdd(item, e)}
                      onDecrement={(e) => handleQuickDecrement(item.id, e)}
                      onOpenAccordion={() => navigateToMenuItem(item)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Quick Browse Categories Shortcut */}
          <section className="home-section">
            <div className="home-section-header">
              <h2 className="section-heading">Explore by Category</h2>
              <button className="section-see-all-btn" onClick={() => setCurrentView('menu')}>
                View Full Menu →
              </button>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '10px',
              }}
            >
              {CATEGORIES_LIST.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    setCurrentView('menu');
                    setActiveCategory(cat);
                    setTimeout(() => {
                      scrollToCategory(cat);
                    }, 60);
                  }}
                  style={{
                    padding: '14px 10px',
                    borderRadius: '12px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ fontSize: '1.5rem' }}>
                    {cat === 'Starters'
                      ? '🍢'
                      : cat === 'Main Course'
                      ? '🥘'
                      : cat === 'Biryani & Rice'
                      ? '🍚'
                      : cat === 'Breads'
                      ? '🫓'
                      : cat === 'Desserts'
                      ? '🍧'
                      : '🍹'}
                  </span>
                  <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>{cat}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          VIEW 2: FULL MENU PAGE (Claude Spec)
         ══════════════════════════════════════════════════════════════════════ */}
      {currentView === 'menu' && (
        <div style={{ maxWidth: '600px', margin: '0 auto' }}>
          {/* 1. Top Nav Bar */}
          <header className="menu-top-nav-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <button
                className="menu-back-btn"
                onClick={() => setCurrentView('home')}
                title="Return to Home Discovery Feed"
              >
                ←
              </button>
              <div>
                <div className="brand-title">Royal Spice Bistro</div>
                <button
                  className="table-badge-btn"
                  onClick={openTopTableDrawer}
                  style={{ padding: '2px 8px', fontSize: '0.72rem' }}
                >
                  <span>Table {selectedTable}</span>
                </button>
              </div>
            </div>

            <div className="nav-right-actions">
              {/* Filter Funnel Icon with Active Badge */}
              <button
                className={`filter-funnel-btn ${activeFilterCount > 0 ? 'active' : ''}`}
                onClick={() => setIsFilterSheetOpen(true)}
                title="Filter Menu Options"
              >
                <span>🌪️</span>
                {activeFilterCount > 0 && <span className="filter-funnel-badge">{activeFilterCount}</span>}
              </button>

              {/* Orders History Icon - Only shows badge for paid dishes */}
              <button
                className="nav-icon-btn"
                onClick={() => setIsOrdersHistoryOpen(true)}
                title="View Table Orders"
              >
                <span>📋</span>
                {flattenedPlates.length > 0 && (
                  <span
                    style={{
                      position: 'absolute',
                      top: '-3px',
                      right: '-3px',
                      background: '#10b981',
                      color: '#000',
                      borderRadius: '50%',
                      width: '16px',
                      height: '16px',
                      fontSize: '0.65rem',
                      fontWeight: 800,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {flattenedPlates.length}
                  </span>
                )}
              </button>

              {/* Profile Icon */}
              <button
                className="nav-icon-btn"
                onClick={() => setIsProfileOpen(true)}
                title={customerToken ? 'My Account & Preferences' : 'Dining Profiles & Sign In'}
              >
                {customerToken ? (
                  <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fbbf24' }}>
                    {customerProfile?.displayName ? customerProfile.displayName.slice(0, 2).toUpperCase() : 'ME'}
                  </span>
                ) : (
                  <span>👤</span>
                )}
              </button>

              {/* Cart Icon (ALWAYS visible) */}
              <button
                ref={cartIconRef}
                className={`nav-icon-btn nav-cart-btn ${cartPulse ? 'cart-icon-pulse' : ''}`}
                onClick={() => setIsCartOpen(true)}
                title="Shopping Cart"
              >
                <span>🛒</span>
                {cartItemCount > 0 && <span className="cart-count-badge">{cartItemCount}</span>}
              </button>
            </div>
          </header>

          {/* 2. Search Bar (Directly below top bar, always visible, live filtering) */}
          <div className="menu-search-container">
            <div className="menu-search-input-wrap">
              <span className="menu-search-icon">🔍</span>
              <input
                type="text"
                placeholder="Search dishes, curries, tandoor, desserts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="menu-search-input"
              />
              {searchQuery && (
                <span className="menu-search-clear" onClick={() => setSearchQuery('')}>
                  ✕
                </span>
              )}
            </div>
          </div>

          {/* 3. Category Navigation (Horizontal scrollable pill row, NO 'All' pill, scroll-spy) */}
          <nav className="menu-category-nav">
            {CATEGORIES_LIST.map((cat) => (
              <button
                key={cat}
                id={`pill-${cat}`}
                className={`category-nav-pill ${activeCategory === cat ? 'active' : ''}`}
                onClick={() => scrollToCategory(cat)}
              >
                {cat === 'Combos' ? '🔥 Combos' : cat}
              </button>
            ))}
          </nav>

          {/* 4. Filter Chips + Sort Control */}
          <div className="menu-filter-sort-row">
            <div className="dietary-chips-group">
              <button
                className={`dietary-chip-btn ${dietaryFilter === 'ALL' ? 'active' : ''}`}
                onClick={() => setDietaryFilter('ALL')}
              >
                All
              </button>
              <button
                className={`dietary-chip-btn ${dietaryFilter === 'VEG' ? 'active' : ''}`}
                onClick={() => setDietaryFilter((prev) => (prev === 'VEG' ? 'ALL' : 'VEG'))}
              >
                <span style={{ color: '#10b981' }}>🟢</span> Veg
              </button>
              <button
                className={`dietary-chip-btn ${dietaryFilter === 'NON_VEG' ? 'active' : ''}`}
                onClick={() => setDietaryFilter((prev) => (prev === 'NON_VEG' ? 'ALL' : 'NON_VEG'))}
              >
                <span style={{ color: '#ef4444' }}>🔴</span> Non-Veg
              </button>
            </div>

            <select
              className="sort-select-dropdown"
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as any)}
            >
              <option value="POPULAR">Sort: Popular</option>
              <option value="PRICE_ASC">Price: Low to High</option>
              <option value="PRICE_DESC">Price: High to Low</option>
              <option value="RATING">Rating: High to Low</option>
              <option value="PREP_TIME">Prep Time</option>
            </select>
          </div>

          {/* 5. Menu Item Sections */}
          <div style={{ paddingBottom: '30px' }}>
            {CATEGORIES_LIST.map((cat) => {
              const itemsInCat = groupedItems[cat] || [];
              if (itemsInCat.length === 0) return null;

              return (
                <section key={cat} id={`cat-section-${cat}`} className="menu-category-section">
                  <h3 className="menu-category-header">
                    {cat === 'Combos' ? '🔥 Combos & Feasts (10% OFF Bundles)' : cat}
                  </h3>
                  <div className="menu-items-list">
                    {itemsInCat.map((item) => {
                      const isExpanded = expandedAccordionItemId === item.id;
                      const cartQty = getItemCartQty(item.id);
                      const matchingCombo = COMBO_OFFERS.find((c) => c.id === item.id);

                      return (
                        <div
                          key={item.id}
                          id={`menu-item-${item.id}`}
                          className={`menu-item-row-card ${item.category === 'Combos' ? 'combo-item-highlight' : ''}`}
                        >
                          {/* Main Row */}
                          <div
                            className="menu-item-main-row"
                            onClick={() => handleOpenAccordion(item)}
                            style={{ cursor: 'pointer' }}
                          >
                            <div className="menu-item-details">
                              <div className="item-badge-row">
                                <span style={{ fontSize: '0.75rem' }}>
                                  {item.dietaryTag === 'VEG' ? '🟢' : '🔴'}
                                </span>
                                <span className="item-prep-badge">⏱️ {item.prepTimeMinutes} mins</span>
                                <span style={{ fontSize: '0.72rem', color: '#fbbf24' }}>
                                  ★ {item.rating.toFixed(1)}
                                </span>
                                {matchingCombo && (
                                  <span className="combo-card-pax-tag" style={{ position: 'static', padding: '2px 6px', fontSize: '0.64rem' }}>
                                    {matchingCombo.tag}
                                  </span>
                                )}
                              </div>

                              <div className="menu-item-name">{item.name}</div>
                              <p className="menu-item-desc">{item.description}</p>

                              <div className="menu-item-price-row">
                                <span className="menu-item-price">₹{(item.pricePaise / 100).toFixed(0)}</span>
                                {matchingCombo && (
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '0.76rem', color: '#64748b', textDecoration: 'line-through' }}>
                                      ₹{(matchingCombo.originalPricePaise / 100).toFixed(0)}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '0.64rem',
                                        fontWeight: 800,
                                        padding: '1px 6px',
                                        borderRadius: '4px',
                                        background: 'rgba(245, 158, 11, 0.15)',
                                        color: '#fbbf24',
                                        border: '1px solid rgba(245, 158, 11, 0.3)',
                                      }}
                                    >
                                      {matchingCombo.badge}
                                    </span>
                                  </div>
                                )}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleWishlist(item.id, e);
                                  }}
                                  style={{
                                    fontSize: '0.85rem',
                                    color: wishlist.has(item.id) ? '#f43f5e' : 'rgba(255,255,255,0.4)',
                                    cursor: 'pointer',
                                  }}
                                  title="Save to favorites"
                                >
                                  {wishlist.has(item.id) ? '❤️' : '🤍'}
                                </button>
                              </div>
                            </div>

                            {/* Media Column with Image & Overlapping Add Button */}
                            <div className="menu-item-media-col" onClick={(e) => e.stopPropagation()}>
                              <div
                                className="menu-item-thumb-wrap"
                                onClick={() => handleOpenAccordion(item)}
                              >
                                <img
                                  src={item.imageUrl || FALLBACK_DISH_IMG}
                                  alt={item.name}
                                  className="menu-item-thumb-img"
                                  loading="lazy"
                                  onError={(e) => {
                                    e.currentTarget.src = FALLBACK_DISH_IMG;
                                  }}
                                />
                              </div>

                              <div className="menu-item-add-btn-wrap">
                                {cartQty > 0 ? (
                                  <div className="menu-stepper-wrap">
                                    <button onClick={(e) => handleQuickDecrement(item.id, e)}>−</button>
                                    <span>{cartQty}</span>
                                    <button onClick={(e) => handleQuickAdd(item, e)}>+</button>
                                  </div>
                                ) : (
                                  <button
                                    className="menu-add-btn"
                                    style={item.category === 'Combos' ? { padding: '5px 8px', fontSize: '0.72rem', whiteSpace: 'nowrap' } : undefined}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleOpenAccordion(item);
                                    }}
                                  >
                                    <span>{item.category === 'Combos' ? 'Customize +' : 'Add +'}</span>
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          PERSISTENT ELEMENTS: Sticky Floating Circular Buttons & Cart Bar
         ══════════════════════════════════════════════════════════════════════ */}

      {/* Bottom Floating Circular Buttons:
          - Bottom-right: Sticky Menu button (persists across home and jumps to menu)
          - Bottom-left: Sticky Chatbot button (opens Chef AI bottom sheet)
          - Adjusted vertically: bottom: 24px when cart is empty, bottom: 84px when cart bar is present!
      */}
      <div
        className="floating-bottom-actions"
        style={{
          bottom: cartItemCount > 0 ? '84px' : '24px',
        }}
      >
        {/* Sticky Chatbot Button (Bottom-left) */}
        <button
          className="floating-circular-btn floating-chat-btn"
          onClick={() => setIsAiOpen(true)}
          title="Ask Chef AI"
        >
          <span style={{ fontSize: '1.2rem' }}>👨‍🍳</span>
          <span>Chef AI</span>
        </button>

        {/* Sticky Orders Button (Center - visible on both Home & Menu when there are active orders) */}
        {flattenedPlates.length > 0 && (
          <button
            className="floating-circular-btn floating-orders-btn"
            onClick={() => setIsOrdersHistoryOpen(true)}
            title="Track Table Orders"
            style={{
              background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.25), rgba(5, 150, 105, 0.45))',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.6)',
              boxShadow: '0 8px 25px rgba(0, 0, 0, 0.5), 0 0 15px rgba(16, 185, 129, 0.25)',
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>📋</span>
            <span>Orders ({flattenedPlates.length})</span>
          </button>
        )}

        {/* Sticky Menu Button (Bottom-right - jumps to Menu view) */}
        {currentView === 'home' ? (
          <button
            className="floating-circular-btn floating-menu-btn"
            onClick={() => setCurrentView('menu')}
            title="Browse Complete Menu"
          >
            <span style={{ fontSize: '1.2rem' }}>🍽️</span>
            <span>Menu</span>
          </button>
        ) : (
          <button
            className="floating-circular-btn floating-menu-btn"
            onClick={() => setCurrentView('home')}
            title="Back to Discovery Feed"
          >
            <span style={{ fontSize: '1.2rem' }}>🏠</span>
            <span>Home</span>
          </button>
        )}
      </div>

      {/* Persistent Bottom Floating Cart Bar:
          - ONLY appears when cart has at least 1 item
          - Sits on the very bottom edge
      */}
      {cartItemCount > 0 && (
        <div className="floating-cart-bottom-bar">
          <div className="cart-bar-left-info">
            <div className="cart-bar-count-price">
              <span>{cartItemCount} {cartItemCount === 1 ? 'item' : 'items'}</span>
              <span>·</span>
              <span style={{ color: '#fbbf24' }}>₹{(cartGrandTotalPaise / 100).toFixed(0)}</span>
            </div>
            <span className="cart-bar-tax-label">Incl. taxes & dining charges</span>
          </div>

          <button className="cart-bar-action-btn" onClick={() => setIsCartOpen(true)}>
            <span>View Cart</span>
            <span>→</span>
          </button>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS & DRAWERS
         ══════════════════════════════════════════════════════════════════════ */}

      {/* Filter Funnel Modal Sheet */}
      {isFilterSheetOpen && (
        <div className="filter-sheet-overlay" onClick={() => setIsFilterSheetOpen(false)}>
          <div className="filter-sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="filter-sheet-header">
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>Filter Menu</h3>
              <button
                onClick={() => setIsFilterSheetOpen(false)}
                style={{ color: '#94a3b8', fontSize: '1.1rem' }}
              >
                ✕
              </button>
            </div>

            <div className="filter-options-list">
              <label
                className={`filter-checkbox-item ${filterNorthIndian ? 'checked' : ''}`}
                onClick={() => setFilterNorthIndian(!filterNorthIndian)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🍛</span>
                  <span style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>North Indian</span>
                </div>
                <input
                  type="checkbox"
                  checked={filterNorthIndian}
                  onChange={() => setFilterNorthIndian(!filterNorthIndian)}
                  style={{ accentColor: '#f59e0b', width: '18px', height: '18px' }}
                />
              </label>

              <label
                className={`filter-checkbox-item ${filterSouthIndian ? 'checked' : ''}`}
                onClick={() => setFilterSouthIndian(!filterSouthIndian)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🥥</span>
                  <span style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>South Indian</span>
                </div>
                <input
                  type="checkbox"
                  checked={filterSouthIndian}
                  onChange={() => setFilterSouthIndian(!filterSouthIndian)}
                  style={{ accentColor: '#f59e0b', width: '18px', height: '18px' }}
                />
              </label>

              <label
                className={`filter-checkbox-item ${filterHealthy ? 'checked' : ''}`}
                onClick={() => setFilterHealthy(!filterHealthy)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🥗</span>
                  <span style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>Healthy & Low Oil</span>
                </div>
                <input
                  type="checkbox"
                  checked={filterHealthy}
                  onChange={() => setFilterHealthy(!filterHealthy)}
                  style={{ accentColor: '#f59e0b', width: '18px', height: '18px' }}
                />
              </label>

              <label
                className={`filter-checkbox-item ${filterAvailableOnly ? 'checked' : ''}`}
                onClick={() => setFilterAvailableOnly(!filterAvailableOnly)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>⚡</span>
                  <span style={{ fontSize: '0.9rem', color: '#fff', fontWeight: 600 }}>Available Only</span>
                </div>
                <input
                  type="checkbox"
                  checked={filterAvailableOnly}
                  onChange={() => setFilterAvailableOnly(!filterAvailableOnly)}
                  style={{ accentColor: '#f59e0b', width: '18px', height: '18px' }}
                />
              </label>
            </div>

            <div className="filter-sheet-actions">
              <button
                className="filter-clear-btn"
                onClick={() => {
                  setFilterNorthIndian(false);
                  setFilterSouthIndian(false);
                  setFilterHealthy(false);
                  setFilterAvailableOnly(false);
                }}
              >
                Clear All
              </button>
              <button className="filter-apply-btn" onClick={() => setIsFilterSheetOpen(false)}>
                Apply Filters {activeFilterCount > 0 ? `(${activeFilterCount})` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Interactive Dish Customizer Drawer / Bottom Sheet (Desktop Right Drawer / Mobile 80% Bottom Sheet) ── */}
      {activeCustomizingItem && (() => {
        const item = activeCustomizingItem;
        const { fullPaise, halfPaise, upgradeDiffPaise } = getPortionPricing(item);
        const hasPortions = isPortionApplicable(item);
        const groups = resolveItemModifierGroups(item);
        const hasSpiceModifierGroup = groups.some((g) => g.name.toLowerCase().includes('spice'));

        const currentTotalPricePaise = isPerPlateSplit && accordionQty > 1
          ? plateConfigs.reduce((sum, cfg) => {
              const bPrice = cfg.portion === 'HALF' ? halfPaise : fullPaise;
              const mSum = (cfg.modifiers || []).reduce((acc, m) => acc + m.pricePaise, 0);
              return sum + bPrice + mSum;
            }, 0)
          : ((accordionPortion === 'HALF' ? halfPaise : fullPaise) +
              accordionModifiers.reduce((acc, m) => acc + m.pricePaise, 0)) *
            accordionQty;

        const isMultiPlate = isPerPlateSplit && accordionQty > 1;
        const currentPlate = isMultiPlate
          ? plateConfigs.find((p) => p.plateIndex === activePlateIndex) || plateConfigs[0] || {
              plateIndex: 1,
              customName: 'Plate 1',
              portion: 'FULL',
              spice: accordionSpice,
              notes: '',
              modifiers: [],
            }
          : null;

        const activePlateDisplayName = isMultiPlate
          ? (currentPlate?.customName || `Plate ${currentPlate?.plateIndex}`)
          : (plateConfigs[0]?.customName || 'Plate 1');

        const activePortion = isMultiPlate ? (currentPlate?.portion || 'FULL') : accordionPortion;
        const activeSpice = currentPlate ? currentPlate.spice : accordionSpice;
        const activeNote = currentPlate ? currentPlate.notes : accordionNote;
        const activeModifiers = currentPlate ? (currentPlate.modifiers || []) : accordionModifiers;

        const onSelectPortion = (port: 'FULL' | 'HALF') => {
          if (isMultiPlate) {
            setPlateConfigs((prev) =>
              prev.map((p) => (p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex) ? { ...p, portion: port } : p))
            );
          } else {
            setAccordionPortion(port);
          }
        };

        const onSelectSpice = (sp: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE') => {
          if (isMultiPlate) {
            setPlateConfigs((prev) =>
              prev.map((p) => (p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex) ? { ...p, spice: sp } : p))
            );
          } else {
            setAccordionSpice(sp);
          }
        };

        const onChangeNote = (val: string) => {
          if (isMultiPlate) {
            setPlateConfigs((prev) =>
              prev.map((p) => (p.plateIndex === (currentPlate?.plateIndex ?? activePlateIndex) ? { ...p, notes: val } : p))
            );
          } else {
            setAccordionNote(val);
          }
        };

        const onToggleChip = (chip: string) => {
          if (isMultiPlate) {
            setPlateConfigs((prev) =>
              prev.map((p) => {
                if (p.plateIndex !== (currentPlate?.plateIndex ?? activePlateIndex)) return p;
                const nextNotes = toggleChipInNotes(p.notes || '', chip);
                return { ...p, notes: nextNotes };
              })
            );
          } else {
            setAccordionNote((prev) => toggleChipInNotes(prev, chip));
          }
        };

        const onToggleModifier = (mod: ModifierOption, group: ModifierGroup) => {
          const isSingle = group.selectionType === 'SINGLE';

          if (isMultiPlate) {
            setPlateConfigs((prev) =>
              prev.map((p) => {
                if (p.plateIndex !== (currentPlate?.plateIndex ?? activePlateIndex)) return p;
                const currentMods = p.modifiers || [];
                const isAlreadySelected = currentMods.some((m) => m.id === mod.id);

                let nextMods: ModifierOption[];
                if (isSingle) {
                  if (isAlreadySelected) {
                    nextMods = group.isRequired ? currentMods : currentMods.filter((m) => m.id !== mod.id);
                  } else {
                    const withoutGroup = currentMods.filter((m) => !group.modifiers.some((gm) => gm.id === m.id));
                    nextMods = [...withoutGroup, mod];
                  }
                } else {
                  if (isAlreadySelected) {
                    nextMods = currentMods.filter((m) => m.id !== mod.id);
                  } else {
                    const groupCount = currentMods.filter((m) => group.modifiers.some((gm) => gm.id === m.id)).length;
                    if (group.maxSelections && groupCount >= group.maxSelections) {
                      showToast(`Max ${group.maxSelections} selection${group.maxSelections > 1 ? 's' : ''} allowed`);
                      return p;
                    }
                    nextMods = [...currentMods, mod];
                  }
                }
                return { ...p, modifiers: nextMods };
              })
            );
          } else {
            setAccordionModifiers((prev) => {
              const isAlreadySelected = prev.some((m) => m.id === mod.id);

              if (isSingle) {
                if (isAlreadySelected) {
                  return group.isRequired ? prev : prev.filter((m) => m.id !== mod.id);
                } else {
                  const withoutGroup = prev.filter((m) => !group.modifiers.some((gm) => gm.id === m.id));
                  return [...withoutGroup, mod];
                }
              } else {
                if (isAlreadySelected) {
                  return prev.filter((m) => m.id !== mod.id);
                } else {
                  const groupCount = prev.filter((m) => group.modifiers.some((gm) => gm.id === m.id)).length;
                  if (group.maxSelections && groupCount >= group.maxSelections) {
                    showToast(`Max ${group.maxSelections} selection${group.maxSelections > 1 ? 's' : ''} allowed`);
                    return prev;
                  }
                  return [...prev, mod];
                }
              }
            });
          }
        };

        const notePlaceholder = isMultiPlate
          ? (item.category === 'Beverages'
              ? `Note for Portion ${currentPlate?.plateIndex} (e.g. less ice, strong)...`
              : item.category === 'Desserts'
              ? `Note for Portion ${currentPlate?.plateIndex} (e.g. served warm, nut-free)...`
              : item.category === 'Breads'
              ? `Note for Portion ${currentPlate?.plateIndex} (e.g. extra crisp, buttered)...`
              : `Note for Plate ${currentPlate?.plateIndex} (e.g. less salt, well done)...`)
          : getNotePlaceholder(item.category);

        return (
          <div
            className="side-drawer-wrap customizer-drawer-wrap"
            onClick={() => {
              setActiveCustomizingItem(null);
              setExpandedAccordionItemId(null);
            }}
          >
            <div
              className="side-drawer-panel combo-drawer-panel customizer-drawer-panel"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: '560px', width: '100%', padding: 0 }}
            >
              {/* Mobile grab handle */}
              <div className="bottom-sheet-drag-handle" />

              {/* Banner / Header */}
              <div className="combo-drawer-banner">
                <img
                  src={item.imageUrl || FALLBACK_DISH_IMG}
                  alt={item.name}
                  className="combo-drawer-banner-img"
                  onError={(e) => {
                    e.currentTarget.src = FALLBACK_DISH_IMG;
                  }}
                />
                <div className="combo-drawer-banner-gradient">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.85rem' }}>{item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
                      <span className="combo-card-pax-tag" style={{ position: 'static' }}>{item.category}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleWishlist(item.id, e);
                        }}
                        style={{
                          background: 'rgba(0,0,0,0.6)',
                          color: wishlist.has(item.id) ? '#f43f5e' : '#fff',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '50%',
                          width: '32px',
                          height: '32px',
                          fontSize: '1rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title={wishlist.has(item.id) ? 'In favorites' : 'Add to favorites'}
                      >
                        {wishlist.has(item.id) ? '❤️' : '🤍'}
                      </button>
                      <button
                        onClick={() => {
                          setActiveCustomizingItem(null);
                          setExpandedAccordionItemId(null);
                        }}
                        style={{
                          background: 'rgba(0,0,0,0.6)',
                          color: '#fff',
                          border: '1px solid rgba(255,255,255,0.2)',
                          borderRadius: '50%',
                          width: '32px',
                          height: '32px',
                          fontSize: '1rem',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Close"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                    <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>⏱️ {item.prepTimeMinutes} mins</span>
                    <span style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 700 }}>★ {item.rating.toFixed(1)}</span>
                  </div>
                  <h2 className="combo-drawer-title">{item.name}</h2>
                </div>
              </div>

              {/* Scrollable Customization Content */}
              <div className="drawer-body customizer-drawer-body" style={{ padding: '16px 20px', overflowY: 'auto' }}>
                <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4, marginBottom: '14px' }}>
                  {item.description}
                </p>

                {/* Main Dish Customization Card matching Combo styling */}
                <div className="combo-builder-dish-card" style={{ marginBottom: '16px' }}>
                  {/* Dish Card Header with Quantity Stepper */}
                  <div className="combo-dish-header" style={{ marginBottom: '12px' }}>
                    <div className="combo-dish-name">
                      <span>{item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
                      <span>Order Quantity:</span>
                    </div>
                    <div className="combo-stepper-control">
                      <button
                        type="button"
                        className="combo-stepper-btn"
                        onClick={() => handleAccordionQtyChange(accordionQty - 1)}
                        disabled={accordionQty <= 1}
                      >
                        −
                      </button>
                      <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fbbf24', minWidth: '18px', textAlign: 'center' }}>
                        {accordionQty}
                      </span>
                      <button
                        type="button"
                        className="combo-stepper-btn"
                        onClick={() => handleAccordionQtyChange(accordionQty + 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>

                  {/* Multi-plate split toggle: Only visible when Quantity > 1 */}
                  {accordionQty > 1 && (
                    <div
                      className="plate-split-toggle-box"
                      onClick={handleTogglePerPlateSplit}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 14px',
                        background: isPerPlateSplit ? 'rgba(245, 158, 11, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                        border: isPerPlateSplit ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                        borderRadius: '10px',
                        marginBottom: '14px',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.82rem', color: '#f8fafc', fontWeight: 600 }}>
                        <span>🔀</span>
                        <span>Customise each plate separately</span>
                      </div>
                      <input
                        type="checkbox"
                        checked={isPerPlateSplit}
                        onChange={handleTogglePerPlateSplit}
                        style={{ accentColor: '#f59e0b', width: '16px', height: '16px', cursor: 'pointer' }}
                      />
                    </div>
                  )}

                  {/* Horizontal Selectable Plate Tabs: ONLY when per-plate split is active */}
                  {isPerPlateSplit && accordionQty > 1 && (
                    <div style={{ marginBottom: '14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.74rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 }}>
                          Select plate to customise (tap tab):
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setPlateNamingTarget({
                              type: 'ITEM',
                              plateIndex: activePlateIndex,
                              currentName: activePlateDisplayName,
                            });
                            setPlateNameInput(activePlateDisplayName);
                          }}
                          className="plate-assign-trigger-btn"
                          title="Rename plate or assign diner profile"
                        >
                          ✏️ {currentPlate?.customName && !currentPlate.customName.startsWith('Plate') ? currentPlate.customName : 'Assign Profile'}
                        </button>
                      </div>

                      <div className="combo-plate-tabs-scroll">
                        {plateConfigs.map((cfg) => {
                          const isActive = cfg.plateIndex === activePlateIndex;
                          const cfgPortion = cfg.portion || 'FULL';
                          const basePrice = cfgPortion === 'HALF' ? halfPaise : fullPaise;
                          const plateModsTotal = (cfg.modifiers || []).reduce((sum, m) => sum + m.pricePaise, 0);
                          const plateTotalPaise = basePrice + plateModsTotal;

                          return (
                            <button
                              key={cfg.plateIndex}
                              type="button"
                              className={`combo-plate-tab ${isActive ? 'active' : ''}`}
                              onClick={() => setActivePlateIndex(cfg.plateIndex)}
                            >
                              <span>🍽️ {cfg.customName || `Plate ${cfg.plateIndex}`}{cfgPortion === 'HALF' ? ' (Half)' : ''}</span>
                              <span className="combo-plate-tab-badge">
                                ₹{(plateTotalPaise / 100).toFixed(0)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Portion Size Selector (Full vs Half) */}
                  {hasPortions && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>
                          Portion Size{isMultiPlate ? ` for ${activePlateDisplayName}` : ''}:
                        </span>
                        {halfPaise < fullPaise && (
                          <span style={{ fontSize: '0.72rem', color: '#fbbf24', fontWeight: 600 }}>
                            Save ₹{(upgradeDiffPaise / 100).toFixed(0)} on Half
                          </span>
                        )}
                      </div>
                      <div className="combo-portion-selector-grid">
                        <button
                          type="button"
                          className={`combo-portion-toggle-btn ${activePortion === 'HALF' ? 'active' : ''}`}
                          onClick={() => onSelectPortion('HALF')}
                        >
                          <div className="portion-title">
                            <span>{activePortion === 'HALF' ? '✓ ' : '○ '}Half Portion</span>
                          </div>
                          <div className="portion-subtitle">₹{(halfPaise / 100).toFixed(0)}</div>
                        </button>

                        <button
                          type="button"
                          className={`combo-portion-toggle-btn ${activePortion === 'FULL' ? 'active' : ''}`}
                          onClick={() => onSelectPortion('FULL')}
                        >
                          <div className="portion-title">
                            <span>{activePortion === 'FULL' ? '✓ ' : '○ '}Full Portion</span>
                          </div>
                          <div className="portion-subtitle">₹{(fullPaise / 100).toFixed(0)}</div>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Spice Level Preference: Deduplicated so it only shows if dish has NO spice modifier group */}
                  {!hasSpiceModifierGroup && item.category !== 'Desserts' && item.category !== 'Beverages' && (
                    <div style={{ marginBottom: '16px' }}>
                      <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                        Spice Preference{isMultiPlate ? ` for ${activePlateDisplayName}` : ''}:
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                        {(['MILD', 'MEDIUM', 'HOT', 'NONE'] as const).map((sp) => {
                          const isSpActive = activeSpice === sp;
                          return (
                            <button
                              key={sp}
                              type="button"
                              className={`combo-option-pill ${isSpActive ? 'active' : ''}`}
                              style={{ textAlign: 'center', padding: '8px 4px' }}
                              onClick={() => onSelectSpice(sp)}
                            >
                              {sp === 'MILD' ? '🌿 Mild' : sp === 'MEDIUM' ? '🌶️ Medium' : sp === 'HOT' ? '🔥 Hot' : '🚫 Plain'}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Modifier Groups & Add-ons formatted with combo-addon-item-card */}
                  {groups.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '16px' }}>
                      {groups.map((grp) => {
                        const isSingle = grp.selectionType === 'SINGLE';
                        return (
                          <div key={grp.id}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                              <div>
                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc' }}>{grp.name}</span>
                                {grp.isRequired && <span style={{ color: '#f59e0b', fontSize: '0.72rem', marginLeft: '6px' }}>*Required</span>}
                              </div>
                              <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                {isSingle ? 'Choose 1' : grp.maxSelections ? `Up to ${grp.maxSelections}` : 'Optional'}
                              </span>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {grp.modifiers.map((mod) => {
                                const isSelected = activeModifiers.some((m) => m.id === mod.id);
                                return (
                                  <div
                                    key={mod.id}
                                    className={`combo-addon-item-card ${isSelected ? 'selected' : ''}`}
                                    onClick={() => onToggleModifier(mod, grp)}
                                  >
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                      <div
                                        className="combo-addon-checkbox"
                                        style={isSingle ? { borderRadius: '50%' } : {}}
                                      >
                                        {isSelected && '✓'}
                                      </div>
                                      <span style={{ fontSize: '0.78rem', color: isSelected ? '#fff' : '#cbd5e1', fontWeight: isSelected ? 600 : 400 }}>
                                        {mod.name}
                                      </span>
                                    </div>
                                    <span className={`combo-addon-price-tag ${mod.pricePaise === 0 ? 'free' : ''}`}>
                                      {mod.pricePaise > 0 ? `+₹${(mod.pricePaise / 100).toFixed(0)}` : 'Free'}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Chef Cooking Instructions & Notes */}
                  <div style={{ marginBottom: '14px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginBottom: '8px' }}>
                      Chef Instructions{isMultiPlate ? ` for ${activePlateDisplayName}` : ''}:
                    </div>
                    <div className="combo-pill-options-wrap">
                      {(CATEGORY_COOK_NOTE_CHIPS[item.category] || ['Less Oil / Less Spicy', 'Crispy', 'Extra Gravy', 'No Onion / Garlic', 'Pack Separately']).map((chip) => {
                        const isSelected = (activeNote || '').includes(chip);
                        return (
                          <button
                            key={chip}
                            type="button"
                            className={`combo-option-pill ${isSelected ? 'active' : ''}`}
                            onClick={() => onToggleChip(chip)}
                          >
                            {isSelected ? '✓ ' : '+ '} {chip}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      placeholder={notePlaceholder}
                      value={activeNote}
                      onChange={(e) => onChangeNote(e.target.value)}
                      className="combo-plate-name-input"
                      style={{ marginTop: '10px' }}
                      maxLength={100}
                    />
                  </div>
                </div>
              </div>

              {/* Sticky Footer: Static Price & Add to Order Button */}
              <div
                className="drawer-footer customizer-drawer-footer"
                style={{
                  borderTop: '1px solid rgba(255,255,255,0.1)',
                  background: '#111624',
                  padding: '14px 20px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '16px' }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Total Price:</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fbbf24' }}>
                      ₹{(currentTotalPricePaise / 100).toFixed(0)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="hero-action-btn"
                    style={{
                      flex: 1,
                      maxWidth: '260px',
                      padding: '12px 18px',
                      fontSize: '0.95rem',
                      fontWeight: 800,
                      background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                      color: '#000',
                      boxShadow: '0 4px 18px rgba(245, 158, 11, 0.35)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '8px',
                      borderRadius: '10px',
                      border: 'none',
                      cursor: 'pointer',
                    }}
                    onClick={(e) => handleAddAccordionToCart(item, e)}
                  >
                    <span>Add to Order ·</span>
                    <span>₹{(currentTotalPricePaise / 100).toFixed(0)}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Interactive Combo Customizer Drawer / Modal ── */}
      {activeComboOffer && (
        <div className="side-drawer-wrap customizer-drawer-wrap" onClick={() => setActiveComboOffer(null)}>
          <div
            className="side-drawer-panel combo-drawer-panel customizer-drawer-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '560px', width: '100%', padding: 0 }}
          >
            {/* Mobile grab handle */}
            <div className="bottom-sheet-drag-handle" />

            {/* Banner */}
            <div className="combo-drawer-banner">
              <img
                src={activeComboOffer.imageUrl}
                alt={activeComboOffer.name}
                className="combo-drawer-banner-img"
              />
              <div className="combo-drawer-banner-gradient">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span className="combo-card-badge" style={{ position: 'static' }}>{activeComboOffer.badge}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWishlist(activeComboOffer.id, e);
                      }}
                      style={{
                        background: 'rgba(0,0,0,0.6)',
                        color: wishlist.has(activeComboOffer.id) ? '#f43f5e' : '#fff',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title={wishlist.has(activeComboOffer.id) ? 'In favorites' : 'Add to favorites'}
                    >
                      {wishlist.has(activeComboOffer.id) ? '❤️' : '🤍'}
                    </button>
                    <button
                      onClick={() => setActiveComboOffer(null)}
                      style={{
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.2)',
                        borderRadius: '50%',
                        width: '32px',
                        height: '32px',
                        fontSize: '1rem',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="Close"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                  <span style={{ fontSize: '0.75rem' }}>{activeComboOffer.vegType === 'VEG' ? '🟢' : '🔴'}</span>
                  <span className="combo-card-pax-tag" style={{ position: 'static' }}>{activeComboOffer.tag}</span>
                  <span style={{ fontSize: '0.75rem', color: '#fbbf24', fontWeight: 700 }}>★ {activeComboOffer.rating}</span>
                  <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>⏱️ {activeComboOffer.prepTimeMinutes} mins</span>
                </div>
                <h2 className="combo-drawer-title">{activeComboOffer.name}</h2>
              </div>
            </div>

            {/* Body */}
            <div className="drawer-body customizer-drawer-body" style={{ padding: '16px 20px', overflowY: 'auto' }}>
              <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4, marginBottom: '16px' }}>
                {activeComboOffer.description}
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {activeComboOffer.components.map((comp) => {
                  const isCustomizableDish =
                    comp.categoryType === 'MAIN' ||
                    comp.categoryType === 'RICE' ||
                    comp.categoryType === 'STARTER';

                  if (isCustomizableDish) {
                    const dishPlates = comboDishPlates[comp.id] || [];
                    const activePlateId = activeDishPlateId[comp.id] || dishPlates[0]?.plateId;
                    const activePlate = dishPlates.find((p) => p.plateId === activePlateId) || dishPlates[0];

                    return (
                      <div key={comp.id} className="combo-builder-dish-card">
                        {/* Dish Header */}
                        <div className="combo-dish-header">
                          <div className="combo-dish-name">
                            <span>{comp.categoryType === 'RICE' ? '🍚' : comp.categoryType === 'STARTER' ? '🍢' : '🍲'}</span>
                            <span>{comp.name}</span>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className="combo-dish-badge-included">Included ×{comp.includedQty}</span>
                            <span style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                              Extra +₹{(comp.extraPlatePricePaise / 100).toFixed(0)}
                            </span>
                          </div>
                        </div>

                        {/* Horizontal Selectable Plate List */}
                        <div style={{ marginBottom: '6px' }}>
                          <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Select plate to customise (tap tab to switch):</span>
                            <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                              {dishPlates.length} {dishPlates.length === 1 ? 'Plate' : 'Plates'}
                            </span>
                          </div>

                          <div className="combo-plate-tabs-scroll">
                            {dishPlates.map((plate) => {
                              const isSelected = plate.plateId === activePlate?.plateId;
                              const modsCostPaise = plate.selectedModifiers.reduce((acc, m) => acc + m.pricePaise, 0);
                              const totalExtraForPlate = (plate.isExtraPlate ? plate.pricePaise : 0) + modsCostPaise;

                              return (
                                <button
                                  key={plate.plateId}
                                  type="button"
                                  className={`combo-plate-tab ${isSelected ? 'active' : ''}`}
                                  onClick={() =>
                                    setActiveDishPlateId((prev) => ({
                                      ...prev,
                                      [comp.id]: plate.plateId,
                                    }))
                                  }
                                >
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                    {plate.isExtraPlate ? '➕' : '🍽️'} {plate.customName}
                                  </span>
                                  {totalExtraForPlate > 0 && (
                                    <span className="combo-plate-tab-badge">
                                      +₹{(totalExtraForPlate / 100).toFixed(0)}
                                    </span>
                                  )}
                                </button>
                              );
                            })}

                            {/* + Add Plate Button at end of horizontal list */}
                            <button
                              type="button"
                              className="combo-add-plate-tab-btn"
                              onClick={() => handleAddDishPlate(comp)}
                              title={`Add another plate of ${comp.name} (+₹${(comp.extraPlatePricePaise / 100).toFixed(0)})`}
                            >
                              <span>＋</span>
                              <span>Add Plate (+₹{(comp.extraPlatePricePaise / 100).toFixed(0)})</span>
                            </button>
                          </div>
                        </div>

                        {/* Full Customisation Panel for Currently Selected Plate */}
                        {activePlate && (
                          <div className="combo-plate-panel">
                            {/* Plate Header with subtle Pencil Icon & Assign Profile trigger */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#fbbf24' }}>
                                  🍽️ {activePlate.customName}
                                </span>
                                {activePlate.isExtraPlate && (
                                  <span style={{ fontSize: '0.66rem', padding: '1px 6px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                                    EXTRA (+₹{(activePlate.pricePaise / 100).toFixed(0)})
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenPlateNamingModal({
                                      type: 'COMBO',
                                      compId: comp.id,
                                      plateId: activePlate.plateId,
                                      currentName: activePlate.customName,
                                    })
                                  }
                                  className="plate-assign-trigger-btn"
                                  title="Change diner profile or rename plate"
                                >
                                  ✏️ {activePlate.customName && !activePlate.customName.startsWith('Plate') ? activePlate.customName : 'Assign Profile'}
                                </button>
                                {activePlate.isExtraPlate && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveDishPlate(comp.id, activePlate.plateId)}
                                    style={{
                                      background: 'transparent',
                                      border: 'none',
                                      color: '#ef4444',
                                      fontSize: '0.74rem',
                                      fontWeight: 700,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    ✕ Remove
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Portion Size Selector for Combo Component Plate (Rules 4 & 5) */}
                            {comp.allowPortionSwitch && comp.fullPricePaise && comp.halfPricePaise && (
                              <div style={{ marginBottom: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                  <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 600 }}>
                                    Portion Size for {activePlate.customName}:
                                  </span>
                                  {activePlate.portion === (comp.defaultPortion || 'FULL') && (
                                    <span style={{ fontSize: '0.68rem', color: '#fbbf24', fontWeight: 600 }}>
                                      ★ Combo Standard Serving
                                    </span>
                                  )}
                                </div>
                                {(() => {
                                  const deltaInfo = getComboPlatePortionDelta(comp, activePlate.portion);
                                  const isDefFull = (comp.defaultPortion || 'FULL') === 'FULL';
                                  const isDefHalf = comp.defaultPortion === 'HALF';

                                  return (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                                      {/* Half Plate Option */}
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateDishPlatePortion(comp.id, activePlate.plateId, 'HALF')}
                                        style={{
                                          padding: '8px 10px',
                                          borderRadius: '8px',
                                          border: activePlate.portion === 'HALF' ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                                          background: activePlate.portion === 'HALF' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(255,255,255,0.03)',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          gap: '2px',
                                          transition: 'all 0.15s ease',
                                        }}
                                      >
                                        <span style={{ fontSize: '0.80rem', fontWeight: 700, color: activePlate.portion === 'HALF' ? '#fbbf24' : '#fff' }}>
                                          {activePlate.portion === 'HALF' ? '✓ ' : '○ '}Half Plate
                                        </span>
                                        <span style={{ fontSize: '0.72rem', color: activePlate.portion === 'HALF' ? '#fbbf24' : '#94a3b8' }}>
                                          {isDefHalf
                                            ? 'Included in Feast'
                                            : `₹${(comp.halfPricePaise / 100).toFixed(0)} (A-la-carte)`}
                                        </span>
                                      </button>

                                      {/* Full Plate Option */}
                                      <button
                                        type="button"
                                        onClick={() => handleUpdateDishPlatePortion(comp.id, activePlate.plateId, 'FULL')}
                                        style={{
                                          padding: '8px 10px',
                                          borderRadius: '8px',
                                          border: activePlate.portion === 'FULL' ? '1.5px solid #f59e0b' : '1px solid rgba(255,255,255,0.1)',
                                          background: activePlate.portion === 'FULL' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(255,255,255,0.03)',
                                          cursor: 'pointer',
                                          display: 'flex',
                                          flexDirection: 'column',
                                          alignItems: 'center',
                                          gap: '2px',
                                          transition: 'all 0.15s ease',
                                        }}
                                      >
                                        <span style={{ fontSize: '0.80rem', fontWeight: 700, color: activePlate.portion === 'FULL' ? '#fbbf24' : '#fff' }}>
                                          {activePlate.portion === 'FULL' ? '✓ ' : '○ '}
                                          {activePlate.portion === 'HALF'
                                            ? `Full Plate (+₹${(deltaInfo.diffForFullPlatePaise / 100).toFixed(0)})`
                                            : 'Full Plate'}
                                        </span>
                                        <span style={{ fontSize: '0.72rem', color: activePlate.portion === 'FULL' ? '#fbbf24' : '#94a3b8' }}>
                                          {activePlate.portion === 'FULL'
                                            ? (isDefFull ? 'Included in Feast' : `+₹${(deltaInfo.portionDeltaPaise / 100).toFixed(0)} (10% Off)`)
                                            : 'Upgrade'}
                                        </span>
                                      </button>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}

                            {/* Spice Level Preference */}
                            {comp.spiceChoice !== false && (
                              <div style={{ marginBottom: '12px' }}>
                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '5px' }}>
                                  Spice Preference for {activePlate.customName}:
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px' }}>
                                  {(['MILD', 'MEDIUM', 'HOT'] as const).map((sp) => (
                                    <button
                                      key={sp}
                                      type="button"
                                      className={`combo-option-pill ${activePlate.spice === sp ? 'active' : ''}`}
                                      style={{ textAlign: 'center', padding: '7px 4px' }}
                                      onClick={() =>
                                        handleUpdateDishPlateSpice(comp.id, activePlate.plateId, sp)
                                      }
                                    >
                                      {sp === 'MILD' ? '🍃 Mild' : sp === 'MEDIUM' ? '🌶️ Medium' : '🔥 Extra Spicy'}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Chef Preparation Chips */}
                            <div style={{ marginBottom: '12px' }}>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '5px' }}>
                                Chef Instructions for {activePlate.customName}:
                              </div>
                              <div className="combo-pill-options-wrap">
                                {(comp.categoryType === 'RICE'
                                  ? CATEGORY_COOK_NOTE_CHIPS['Biryani & Rice']!
                                  : comp.categoryType === 'STARTER'
                                  ? CATEGORY_COOK_NOTE_CHIPS['Starters']!
                                  : CATEGORY_COOK_NOTE_CHIPS['Main Course']!
                                ).map((chip) => {
                                  const isSelected = activePlate.notes.includes(chip);
                                  return (
                                    <button
                                      key={chip}
                                      type="button"
                                      className={`combo-option-pill ${isSelected ? 'active' : ''}`}
                                      onClick={() =>
                                        handleToggleDishPlateChip(comp.id, activePlate.plateId, chip)
                                      }
                                    >
                                      {chip}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>

                            {/* Kitchen Note Input */}
                            <div style={{ marginBottom: '12px' }}>
                              <input
                                type="text"
                                placeholder={`Specific note for ${activePlate.customName} (e.g. less salt, well done)...`}
                                value={activePlate.notes}
                                onChange={(e) =>
                                  handleUpdateDishPlateNotes(comp.id, activePlate.plateId, e.target.value)
                                }
                                className="accordion-note-input"
                                style={{ width: '100%', fontSize: '0.76rem', padding: '6px 10px' }}
                              />
                            </div>

                            {/* Full Recommended Add-ons & Modifiers with Prices */}
                            {(() => {
                              const availableAddons =
                                DISH_RECOMMENDED_ADDONS[comp.categoryType] || DISH_RECOMMENDED_ADDONS['MAIN'] || [];

                              if (availableAddons.length === 0) return null;

                              return (
                                <div>
                                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: '6px', display: 'flex', justifyContent: 'space-between' }}>
                                    <span>Recommended Add-ons for {activePlate.customName}:</span>
                                    <span style={{ color: '#64748b' }}>Added per plate</span>
                                  </div>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {availableAddons.map((addon) => {
                                      const isChecked = activePlate.selectedModifiers.some((m) => m.id === addon.id);

                                      return (
                                        <div
                                          key={addon.id}
                                          className={`combo-addon-item-card ${isChecked ? 'selected' : ''}`}
                                          onClick={() =>
                                            handleToggleDishPlateModifier(comp.id, activePlate.plateId, addon)
                                          }
                                        >
                                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div className="combo-addon-checkbox">
                                              {isChecked && '✓'}
                                            </div>
                                            <span style={{ fontSize: '0.78rem', color: isChecked ? '#fff' : '#cbd5e1', fontWeight: isChecked ? 600 : 400 }}>
                                              {addon.name}
                                            </span>
                                          </div>
                                          <span className={`combo-addon-price-tag ${addon.pricePaise === 0 ? 'free' : ''}`}>
                                            {addon.pricePaise > 0 ? `+₹${(addon.pricePaise / 100).toFixed(0)}` : 'Free'}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  }

                  {/* 2. Breads Component */}
                  if (comp.categoryType === 'BREAD') {
                    return (
                      <div key={comp.id} className="combo-builder-dish-card">
                        <div className="combo-dish-header">
                          <div className="combo-dish-name">
                            <span>🍞</span>
                            <span>{comp.name}</span>
                          </div>
                          <span className="combo-dish-badge-included">Included ×{comp.includedQty}</span>
                        </div>

                        {comp.options && comp.options.length > 0 && (
                          <div style={{ marginBottom: '10px' }}>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '4px' }}>Choice of Bread:</div>
                            <div className="combo-pill-options-wrap">
                              {comp.options.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  className={`combo-option-pill ${(comboBreadType[comp.id] || comp.options![0]) === opt ? 'active' : ''}`}
                                  onClick={() => setComboBreadType((prev) => ({ ...prev, [comp.id]: opt }))}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px' }}>
                          <div>
                            <div style={{ fontSize: '0.78rem', color: '#fff', fontWeight: 700 }}>Total Breads: {comp.includedQty + comboExtraBreadsQty} pcs</div>
                            <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                              ({comp.includedQty} included in feast{comboExtraBreadsQty > 0 ? ` + ${comboExtraBreadsQty} extra @ ₹${(comp.extraPlatePricePaise / 100).toFixed(0)}/pc` : ''})
                            </div>
                          </div>
                          <div className="combo-stepper-control">
                            <button
                              type="button"
                              className="combo-stepper-btn"
                              disabled={comboExtraBreadsQty <= 0}
                              onClick={() => setComboExtraBreadsQty((prev) => Math.max(0, prev - 1))}
                            >
                              −
                            </button>
                            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fbbf24', minWidth: '16px', textAlign: 'center' }}>
                              {comp.includedQty + comboExtraBreadsQty}
                            </span>
                            <button
                              type="button"
                              className="combo-stepper-btn"
                              onClick={() => setComboExtraBreadsQty((prev) => prev + 1)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  {/* 3. Beverage Component */}
                  if (comp.categoryType === 'BEVERAGE') {
                    return (
                      <div key={comp.id} className="combo-builder-dish-card">
                        <div className="combo-dish-header">
                          <div className="combo-dish-name">
                            <span>🥤</span>
                            <span>{comp.name}</span>
                          </div>
                          <span className="combo-dish-badge-included">Included ×{comp.includedQty}</span>
                        </div>

                        {comp.options && comp.options.length > 0 && (
                          <div style={{ marginBottom: '10px' }}>
                            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginBottom: '4px' }}>Select Beverage:</div>
                            <div className="combo-pill-options-wrap">
                              {comp.options.map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  className={`combo-option-pill ${(comboDrinkChoices[comp.id] || comp.options![0]) === opt ? 'active' : ''}`}
                                  onClick={() => setComboDrinkChoices((prev) => ({ ...prev, [comp.id]: opt }))}
                                >
                                  {opt}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px' }}>
                          <div>
                            <div style={{ fontSize: '0.78rem', color: '#fff', fontWeight: 700 }}>Total Drinks: {comp.includedQty + comboExtraDrinksQty} glasses</div>
                            <div style={{ fontSize: '0.68rem', color: '#94a3b8' }}>
                              ({comp.includedQty} included{comboExtraDrinksQty > 0 ? ` + ${comboExtraDrinksQty} extra @ ₹79/glass` : ''})
                            </div>
                          </div>
                          <div className="combo-stepper-control">
                            <button
                              type="button"
                              className="combo-stepper-btn"
                              disabled={comboExtraDrinksQty <= 0}
                              onClick={() => setComboExtraDrinksQty((prev) => Math.max(0, prev - 1))}
                            >
                              −
                            </button>
                            <span style={{ fontSize: '0.85rem', fontWeight: 800, color: '#fbbf24', minWidth: '16px', textAlign: 'center' }}>
                              {comp.includedQty + comboExtraDrinksQty}
                            </span>
                            <button
                              type="button"
                              className="combo-stepper-btn"
                              onClick={() => setComboExtraDrinksQty((prev) => prev + 1)}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  }

                  {/* 4. Dessert Component */}
                  return (
                    <div key={comp.id} className="combo-builder-dish-card">
                      <div className="combo-dish-header">
                        <div className="combo-dish-name">
                          <span>🍨</span>
                          <span>{comp.name}</span>
                        </div>
                        <span className="combo-dish-badge-included">Included ×{comp.includedQty}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(255,255,255,0.02)', padding: '8px 12px', borderRadius: '8px' }}>
                        <span style={{ fontSize: '0.78rem', color: '#e2e8f0' }}>Freshly prepared artisanal dessert</span>
                        <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 700 }}>Included ✓</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sticky Bottom Footer */}
            <div
              className="drawer-footer customizer-drawer-footer"
              style={{
                borderTop: '1px solid rgba(255,255,255,0.1)',
                background: '#111624',
                padding: '14px 20px',
              }}
            >
              {(() => {
                let extraPlatesAndModifiersSum = 0;
                activeComboOffer.components.forEach((c) => {
                  const plates = comboDishPlates[c.id] || [];
                  plates.forEach((p) => {
                    if (p.isExtraPlate && p.pricePaise > 0) extraPlatesAndModifiersSum += p.pricePaise;
                    const portionDelta = getComboPlatePortionDelta(c, p.portion || 'FULL');
                    extraPlatesAndModifiersSum += portionDelta.portionDeltaPaise;
                    p.selectedModifiers.forEach((m) => {
                      extraPlatesAndModifiersSum += m.pricePaise;
                    });
                  });
                });

                const breadComp = activeComboOffer.components.find((c) => c.categoryType === 'BREAD');
                const extraBreadsSum = comboExtraBreadsQty * (breadComp?.extraPlatePricePaise || 6000);
                const extraDrinksSum = comboExtraDrinksQty * 7900;
                const isGarlicNaan = Object.values(comboBreadType).some((b) => b.includes('Garlic'));
                const breadUpgradeSum = isGarlicNaan ? 2000 : 0;

                const totalComboPaise =
                  activeComboOffer.comboPricePaise +
                  extraPlatesAndModifiersSum +
                  extraBreadsSum +
                  extraDrinksSum +
                  breadUpgradeSum;
                const totalOriginalPaise =
                  activeComboOffer.originalPricePaise +
                  extraPlatesAndModifiersSum +
                  extraBreadsSum +
                  extraDrinksSum +
                  breadUpgradeSum;
                const currentSavingsPaise = totalOriginalPaise - totalComboPaise;

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Total Bundle Price:</div>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
                          <span style={{ fontSize: '1.25rem', fontWeight: 800, color: '#fbbf24' }}>
                            ₹{(totalComboPaise / 100).toFixed(0)}
                          </span>
                          <span style={{ fontSize: '0.8rem', color: '#64748b', textDecoration: 'line-through' }}>
                            ₹{(totalOriginalPaise / 100).toFixed(0)}
                          </span>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '3px 8px',
                            borderRadius: '4px',
                            background: 'rgba(16, 185, 129, 0.2)',
                            color: '#34d399',
                            border: '1px solid rgba(16, 185, 129, 0.3)',
                          }}
                        >
                          SAVE ₹{(currentSavingsPaise / 100).toFixed(0)}
                        </span>
                      </div>
                    </div>

                    <button
                      type="button"
                      className="hero-action-btn"
                      style={{
                        width: '100%',
                        padding: '12px',
                        fontSize: '0.95rem',
                        fontWeight: 800,
                        background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                        color: '#000',
                        boxShadow: '0 4px 18px rgba(245, 158, 11, 0.35)',
                      }}
                      onClick={handleAddComboToCart}
                    >
                      Add Combo to Order · ₹{(totalComboPaise / 100).toFixed(0)}
                    </button>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Cart Drawer (Always accessible from top bar cart icon) */}
      {isCartOpen && (
        <div className="side-drawer-wrap" onClick={() => setIsCartOpen(false)}>
          <div className="side-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.2rem' }}>🛒</span>
                <span className="drawer-title">Table {selectedTable} Cart</span>
              </div>
              <button onClick={() => setIsCartOpen(false)} style={{ color: '#94a3b8', fontSize: '1.2rem' }}>
                ✕
              </button>
            </div>

            {/* Quick Link to Table Orders if dishes are already placed */}
            {flattenedPlates.length > 0 && (
              <div
                style={{
                  background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.2))',
                  border: '1px solid rgba(16,185,129,0.3)',
                  borderRadius: '10px',
                  padding: '10px 14px',
                  margin: '12px 16px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '1.2rem' }}>📋</span>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#34d399' }}>
                      {flattenedPlates.length} {flattenedPlates.length === 1 ? 'item' : 'items'} ordered for Table {selectedTable}
                    </div>
                    <div style={{ fontSize: '0.70rem', color: '#94a3b8' }}>
                      Cooking, served &amp; course status
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsCartOpen(false);
                    setIsOrdersHistoryOpen(true);
                  }}
                  style={{
                    background: '#10b981',
                    color: '#000',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    fontSize: '0.74rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  View Orders →
                </button>
              </div>
            )}

            <div className="drawer-body">
              {cartLines.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                  <div style={{ fontSize: '3rem', marginBottom: '14px' }}>🍽️</div>
                  <h4 style={{ color: '#fff', marginBottom: '6px' }}>Your cart is empty</h4>
                  <p style={{ fontSize: '0.85rem', marginBottom: '20px' }}>
                    Browse our chef specialties or choose from the menu!
                  </p>
                  <button
                    className="hero-action-btn"
                    onClick={() => {
                      setIsCartOpen(false);
                      setCurrentView('menu');
                    }}
                  >
                    Browse Full Menu →
                  </button>
                  {flattenedPlates.length > 0 && (
                    <div style={{ marginTop: '14px' }}>
                      <button
                        onClick={() => {
                          setIsCartOpen(false);
                          setIsOrdersHistoryOpen(true);
                        }}
                        style={{
                          background: 'rgba(16,185,129,0.15)',
                          border: '1px solid rgba(16,185,129,0.4)',
                          color: '#34d399',
                          borderRadius: '8px',
                          padding: '10px 18px',
                          fontSize: '0.85rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>📋</span>
                        <span>View Table Orders ({flattenedPlates.length})</span>
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                  {cartLines.map((line) => {
                    const modsTotal = line.selectedModifiers.reduce((acc, m) => acc + m.pricePaise, 0);
                    const linePricePaise = (line.item.pricePaise + modsTotal) * line.quantity;

                    return (
                      <div
                        key={line.cartLineId}
                        style={{
                          background: 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          borderRadius: '12px',
                          padding: '12px 14px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{line.item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
                              <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.92rem' }}>
                                {line.item.name}
                              </span>
                              {line.portion === 'HALF' && (
                                <span
                                  style={{
                                    fontSize: '0.66rem',
                                    fontWeight: 800,
                                    padding: '1px 6px',
                                    borderRadius: '4px',
                                    background: 'rgba(245, 158, 11, 0.2)',
                                    color: '#fbbf24',
                                    border: '1px solid rgba(245, 158, 11, 0.4)',
                                    letterSpacing: '0.04em',
                                  }}
                                >
                                  HALF PLATE
                                </span>
                              )}
                              {line.plateLabel && <span className="plate-badge-pill">{line.plateLabel}</span>}
                              <button
                                type="button"
                                onClick={() => {
                                  if (cartPlateEditingId === line.cartLineId) {
                                    setCartPlateEditingId(null);
                                    setCartPlateDigits('');
                                  } else {
                                    setCartPlateEditingId(line.cartLineId);
                                    setCartPlateDigits(
                                      sanitizeTableDigits(line.targetTableNumber || (selectedTable !== '--' ? selectedTable : '')),
                                    );
                                  }
                                }}
                                style={{
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  padding: '2px 7px',
                                  borderRadius: '999px',
                                  background: line.targetTableNumber
                                    ? 'rgba(16, 185, 129, 0.16)'
                                    : 'rgba(255, 255, 255, 0.08)',
                                  border: line.targetTableNumber
                                    ? '1px solid rgba(16, 185, 129, 0.45)'
                                    : '1px solid rgba(255, 255, 255, 0.16)',
                                  color: line.targetTableNumber ? '#34d399' : '#cbd5e1',
                                  cursor: 'pointer',
                                }}
                                title="Change table number for this plate before checkout"
                              >
                                🪑 Table {line.targetTableNumber || (selectedTable !== '--' ? selectedTable : 'Select')} ✎
                              </button>
                            </div>
                            <div style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: 700, marginTop: '2px' }}>
                              ₹{(linePricePaise / 100).toFixed(0)}
                            </div>
                          </div>

                          <button
                            onClick={() => handleRemoveCartLine(line.cartLineId)}
                            style={{ color: '#ef4444', fontSize: '0.8rem', padding: '4px' }}
                            title="Remove line"
                          >
                            🗑️
                          </button>
                        </div>

                        {cartPlateEditingId === line.cartLineId && (
                          <div
                            style={{
                              background: 'rgba(15, 23, 42, 0.9)',
                              border: '1px solid rgba(245, 158, 11, 0.35)',
                              borderRadius: '8px',
                              padding: '8px 10px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="Table #"
                                value={cartPlateDigits}
                                onChange={(e) => setCartPlateDigits(sanitizeTableDigits(e.target.value))}
                                style={{
                                  width: '90px',
                                  padding: '5px 8px',
                                  borderRadius: '6px',
                                  background: 'rgba(255,255,255,0.08)',
                                  border: '1px solid rgba(255,255,255,0.18)',
                                  color: '#fff',
                                  fontSize: '0.82rem',
                                  fontWeight: 700,
                                }}
                              />
                              <button
                                type="button"
                                disabled={!cartPlateValidation.matched}
                                onClick={() => {
                                  if (cartPlateValidation.matched) {
                                    handleAssignCartLineTable(line.cartLineId, cartPlateValidation.matched);
                                  }
                                }}
                                style={{
                                  padding: '5px 10px',
                                  borderRadius: '6px',
                                  border: 'none',
                                  background: cartPlateValidation.matched
                                    ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                    : 'rgba(255,255,255,0.08)',
                                  color: cartPlateValidation.matched ? '#000' : '#64748b',
                                  fontSize: '0.74rem',
                                  fontWeight: 800,
                                  cursor: cartPlateValidation.matched ? 'pointer' : 'not-allowed',
                                }}
                              >
                                {line.quantity > 1 ? 'Move 1 Plate' : 'Save Table'}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setCartPlateEditingId(null);
                                  setCartPlateDigits('');
                                }}
                                style={{
                                  padding: '5px 8px',
                                  borderRadius: '6px',
                                  background: 'transparent',
                                  border: '1px solid rgba(255,255,255,0.14)',
                                  color: '#94a3b8',
                                  fontSize: '0.72rem',
                                  cursor: 'pointer',
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                            {cartPlateValidation.error && (
                              <div style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>
                                {cartPlateValidation.error}
                              </div>
                            )}
                            {cartPlateValidation.matched && (
                              <div style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
                                ✓ Table {cartPlateValidation.matched.table_number} matched
                              </div>
                            )}
                          </div>
                        )}

                        {/* Modifiers & Notes Badges */}
                        {(line.spiceLevel || line.notes || line.selectedModifiers.length > 0) && (
                          <div
                            style={{
                              background: 'rgba(0,0,0,0.25)',
                              padding: '6px 8px',
                              borderRadius: '6px',
                              fontSize: '0.74rem',
                              color: '#cbd5e1',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                            }}
                          >
                            {line.spiceLevel && <span>🌶️ Spice: {line.spiceLevel}</span>}
                            {line.notes && <span>📝 Note: {line.notes}</span>}
                            {line.selectedModifiers.map((m) => (
                              <span key={m.id} style={{ color: m.pricePaise > 0 ? '#fbbf24' : '#94a3b8' }}>
                                + {m.name} {m.pricePaise > 0 ? `(+₹${(m.pricePaise / 100).toFixed(0)})` : '(Included)'}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {/* Apply Coupon Input */}
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8', marginBottom: '4px' }}>
                      Have a coupon?
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="e.g. ROYAL15"
                        value={couponInput}
                        onChange={(e) => setCouponInput(e.target.value.toUpperCase())}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '0.85rem',
                          fontFamily: 'monospace',
                        }}
                      />
                      <button
                        onClick={() => handleApplyCoupon(couponInput)}
                        style={{
                          background: 'rgba(245,158,11,0.2)',
                          border: '1px solid var(--accent-gold)',
                          color: '#fbbf24',
                          padding: '0 14px',
                          borderRadius: '8px',
                          fontWeight: 700,
                          fontSize: '0.8rem',
                        }}
                      >
                        Apply
                      </button>
                    </div>
                    {appliedCoupon && (
                      <div style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '4px' }}>
                        ✓ Applied: {appliedCoupon} (-₹{(discountPaise / 100).toFixed(0)})
                      </div>
                    )}
                  </div>

                  {/* Bill Breakdown */}
                  <div
                    style={{
                      background: 'rgba(255,255,255,0.02)',
                      borderTop: '1px dashed rgba(255,255,255,0.12)',
                      paddingTop: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                      fontSize: '0.84rem',
                      color: '#94a3b8',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>Item Total</span>
                      <span style={{ color: '#fff' }}>₹{(cartSubtotalPaise / 100).toFixed(0)}</span>
                    </div>
                    {discountPaise > 0 && (
                      <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981' }}>
                        <span>Discount ({appliedCoupon})</span>
                        <span>-₹{(discountPaise / 100).toFixed(0)}</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>GST (5%)</span>
                      <span style={{ color: '#fff' }}>₹{(gstPaise / 100).toFixed(0)}</span>
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        fontSize: '1.05rem',
                        fontWeight: 800,
                        color: '#fbbf24',
                        borderTop: '1px solid rgba(255,255,255,0.1)',
                        paddingTop: '8px',
                        marginTop: '4px',
                      }}
                    >
                      <span>To Pay</span>
                      <span>₹{(cartGrandTotalPaise / 100).toFixed(0)}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {cartLines.length > 0 && (
              <div className="drawer-footer" style={{ padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                {(!isTableVerified || !activeSessionId) && (
                  <div
                    style={{
                      background: 'rgba(245, 158, 11, 0.09)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      borderRadius: '10px',
                      padding: '10px 12px',
                      marginBottom: '12px',
                    }}
                  >
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fbbf24', marginBottom: '6px' }}>
                      🪑 Enter Your Table Number to Checkout
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        placeholder="Digits only (e.g. 4)"
                        value={cartCheckoutTableDigits}
                        onChange={(e) => setCartCheckoutTableDigits(sanitizeTableDigits(e.target.value))}
                        style={{
                          flex: 1,
                          padding: '8px 10px',
                          borderRadius: '8px',
                          background: 'rgba(0, 0, 0, 0.35)',
                          border: cartCheckoutTableValidation.error
                            ? '1px solid #ef4444'
                            : '1px solid rgba(255,255,255,0.18)',
                          color: '#fff',
                          fontSize: '0.86rem',
                          fontWeight: 700,
                        }}
                      />
                      <button
                        type="button"
                        disabled={!cartCheckoutTableValidation.matched}
                        onClick={async () => {
                          const targetOutlet = activeOutletId || resolveTenantIds().outletId || undefined;
                          if (cartCheckoutTableValidation.matched) {
                            const session = await establishManualTableSession(
                              targetOutlet,
                              cartCheckoutTableValidation.matched.table_number,
                              tablePax,
                            );
                            if (session) {
                              setCartCheckoutTableDigits('');
                              showToast(`Saved Table ${session.tableNumber}!`);
                            }
                          }
                        }}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '8px',
                          border: 'none',
                          background: cartCheckoutTableValidation.matched
                            ? 'linear-gradient(135deg, #10b981, #059669)'
                            : 'rgba(255,255,255,0.08)',
                          color: cartCheckoutTableValidation.matched ? '#fff' : '#64748b',
                          fontWeight: 800,
                          fontSize: '0.76rem',
                          cursor: cartCheckoutTableValidation.matched ? 'pointer' : 'not-allowed',
                        }}
                      >
                        Save Table
                      </button>
                    </div>
                    {cartCheckoutTableValidation.error && (
                      <div style={{ fontSize: '0.73rem', color: '#f87171', fontWeight: 600, marginTop: '5px' }}>
                        {cartCheckoutTableValidation.error}
                      </div>
                    )}
                    {cartCheckoutTableValidation.matched && (
                      <div style={{ fontSize: '0.73rem', color: '#34d399', fontWeight: 600, marginTop: '5px' }}>
                        ✓ Found Table {cartCheckoutTableValidation.matched.table_number}
                      </div>
                    )}
                  </div>
                )}

                <button
                  className="accordion-add-action-btn"
                  onClick={handlePlaceOrder}
                  disabled={
                    isPlacingOrder ||
                    ((!isTableVerified || !activeSessionId) && !cartCheckoutTableValidation.matched)
                  }
                  style={{ width: '100%', margin: 0, padding: '12px 16px', fontSize: '0.92rem' }}
                >
                  {isPlacingOrder ? 'Initiating Payment...' : `💳 Pay ₹${(cartGrandTotalPaise / 100).toFixed(0)} & Send to Kitchen`}
                </button>
                <div style={{ textAlign: 'center', fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
                  🔒 Dishes stay in your cart until payment is confirmed.
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Orders History Drawer & Settlement */}
      {isOrdersHistoryOpen && (
        <div className="side-drawer-wrap" onClick={() => setIsOrdersHistoryOpen(false)}>
          <div className="side-drawer-panel" onClick={(e) => e.stopPropagation()}>
            {/* Drawer Header */}
            <div className="drawer-header" style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '1.3rem' }}>📋</span>
                <div>
                  <div className="drawer-title" style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff' }}>
                    Table {selectedTable} Paid Orders
                  </div>
                  <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                    {preparingPlates.length} preparing · {servedPlates.length} served · {cancelledPlates.length} cancelled
                    {flattenedPlates[0]?.orderCreatedAt && (
                      <span> · Latest: {formatOrderDateTime(flattenedPlates[0].orderCreatedAt)}</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsOrdersHistoryOpen(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: '#94a3b8',
                  fontSize: '1rem',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Filter Tabs: Preparing | Serve Later (On Hold) | Served | Cancelled */}
            <div
              style={{
                display: 'flex',
                gap: '6px',
                padding: '10px 14px',
                background: 'rgba(0, 0, 0, 0.25)',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                overflowX: 'auto',
              }}
            >
              <button
                type="button"
                onClick={() => setOrdersFilterTab('PREPARING')}
                style={{
                  flex: 1,
                  padding: '9px 6px',
                  borderRadius: '8px',
                  fontSize: '0.74rem',
                  fontWeight: ordersFilterTab === 'PREPARING' ? 800 : 600,
                  cursor: 'pointer',
                  background:
                    ordersFilterTab === 'PREPARING'
                      ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                      : 'rgba(255, 255, 255, 0.04)',
                  color: ordersFilterTab === 'PREPARING' ? '#000' : '#94a3b8',
                  border:
                    ordersFilterTab === 'PREPARING'
                      ? '1px solid #f59e0b'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>🍳 Preparing</span>
                <span
                  style={{
                    background: ordersFilterTab === 'PREPARING' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                    padding: '1px 5px',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                  }}
                >
                  {preparingPlates.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setOrdersFilterTab('ON_HOLD')}
                style={{
                  flex: 1,
                  padding: '9px 6px',
                  borderRadius: '8px',
                  fontSize: '0.74rem',
                  fontWeight: ordersFilterTab === 'ON_HOLD' ? 800 : 600,
                  cursor: 'pointer',
                  background:
                    ordersFilterTab === 'ON_HOLD'
                      ? 'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)'
                      : 'rgba(255, 255, 255, 0.04)',
                  color: ordersFilterTab === 'ON_HOLD' ? '#000' : '#94a3b8',
                  border:
                    ordersFilterTab === 'ON_HOLD'
                      ? '1px solid #06b6d4'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>🍨 Serve Later</span>
                <span
                  style={{
                    background: ordersFilterTab === 'ON_HOLD' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                    padding: '1px 5px',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                  }}
                >
                  {onHoldPlates.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setOrdersFilterTab('SERVED')}
                style={{
                  flex: 1,
                  padding: '9px 6px',
                  borderRadius: '8px',
                  fontSize: '0.74rem',
                  fontWeight: ordersFilterTab === 'SERVED' ? 800 : 600,
                  cursor: 'pointer',
                  background:
                    ordersFilterTab === 'SERVED'
                      ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                      : 'rgba(255, 255, 255, 0.04)',
                  color: ordersFilterTab === 'SERVED' ? '#fff' : '#94a3b8',
                  border:
                    ordersFilterTab === 'SERVED'
                      ? '1px solid #10b981'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>🍽️ Served</span>
                <span
                  style={{
                    background: ordersFilterTab === 'SERVED' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                    padding: '1px 5px',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                  }}
                >
                  {servedPlates.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setOrdersFilterTab('CANCELLED')}
                style={{
                  flex: 1,
                  padding: '9px 6px',
                  borderRadius: '8px',
                  fontSize: '0.74rem',
                  fontWeight: ordersFilterTab === 'CANCELLED' ? 800 : 600,
                  cursor: 'pointer',
                  background:
                    ordersFilterTab === 'CANCELLED'
                      ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                      : 'rgba(255, 255, 255, 0.04)',
                  color: ordersFilterTab === 'CANCELLED' ? '#fff' : '#94a3b8',
                  border:
                    ordersFilterTab === 'CANCELLED'
                      ? '1px solid #ef4444'
                      : '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  whiteSpace: 'nowrap',
                }}
              >
                <span>✕ Cancel</span>
                <span
                  style={{
                    background: ordersFilterTab === 'CANCELLED' ? 'rgba(0, 0, 0, 0.25)' : 'rgba(255, 255, 255, 0.1)',
                    padding: '1px 5px',
                    borderRadius: '999px',
                    fontSize: '0.7rem',
                    fontWeight: 800,
                  }}
                >
                  {cancelledPlates.length}
                </span>
              </button>
            </div>

            {/* Drawer Body: Plate-level breakdown */}
            <div className="drawer-body" style={{ padding: '16px' }}>
              {(() => {
                const displayPlates =
                  ordersFilterTab === 'PREPARING'
                    ? preparingPlates
                    : ordersFilterTab === 'ON_HOLD'
                    ? onHoldPlates
                    : ordersFilterTab === 'SERVED'
                    ? servedPlates
                    : cancelledPlates;

                if (flattenedPlates.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
                      <div style={{ fontSize: '3rem', marginBottom: '14px' }}>📋</div>
                      <h4 style={{ color: '#fff', marginBottom: '6px' }}>No paid orders yet</h4>
                      <p style={{ fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '16px' }}>
                        Dishes stay in your cart until paid. Once paid, track their cooking and delivery status here!
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsOrdersHistoryOpen(false);
                          if (cartLines.length > 0) setIsCartOpen(true);
                        }}
                        className="accordion-add-action-btn"
                        style={{ margin: '0 auto', fontSize: '0.82rem', padding: '8px 16px' }}
                      >
                        {cartLines.length > 0 ? `View Cart (${cartItemCount} Pending)` : 'Browse Menu & Order'}
                      </button>
                    </div>
                  );
                }

                if (displayPlates.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>
                        {ordersFilterTab === 'PREPARING' ? '🍳' : ordersFilterTab === 'ON_HOLD' ? '🍨' : ordersFilterTab === 'SERVED' ? '🍽️' : '✨'}
                      </div>
                      <h4 style={{ color: '#fff', marginBottom: '6px' }}>
                        {ordersFilterTab === 'PREPARING'
                          ? 'No dishes preparing'
                          : ordersFilterTab === 'ON_HOLD'
                          ? 'No items held for later'
                          : ordersFilterTab === 'SERVED'
                          ? 'No dishes served yet'
                          : 'No cancelled dishes'}
                      </h4>
                      <p style={{ fontSize: '0.82rem', marginBottom: '16px', lineHeight: 1.5 }}>
                        {ordersFilterTab === 'PREPARING'
                          ? 'All dishes placed at this table have either been served or completed.'
                          : ordersFilterTab === 'ON_HOLD'
                          ? 'Post-meal items like desserts and hot beverages will appear here once ordered. Release them to the kitchen whenever you are ready!'
                          : ordersFilterTab === 'SERVED'
                          ? 'The kitchen is preparing your dishes. Once served to your table, they will appear here!'
                          : 'None of your table orders have been cancelled.'}
                      </p>
                    </div>
                  );
                }

                const totalDisplayPaise = displayPlates.reduce((sum, p) => sum + p.plateTotalPaise, 0);
                const allExpanded = displayPlates.every((p) => expandedPlateKeys[p.plateKey]);

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {/* Sub-header controls: Count & Expand All */}
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        fontSize: '0.78rem',
                        color: '#94a3b8',
                        paddingBottom: '4px',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {ordersFilterTab === 'PREPARING' && '🍳 '}
                        {ordersFilterTab === 'ON_HOLD' && '🍨 '}
                        {ordersFilterTab === 'SERVED' && '🍽️ '}
                        {ordersFilterTab === 'CANCELLED' && '✕ '}
                        {displayPlates.length} {ordersFilterTab === 'ON_HOLD' ? 'item' : 'dish'}{displayPlates.length === 1 ? '' : 'es'} · Total ₹
                        {(totalDisplayPaise / 100).toFixed(0)}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleToggleExpandAllPlates(displayPlates)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#fbbf24',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                          textDecoration: 'underline',
                          padding: '2px 4px',
                        }}
                      >
                        {allExpanded ? 'Collapse All ▲' : 'Expand All ▼'}
                      </button>
                    </div>

                    {/* Plates List — special grouped render for Serve Later (ON_HOLD) tab */}
                    {ordersFilterTab === 'ON_HOLD' ? (() => {
                      // Group onHoldPlates by itemId to show one card per unique menu item
                      const groupedByItem: Record<string, FlattenedPlateItem[]> = {};
                      onHoldPlates.forEach((plate) => {
                        const existing = groupedByItem[plate.itemId];
                        if (!existing) {
                          groupedByItem[plate.itemId] = [plate];
                        } else {
                          existing.push(plate);
                        }
                      });

                      return Object.entries(groupedByItem).map(([itemId, itemPlates]) => {
                        const firstPlate = itemPlates[0];
                        if (!firstPlate) return null;
                        const totalQty = itemPlates.length;
                        const totalPaise = itemPlates.reduce((s, p) => s + p.plateTotalPaise, 0);
                        const allPlateKeys = itemPlates.map((p) => p.plateKey);

                        // Pick emoji based on item name
                        const name = firstPlate.itemName.toLowerCase();
                        const emoji =
                          name.includes('coffee') || name.includes('chai') || name.includes('tea')
                            ? '☕'
                            : name.includes('ice cream') || name.includes('kulfi')
                            ? '🍦'
                            : name.includes('gulab') || name.includes('rasgulla') || name.includes('halwa') || name.includes('sweet')
                            ? '🍮'
                            : '🍨';

                        return (
                          <div
                            key={itemId}
                            style={{
                              background: 'rgba(139, 92, 246, 0.07)',
                              border: '1.5px solid rgba(139, 92, 246, 0.35)',
                              borderRadius: '14px',
                              padding: '16px',
                              transition: 'all 0.2s ease',
                            }}
                          >
                            {/* Item header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span style={{ fontSize: '1.6rem' }}>{emoji}</span>
                                <div>
                                  <div style={{ fontWeight: 800, fontSize: '0.95rem', color: '#f8fafc' }}>
                                    {totalQty > 1 ? `${totalQty}× ` : ''}{firstPlate.itemName}
                                  </div>
                                  <div style={{ fontSize: '0.74rem', color: '#a78bfa', marginTop: '2px' }}>
                                    ⏳ Waiting for your signal — Chef will prepare fresh
                                  </div>
                                  <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}>
                                    🕒 {formatOrderDateTime(firstPlate.itemCreatedAt || firstPlate.orderCreatedAt)} · Order #{firstPlate.orderNumber}
                                  </div>
                                </div>
                              </div>
                              <span style={{ fontWeight: 800, color: '#a78bfa', fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                                ₹{(totalPaise / 100).toFixed(0)}
                              </span>
                            </div>

                            {/* Per-plate breakdown if multiple plates */}
                            {itemPlates.length > 1 && (
                              <div
                                style={{
                                  background: 'rgba(139, 92, 246, 0.06)',
                                  borderRadius: '8px',
                                  padding: '8px 10px',
                                  marginBottom: '12px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px',
                                }}
                              >
                                {itemPlates.map((plate, idx) => {
                                  const plateNote = plate.rawNotes || plate.kitchenNote;
                                  return (
                                    <div
                                      key={plate.plateKey}
                                      style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', gap: '8px' }}
                                    >
                                      <span style={{ color: '#c4b5fd' }}>
                                        Plate {idx + 1}
                                        {plate.portion === 'HALF' ? ' · Half Plate' : ''}
                                        {plateNote ? ` · Note: ${plateNote}` : ''}
                                        <span style={{ display: 'block', fontSize: '0.7rem', color: '#94a3b8' }}>
                                          🕒 {formatOrderDateTime(plate.itemCreatedAt || plate.orderCreatedAt)}
                                        </span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleReleaseHold([plate.plateKey], firstPlate.itemName)}
                                        style={{
                                          background: 'rgba(139, 92, 246, 0.2)',
                                          border: '1px solid rgba(139, 92, 246, 0.5)',
                                          borderRadius: '6px',
                                          color: '#c4b5fd',
                                          fontSize: '0.72rem',
                                          fontWeight: 700,
                                          padding: '3px 8px',
                                          cursor: 'pointer',
                                        }}
                                      >
                                        Bring This Plate →
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Primary CTA: Bring all plates of this item to kitchen now */}
                            <button
                              type="button"
                              onClick={() => handleReleaseHold(allPlateKeys, firstPlate.itemName)}
                              style={{
                                width: '100%',
                                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                                color: '#fff',
                                border: 'none',
                                borderRadius: '10px',
                                padding: '12px 16px',
                                fontWeight: 900,
                                fontSize: '0.9rem',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                boxShadow: '0 4px 14px rgba(109, 40, 217, 0.4)',
                              }}
                            >
                              <span>🍳 Send to Kitchen Now</span>
                              {totalQty > 1 && <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>({totalQty} plates)</span>}
                            </button>
                          </div>
                        );
                      });
                    })() : (
                    /* Standard Plates List for other tabs */
                    displayPlates.map((plate) => {
                      const isExpanded = Boolean(expandedPlateKeys[plate.plateKey]);

                      return (
                        <div
                          key={plate.plateKey}
                          style={{
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: isExpanded
                              ? '1px solid rgba(245, 158, 11, 0.4)'
                              : '1px solid rgba(255, 255, 255, 0.08)',
                            borderRadius: '12px',
                            padding: '14px',
                            transition: 'all 0.2s ease',
                            boxShadow: isExpanded ? '0 4px 16px rgba(0, 0, 0, 0.3)' : 'none',
                          }}
                        >
                          {/* Plate Header: Plate Label, Portion Pill, Status & Price */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '8px',
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                              <span
                                style={{
                                  background:
                                    'linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(217, 119, 6, 0.18) 100%)',
                                  border: '1px solid rgba(245, 158, 11, 0.45)',
                                  color: '#fbbf24',
                                  fontSize: '0.76rem',
                                  fontWeight: 800,
                                  padding: '2px 8px',
                                  borderRadius: '9999px',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                }}
                              >
                                🍽️ {plate.plateName}
                              </span>
                              {plate.portion === 'HALF' && (
                                <span
                                  style={{
                                    background: 'rgba(59, 130, 246, 0.15)',
                                    border: '1px solid rgba(59, 130, 246, 0.35)',
                                    color: '#60a5fa',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '9999px',
                                  }}
                                >
                                  Half Plate
                                </span>
                              )}
                              {plate.spiceLevel && (
                                <span
                                  style={{
                                    background: 'rgba(239, 68, 68, 0.12)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    color: '#f87171',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '9999px',
                                  }}
                                >
                                  {plate.spiceLevel === 'HOT'
                                    ? '🌶️ Hot'
                                    : plate.spiceLevel === 'MEDIUM'
                                    ? '🌶️ Medium'
                                    : 'Mild'}
                                </span>
                              )}
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                className={`status-badge ${
                                  plate.orderStatus === 'CANCELLED'
                                    ? 'cancelled'
                                    : plate.orderStatus === 'SERVED' || plate.orderStatus === 'BILLED'
                                    ? 'served'
                                    : 'cooking'
                                }`}
                                style={
                                  plate.orderStatus === 'CANCELLED'
                                    ? {
                                        background: 'rgba(239, 68, 68, 0.15)',
                                        color: '#f87171',
                                        border: '1px solid rgba(239, 68, 68, 0.3)',
                                      }
                                    : plate.orderStatus === 'SERVED' || plate.orderStatus === 'BILLED'
                                    ? {
                                        background: 'rgba(16, 185, 129, 0.15)',
                                        color: '#10b981',
                                        border: '1px solid rgba(16, 185, 129, 0.3)',
                                      }
                                    : {
                                        background: 'rgba(245, 158, 11, 0.15)',
                                        color: '#fbbf24',
                                        border: '1px solid rgba(245, 158, 11, 0.3)',
                                      }
                                }
                              >
                                {plate.orderStatus === 'CANCELLED'
                                  ? 'CANCELLED ✕'
                                  : plate.orderStatus === 'SERVED' || plate.orderStatus === 'BILLED'
                                  ? 'SERVED 🍽️'
                                  : 'PREPARING 🍳'}
                              </span>
                              <span style={{ fontWeight: 800, color: '#fbbf24', fontSize: '0.92rem' }}>
                                ₹{(plate.plateTotalPaise / 100).toFixed(0)}
                              </span>
                            </div>
                          </div>

                          {/* Clickable Item Name with Expand/Collapse Action */}
                          <div
                            onClick={() => togglePlateExpanded(plate.plateKey)}
                            style={{
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '6px 0',
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                togglePlateExpanded(plate.plateKey);
                              }
                            }}
                          >
                            <span
                              style={{
                                fontWeight: 700,
                                fontSize: '0.94rem',
                                color: '#f8fafc',
                                textDecoration: isExpanded ? 'none' : 'underline',
                                textDecorationColor: '#f59e0b',
                                textUnderlineOffset: '3px',
                              }}
                            >
                              {plate.itemName}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                togglePlateExpanded(plate.plateKey);
                              }}
                              style={{
                                background: isExpanded ? 'rgba(245, 158, 11, 0.2)' : 'rgba(255, 255, 255, 0.06)',
                                border: isExpanded ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.12)',
                                borderRadius: '6px',
                                color: isExpanded ? '#fbbf24' : '#94a3b8',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                                padding: '3px 8px',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                cursor: 'pointer',
                              }}
                            >
                              {isExpanded ? '▲ Hide Details' : '▼ Details'}
                            </button>
                          </div>

                          {/* Order & Item Date/Time + Per-Plate Table */}
                          <div
                            style={{
                              fontSize: '0.72rem',
                              color: '#94a3b8',
                              marginTop: '2px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '6px',
                              flexWrap: 'wrap',
                            }}
                          >
                            <span>🕒 {formatOrderDateTime(plate.itemCreatedAt || plate.orderCreatedAt)}</span>
                            <span>·</span>
                            <span>Order #{plate.orderNumber}</span>
                            <span>·</span>
                            <span
                              style={{
                                color: '#fbbf24',
                                fontWeight: 700,
                                background: 'rgba(245, 158, 11, 0.12)',
                                border: '1px solid rgba(245, 158, 11, 0.28)',
                                borderRadius: '999px',
                                padding: '1px 7px',
                              }}
                            >
                              🪑 Table {plate.tableNumber}
                            </span>
                            {plate.orderStatus !== 'CANCELLED' && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (editingOrderPlateKey === plate.plateKey) {
                                    setEditingOrderPlateKey(null);
                                    setEditingOrderPlateDigits('');
                                  } else {
                                    setEditingOrderPlateKey(plate.plateKey);
                                    setEditingOrderPlateDigits(sanitizeTableDigits(plate.tableNumber));
                                  }
                                }}
                                style={{
                                  background: 'rgba(255,255,255,0.06)',
                                  border: '1px solid rgba(255,255,255,0.16)',
                                  borderRadius: '999px',
                                  color: '#e2e8f0',
                                  fontSize: '0.68rem',
                                  fontWeight: 700,
                                  padding: '1px 7px',
                                  cursor: 'pointer',
                                }}
                              >
                                Move Table
                              </button>
                            )}
                          </div>

                          {editingOrderPlateKey === plate.plateKey && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                marginTop: '6px',
                                padding: '8px 10px',
                                borderRadius: '8px',
                                background: 'rgba(15, 23, 42, 0.9)',
                                border: '1px solid rgba(245, 158, 11, 0.35)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="Table #"
                                  value={editingOrderPlateDigits}
                                  onChange={(e) => setEditingOrderPlateDigits(sanitizeTableDigits(e.target.value))}
                                  style={{
                                    width: '88px',
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    background: 'rgba(255,255,255,0.08)',
                                    border: orderPlateValidation.error
                                      ? '1px solid #ef4444'
                                      : '1px solid rgba(255,255,255,0.18)',
                                    color: '#fff',
                                    fontSize: '0.8rem',
                                    fontWeight: 700,
                                  }}
                                />
                                <button
                                  type="button"
                                  disabled={!orderPlateValidation.matched || editingOrderPlateLoading}
                                  onClick={() => {
                                    if (orderPlateValidation.matched) {
                                      void handleMoveOrderPlateTable(plate, orderPlateValidation.matched);
                                    }
                                  }}
                                  style={{
                                    padding: '5px 10px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: orderPlateValidation.matched
                                      ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                      : 'rgba(255,255,255,0.08)',
                                    color: orderPlateValidation.matched ? '#000' : '#64748b',
                                    fontSize: '0.74rem',
                                    fontWeight: 800,
                                    cursor: orderPlateValidation.matched ? 'pointer' : 'not-allowed',
                                  }}
                                >
                                  {editingOrderPlateLoading ? 'Saving...' : 'Confirm'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingOrderPlateKey(null);
                                    setEditingOrderPlateDigits('');
                                  }}
                                  style={{
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    background: 'transparent',
                                    border: '1px solid rgba(255,255,255,0.14)',
                                    color: '#94a3b8',
                                    fontSize: '0.72rem',
                                    cursor: 'pointer',
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                              {orderPlateValidation.error && (
                                <div style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>
                                  {orderPlateValidation.error}
                                </div>
                              )}
                              {orderPlateValidation.matched && (
                                <div style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
                                  ✓ Moving plate to Table {orderPlateValidation.matched.table_number}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Collapsed Preview Hint */}
                          {!isExpanded && (
                            <div
                              onClick={() => togglePlateExpanded(plate.plateKey)}
                              style={{
                                fontSize: '0.75rem',
                                color: '#94a3b8',
                                marginTop: '4px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                flexWrap: 'wrap',
                              }}
                            >
                              {plate.kitchenNote ? (
                                <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>
                                  👨‍🍳 &ldquo;{plate.kitchenNote}&rdquo;
                                </span>
                              ) : plate.modifiers.length > 0 ? (
                                <span style={{ color: '#93c5fd' }}>
                                  {plate.modifiers.length} customisation{plate.modifiers.length > 1 ? 's' : ''} added
                                </span>
                              ) : (
                                <span style={{ color: '#64748b' }}>Standard preparation · Tap to view breakdown</span>
                              )}
                            </div>
                          )}

                          {/* Expanded Card: Kitchen Note & Price Breakdown */}
                          {isExpanded && (
                            <div
                              style={{
                                marginTop: '12px',
                                paddingTop: '12px',
                                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '10px',
                                animation: 'fadeIn 0.2s ease',
                              }}
                            >
                              {/* 1. Note to the Kitchen */}
                              <div
                                style={{
                                  background: 'rgba(245, 158, 11, 0.08)',
                                  border: '1px solid rgba(245, 158, 11, 0.25)',
                                  borderRadius: '8px',
                                  padding: '10px 12px',
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                                  <span style={{ fontSize: '0.9rem' }}>👨‍🍳</span>
                                  <span
                                    style={{
                                      fontSize: '0.74rem',
                                      fontWeight: 800,
                                      color: '#fbbf24',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.04em',
                                    }}
                                  >
                                    Note to the Kitchen
                                  </span>
                                </div>
                                <p style={{ margin: 0, fontSize: '0.84rem', color: '#f1f5f9', fontStyle: 'italic' }}>
                                  &ldquo;
                                  {plate.kitchenNote || 'Standard chef preparation · No special instructions'}
                                  &rdquo;
                                </p>
                              </div>

                              {/* 2. Customisations & Price Breakdown */}
                              <div
                                style={{
                                  background: 'rgba(0, 0, 0, 0.3)',
                                  border: '1px solid rgba(255, 255, 255, 0.08)',
                                  borderRadius: '8px',
                                  padding: '10px 12px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '6px',
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: '0.74rem',
                                    fontWeight: 800,
                                    color: '#94a3b8',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.04em',
                                  }}
                                >
                                  Customisations & Price Breakdown
                                </div>

                                {/* Base Price */}
                                <div
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: '0.82rem',
                                    color: '#cbd5e1',
                                  }}
                                >
                                  <span>
                                    {plate.portion === 'HALF' ? 'Half Plate Base Price' : 'Base Dish Price'}
                                  </span>
                                  <span style={{ fontWeight: 600 }}>₹{(plate.basePricePaise / 100).toFixed(0)}</span>
                                </div>

                                {/* Modifiers */}
                                {plate.modifiers.length > 0 ? (
                                  plate.modifiers.map((mod, mIdx) => (
                                    <div
                                      key={mIdx}
                                      style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        fontSize: '0.82rem',
                                        color: '#93c5fd',
                                      }}
                                    >
                                      <span>+ {mod.name}</span>
                                      <span style={{ fontWeight: 600 }}>
                                        {mod.price_paise > 0
                                          ? `+₹${(mod.price_paise / 100).toFixed(0)}`
                                          : 'Included'}
                                      </span>
                                    </div>
                                  ))
                                ) : (
                                  <div style={{ fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic' }}>
                                    No extra add-ons selected
                                  </div>
                                )}

                                {/* Spice level */}
                                {plate.spiceLevel && (
                                  <div
                                    style={{
                                      display: 'flex',
                                      justifyContent: 'space-between',
                                      fontSize: '0.82rem',
                                      color: '#f87171',
                                    }}
                                  >
                                    <span>
                                      Spice Preference (
                                      {plate.spiceLevel}{' '}
                                      {plate.spiceLevel === 'HOT'
                                        ? '🌶️🌶️🌶️'
                                        : plate.spiceLevel === 'MEDIUM'
                                        ? '🌶️🌶️'
                                        : '🌶️'}
                                      )
                                    </span>
                                    <span style={{ fontWeight: 600, color: '#94a3b8' }}>Included (+₹0)</span>
                                  </div>
                                )}

                                {/* Total for this plate */}
                                <div
                                  style={{
                                    borderTop: '1px dashed rgba(255, 255, 255, 0.12)',
                                    paddingTop: '6px',
                                    marginTop: '3px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: '0.86rem',
                                    fontWeight: 800,
                                    color: '#fbbf24',
                                  }}
                                >
                                  <span>Plate Total</span>
                                  <span>₹{(plate.plateTotalPaise / 100).toFixed(0)}</span>
                                </div>
                              </div>

                              {/* 3. Order & Payment Metadata */}
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  fontSize: '0.74rem',
                                  color: '#64748b',
                                  padding: '2px 4px',
                                }}
                              >
                                <span>
                                  Order #{plate.orderNumber} · Table {plate.tableNumber} · {formatOrderDateTime(plate.orderCreatedAt)}
                                </span>
                                <span style={{ color: '#10b981', fontWeight: 700 }}>
                                  Paid via {plate.paymentMethod || 'UPI'} ✅
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    }))
                    }
                  </div>
                );
              })()}
            </div>

            {/* Drawer Footer */}
            {flattenedPlates.length > 0 && (
              <div className="drawer-footer" style={{ padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    className="accordion-add-action-btn"
                    onClick={() => setIsOrdersHistoryOpen(false)}
                    style={{ width: '100%', margin: 0 }}
                  >
                    🍽️ Order More Dishes
                  </button>
                  <div style={{ textAlign: 'center', fontSize: '0.74rem', color: '#64748b' }}>
                    ✅ All dishes above are paid & tracked in kitchen. Need assistance? Tap &ldquo;Call Waiter&rdquo;.
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Settlement Modal */}
      {isPaymentModalOpen && (
        <div
          className="filter-sheet-overlay"
          onClick={() => {
            setIsPaymentModalOpen(false);
            if (cartLines.length > 0) setIsCartOpen(true);
          }}
        >
          <div className="modal-center-card" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff' }}>Settle Table Bill</h3>
              <button
                onClick={() => {
                  setIsPaymentModalOpen(false);
                  if (cartLines.length > 0) {
                    setIsCartOpen(true);
                    showToast('Payment postponed. All items saved in your cart.');
                  }
                }}
                style={{ color: '#94a3b8', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            {paymentSuccessData ? (
              <div style={{ textAlign: 'center', padding: '20px 10px' }}>
                <div style={{ fontSize: '3rem', marginBottom: '10px' }}>✅</div>
                <h3 style={{ color: '#10b981', marginBottom: '6px' }}>Payment Complete!</h3>
                <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px' }}>
                  Bill of ₹{(paymentSuccessData.totalPaise / 100).toFixed(0)} paid. Receipt sent. Thank you!
                </p>
                <button
                  className="filter-apply-btn"
                  onClick={() => {
                    setPaymentSuccessData(null);
                    setIsPaymentModalOpen(false);
                  }}
                  style={{ width: '100%' }}
                >
                  Done
                </button>
              </div>
            ) : paymentQrData ? (
              <div style={{ textAlign: 'center', padding: '10px' }}>
                {paymentQrData.redirectUrl ? (
                  <div style={{ marginBottom: '16px' }}>
                    <div
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        background: 'rgba(95, 37, 159, 0.25)',
                        border: '1px solid rgba(147, 51, 234, 0.45)',
                        padding: '4px 12px',
                        borderRadius: '999px',
                        color: '#c084fc',
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        marginBottom: '12px',
                      }}
                    >
                      <span>⚡</span>
                      <span>PhonePe Sandbox (UAT) Gateway</span>
                    </div>
                    <p style={{ fontSize: '0.84rem', color: '#e2e8f0', lineHeight: 1.4, marginBottom: '14px' }}>
                      Click below to open the official PhonePe Sandbox checkout link and complete test payment:
                    </p>
                    <a
                      href={paymentQrData.redirectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hero-action-btn"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        width: '100%',
                        padding: '12px 16px',
                        borderRadius: '10px',
                        background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.92rem',
                        textDecoration: 'none',
                        boxShadow: '0 4px 16px rgba(124, 58, 237, 0.4)',
                        marginBottom: '10px',
                      }}
                    >
                      <span>🚀 Open PhonePe Checkout ↗</span>
                    </a>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '12px' }}>
                    Scan UPI QR using Google Pay, PhonePe, or Paytm
                  </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button
                    className="accordion-add-action-btn"
                    onClick={async () => {
                      if (!paymentQrData?.paymentId) return;
                      setPaymentLoading(true);
                      try {
                        const vRes = await customerApiFetch(
                          `/api/v1/customer/payments/${encodeURIComponent(paymentQrData.paymentId)}/verify`,
                          undefined,
                          { preferToken: 'guest' },
                        );
                        if (vRes.ok) {
                          const vData = await vRes.json();
                          if (vData.status === 'PAID') {
                            await handleConfirmUpiPayment();
                            return;
                          } else {
                            showToast(`Payment status is ${vData.status || 'PENDING'}. Please complete payment on PhonePe.`);
                            return;
                          }
                        } else {
                          showToast('Could not verify status yet. Your cart items are completely safe!');
                        }
                      } catch {
                        showToast('Status check pending. If cancelled, your cart is preserved.');
                      } finally {
                        setPaymentLoading(false);
                      }
                    }}
                    disabled={paymentLoading}
                    style={{ width: '100%' }}
                  >
                    {paymentLoading ? 'Verifying with PhonePe...' : '✓ Verify PhonePe Payment'}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsPaymentModalOpen(false);
                      setIsCartOpen(true);
                      showToast('Payment cancelled. All items remain in your cart — tap below to retry!');
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 14px',
                      borderRadius: '8px',
                      background: 'transparent',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      color: '#94a3b8',
                      fontSize: '0.84rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    ✕ Cancel & Return to Cart
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div
                  className={`payment-option-card ${selectedPaymentMethod === 'UPI' ? 'selected' : ''}`}
                  onClick={() => setSelectedPaymentMethod('UPI')}
                >
                  <span style={{ fontSize: '1.4rem' }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>Instant UPI QR</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>GPay, PhonePe, Paytm, BHIM</div>
                  </div>
                </div>

                <div
                  className={`payment-option-card ${selectedPaymentMethod === 'CASH' ? 'selected' : ''}`}
                  onClick={() => setSelectedPaymentMethod('CASH')}
                >
                  <span style={{ fontSize: '1.4rem' }}>💵</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>Pay Cash at Counter</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Staff will collect cash at table</div>
                  </div>
                </div>

                <button
                  className="accordion-add-action-btn"
                  onClick={handleInitiatePayment}
                  disabled={paymentLoading}
                  style={{ width: '100%', marginTop: '8px' }}
                >
                  {paymentLoading ? 'Processing...' : 'Proceed to Pay'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Top-Quarter Table Number Slide-Down Drawer */}
      {isTableModalOpen && (
        <div
          className={`top-table-overlay ${isTopTableClosing ? 'closing' : ''}`}
          onClick={closeTopTableDrawer}
        >
          <div
            className={`top-table-sheet ${isTopTableClosing ? 'closing-to-badge' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  🪑 Select Your Table Number
                </h3>
                <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '3px 0 0' }}>
                  {isTableVerified
                    ? `Currently seated at Table ${selectedTable}. Type a new table number below or tap outside to close.`
                    : 'Enter the numeric table number printed on your table (digits only).'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeTopTableDrawer}
                style={{ color: '#94a3b8', fontSize: '1.1rem', padding: '4px 8px', cursor: 'pointer' }}
                aria-label="Close table drawer"
              >
                ✕
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!topTableValidation.matched || tableSubmitLoading) return;
                const targetOutlet = activeOutletId || resolveTenantIds(loadGuestSession()).outletId || undefined;
                setTableSubmitLoading(true);
                try {
                  const session = await establishManualTableSession(
                    targetOutlet,
                    topTableValidation.matched.table_number,
                    tablePax,
                  );
                  if (session) {
                    setTableNumberInput('');
                    closeTopTableDrawer();
                    showToast(`Table ${session.tableNumber} confirmed!`);
                  }
                } finally {
                  setTableSubmitLoading(false);
                }
              }}
              style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
            >
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoFocus
                  placeholder="Enter table digits (e.g. 4)"
                  value={tableNumberInput}
                  onChange={(e) => setTableNumberInput(sanitizeTableDigits(e.target.value))}
                  style={{
                    flex: 1,
                    padding: '11px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.07)',
                    border: topTableValidation.error
                      ? '1.5px solid #ef4444'
                      : topTableValidation.matched
                      ? '1.5px solid #10b981'
                      : '1px solid rgba(255, 255, 255, 0.16)',
                    color: '#fff',
                    fontSize: '1rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                />
                <button
                  type="submit"
                  className="accordion-add-action-btn"
                  disabled={!topTableValidation.matched || tableSubmitLoading}
                  style={{
                    width: 'auto',
                    minWidth: '116px',
                    margin: 0,
                    padding: '11px 16px',
                    opacity: !topTableValidation.matched || tableSubmitLoading ? 0.45 : 1,
                    cursor: !topTableValidation.matched || tableSubmitLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {tableSubmitLoading ? 'Saving...' : 'Confirm ✓'}
                </button>
              </div>

              {topTableValidation.error && (
                <div style={{ color: '#f87171', fontSize: '0.79rem', fontWeight: 600 }}>
                  ⚠️ {topTableValidation.error}
                </div>
              )}

              {topTableValidation.matched && (
                <div style={{ color: '#34d399', fontSize: '0.79rem', fontWeight: 600 }}>
                  ✓ Verified hotel table: Table {topTableValidation.matched.table_number}
                  {topTableValidation.matched.section ? ` (${topTableValidation.matched.section})` : ''}
                </div>
              )}

              {!outletTablesLoaded && (
                <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>
                  Loading hotel tables...
                </div>
              )}

              {outletTablesLoaded && outletTables.length === 0 && (
                <div style={{ color: '#fbbf24', fontSize: '0.75rem' }}>
                  Tap your table&apos;s NFC tag / QR code, or open with <code>?outlet=&lt;id&gt;</code>, to load hotel tables.
                </div>
              )}
            </form>

            <details style={{ marginTop: '10px', fontSize: '0.75rem', color: '#94a3b8' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Or paste a signed QR token / link</summary>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const raw = manualQrInput.trim();
                  if (!raw) return;
                  let parsedToken = raw;
                  if (raw.includes('?')) {
                    try {
                      const url = raw.startsWith('http') ? new URL(raw) : new URL(raw, window.location.origin);
                      const extracted = buildSignedQrTokenFromSearch(url.searchParams);
                      if (extracted) parsedToken = extracted;
                    } catch {
                      // keep raw
                    }
                  }
                  const session = await establishSignedTableSession(parsedToken, tablePax);
                  if (session) {
                    setManualQrInput('');
                    closeTopTableDrawer();
                    showToast(`Verified Table ${session.tableNumber || 'session'}!`);
                  }
                }}
                style={{ display: 'flex', gap: '8px', marginTop: '8px' }}
              >
                <input
                  type="text"
                  placeholder="Paste signed QR link or token"
                  value={manualQrInput}
                  onChange={(e) => setManualQrInput(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: '#fff',
                    fontSize: '0.78rem',
                  }}
                />
                <button
                  type="submit"
                  className="filter-clear-btn"
                  style={{ padding: '7px 12px', fontSize: '0.76rem' }}
                >
                  Verify QR
                </button>
              </form>
            </details>

            {isTableVerified && (
              <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    clearGuestSession();
                    setIsTableVerified(false);
                    setActiveSessionId('');
                    setActiveTableId('');
                    setSelectedTable('--');
                    setTableNumberInput('');
                    closeTopTableDrawer();
                  }}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#f87171',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Clear Current Table Session
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom Slide-Up Auth Sheet (Sign In / Sign Up with WhatsApp OTP + Google) */}
      {isAuthModalOpen && (
        <div
          className={`bottom-auth-overlay ${isAuthClosing ? 'closing' : ''}`}
          onClick={closeBottomAuthSheet}
        >
          <div
            className={`bottom-auth-sheet ${isAuthClosing ? 'closing' : ''}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <div>
                <h3 style={{ fontSize: '1.12rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  {authStep === 'OTP'
                    ? 'Verify WhatsApp OTP'
                    : authMode === 'SIGNUP'
                    ? 'Create Dining Account'
                    : 'Sign In to Dining Account'}
                </h3>
                <span style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
                  💬 Mobile number verified via WhatsApp OTP · Session saved on device
                </span>
              </div>
              <button
                type="button"
                onClick={closeBottomAuthSheet}
                style={{ color: '#94a3b8', fontSize: '1.15rem', padding: '4px 8px', cursor: 'pointer' }}
                aria-label="Close authentication drawer"
              >
                ✕
              </button>
            </div>

            {authStep === 'PHONE' && (
              <>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '6px',
                    background: 'rgba(255,255,255,0.04)',
                    padding: '4px',
                    borderRadius: '10px',
                    marginBottom: '14px',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('SIGNIN');
                      setAuthError('');
                      setAuthEmailLocked(false);
                      setGooglePreRegToken(null);
                    }}
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      border: 'none',
                      background: authMode === 'SIGNIN' ? 'rgba(245, 158, 11, 0.22)' : 'transparent',
                      color: authMode === 'SIGNIN' ? '#fbbf24' : '#94a3b8',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Sign In
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMode('SIGNUP');
                      setAuthError('');
                    }}
                    style={{
                      padding: '8px',
                      borderRadius: '8px',
                      border: 'none',
                      background: authMode === 'SIGNUP' ? 'rgba(245, 158, 11, 0.22)' : 'transparent',
                      color: authMode === 'SIGNUP' ? '#fbbf24' : '#94a3b8',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    Sign Up (New)
                  </button>
                </div>

                <form onSubmit={handleRequestOtp} style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '5px' }}>
                      Mobile Number (Primary ID)
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span
                        style={{
                          padding: '10px 12px',
                          background: 'rgba(255,255,255,0.06)',
                          borderRadius: '8px',
                          color: '#94a3b8',
                          fontSize: '0.88rem',
                        }}
                      >
                        +91
                      </span>
                      <input
                        type="tel"
                        inputMode="numeric"
                        placeholder="9876543210"
                        value={customerPhoneInput}
                        onChange={(e) => setCustomerPhoneInput(e.target.value.replace(/[^\d+]/g, ''))}
                        style={{
                          flex: 1,
                          padding: '10px 14px',
                          background: 'rgba(255,255,255,0.06)',
                          border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '0.92rem',
                        }}
                      />
                    </div>
                  </div>

                  {authMode === 'SIGNUP' && (
                    <>
                      <div>
                        <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '5px' }}>
                          Email ID (1 email per mobile number){authEmailLocked ? ' · Verified via Google' : ''}
                        </label>
                        <input
                          type="email"
                          required
                          readOnly={authEmailLocked}
                          placeholder="you@example.com"
                          value={authEmailInput}
                          onChange={(e) => setAuthEmailInput(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px 14px',
                            background: authEmailLocked ? 'rgba(16, 185, 129, 0.08)' : 'rgba(255,255,255,0.06)',
                            border: authEmailLocked
                              ? '1px solid rgba(16, 185, 129, 0.45)'
                              : '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '0.9rem',
                          }}
                        />
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.76rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '5px' }}>
                          Full Name (Optional)
                        </label>
                        <input
                          type="text"
                          placeholder="Your name"
                          value={authDisplayNameInput}
                          onChange={(e) => setAuthDisplayNameInput(e.target.value)}
                          style={{
                            width: '100%',
                            padding: '10px 14px',
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: '8px',
                            color: '#fff',
                            fontSize: '0.9rem',
                          }}
                        />
                      </div>
                    </>
                  )}

                  {authError && <div style={{ color: '#f87171', fontSize: '0.79rem', fontWeight: 600 }}>{authError}</div>}

                  <button className="accordion-add-action-btn" type="submit" disabled={authLoading} style={{ marginTop: '2px' }}>
                    {authLoading
                      ? 'Sending WhatsApp OTP...'
                      : authMode === 'SIGNUP'
                      ? 'Verify Mobile via WhatsApp OTP & Sign Up 📲'
                      : 'Send WhatsApp OTP Code 📲'}
                  </button>
                </form>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '14px 0' }}>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                  <span style={{ fontSize: '0.74rem', color: '#64748b', fontWeight: 700 }}>OR</span>
                  <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
                </div>

                <button
                  type="button"
                  onClick={handleGoogleLoginClick}
                  disabled={authLoading}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: '#fff',
                    color: '#111827',
                    border: 'none',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                  }}
                >
                  <span>G</span>
                  <span>Continue with Google</span>
                </button>

                {showDevGooglePicker && (
                  <div
                    style={{
                      marginTop: '10px',
                      padding: '12px',
                      borderRadius: '10px',
                      background: 'rgba(255,255,255,0.04)',
                      border: '1px dashed rgba(245, 158, 11, 0.4)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px',
                    }}
                  >
                    <div style={{ fontSize: '0.74rem', color: '#fbbf24', fontWeight: 700 }}>
                      Dev Google Sign-In Picker (NEXT_PUBLIC_GOOGLE_CLIENT_ID unset)
                    </div>
                    <input
                      type="email"
                      placeholder="Google email (e.g. diner@gmail.com)"
                      value={devGoogleEmailInput}
                      onChange={(e) => setDevGoogleEmailInput(e.target.value)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: 'rgba(0,0,0,0.35)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: '0.82rem',
                      }}
                    />
                    <input
                      type="text"
                      placeholder="Display name (optional)"
                      value={devGoogleNameInput}
                      onChange={(e) => setDevGoogleNameInput(e.target.value)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: 'rgba(0,0,0,0.35)',
                        border: '1px solid rgba(255,255,255,0.15)',
                        color: '#fff',
                        fontSize: '0.82rem',
                      }}
                    />
                    <button
                      type="button"
                      disabled={!devGoogleEmailInput.trim() || authLoading}
                      onClick={() =>
                        void submitGoogleAuthPayload({
                          devMockEmail: devGoogleEmailInput.trim(),
                          ...(devGoogleNameInput.trim() ? { devMockName: devGoogleNameInput.trim() } : {}),
                        })
                      }
                      className="accordion-add-action-btn"
                      style={{ width: '100%', padding: '8px 12px', fontSize: '0.8rem' }}
                    >
                      Continue with this Google Email
                    </button>
                  </div>
                )}
              </>
            )}

            {authStep === 'OTP' && (
              <form onSubmit={handleVerifyOtp} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {authDevCode && (
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.18) 0%, rgba(217, 119, 6, 0.12) 100%)',
                      border: '1.5px solid rgba(245, 158, 11, 0.45)',
                      padding: '12px 14px',
                      borderRadius: '10px',
                      textAlign: 'center',
                    }}
                  >
                    <div style={{ fontSize: '0.74rem', color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 800, marginBottom: '2px' }}>
                      Dev Preview OTP Code:
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 900, color: '#fbbf24', letterSpacing: '0.25em', margin: '2px 0' }}>
                      {authDevCode}
                    </div>
                  </div>
                )}

                <p style={{ fontSize: '0.82rem', color: '#cbd5e1', margin: 0 }}>
                  Enter the 6-digit code sent via{' '}
                  <strong style={{ color: '#34d399' }}>{authChannelLabel || 'WhatsApp'}</strong> to{' '}
                  <strong>{formatNormalizedPhone(customerPhoneInput)}</strong>
                  {authMode === 'SIGNUP' && authEmailInput ? ` (linking ${authEmailInput.trim()})` : ''}:
                </p>

                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="6-digit OTP"
                  value={customerOtpInput}
                  onChange={(e) => setCustomerOtpInput(e.target.value.replace(/\D/g, ''))}
                  style={{
                    padding: '10px 14px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '8px',
                    color: '#fff',
                    fontSize: '1.2rem',
                    textAlign: 'center',
                    letterSpacing: '0.2em',
                  }}
                />

                {authError && <div style={{ color: '#f87171', fontSize: '0.79rem', fontWeight: 600 }}>{authError}</div>}

                <button className="accordion-add-action-btn" type="submit" disabled={authLoading}>
                  {authLoading ? 'Verifying...' : authMode === 'SIGNUP' ? 'Verify & Complete Sign Up ✓' : 'Verify & Sign In ✓'}
                </button>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthStep('PHONE');
                      setAuthDevCode(null);
                      setCustomerOtpInput('');
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      fontSize: '0.74rem',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    ← Back / Change number
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Customer Profile Drawer */}
      {isProfileOpen && (
        <div className="side-drawer-wrap" onClick={() => setIsProfileOpen(false)}>
          <div className="side-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-header">
              <span className="drawer-title">My Dining Account</span>
              <button onClick={() => setIsProfileOpen(false)} style={{ color: '#94a3b8', fontSize: '1.2rem' }}>
                ✕
              </button>
            </div>

            <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              {customerToken ? (
                <>
                  {/* Authenticated Customer Card */}
                  <div
                    style={{
                      background: 'linear-gradient(135deg, rgba(245,158,11,0.15), rgba(217,119,6,0.25))',
                      border: '1px solid rgba(245,158,11,0.4)',
                      borderRadius: '16px',
                      padding: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '14px',
                    }}
                  >
                    <div
                      style={{
                        width: '50px',
                        height: '50px',
                        borderRadius: '50%',
                        background: 'var(--accent-gold)',
                        color: '#000',
                        fontSize: '1.2rem',
                        fontWeight: 800,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {customerProfile?.displayName ? customerProfile.displayName.slice(0, 2).toUpperCase() : '👤'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 800, color: '#fff', fontSize: '1.1rem' }}>
                        {customerProfile?.displayName || 'Name Not Set'}
                      </div>
                      <div style={{ fontSize: '0.78rem', color: customerProfile?.displayName ? '#fbbf24' : '#94a3b8', fontWeight: 600 }}>
                        {customerProfile?.displayName ? `⭐ ${customerProfile.loyaltyTier || 'Member'}` : '👉 Please type your name below'}
                      </div>
                      {customerProfile?.phone && (
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                          📱 {customerProfile.phone}
                        </div>
                      )}
                      {customerProfile?.email && (
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                          ✉️ {customerProfile.email}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Loyalty Balance */}
                  <div
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      padding: '14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '0.78rem', color: '#94a3b8' }}>DineFlow Loyalty Balance</div>
                      <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#fbbf24' }}>
                        {customerProfile?.loyaltyPoints ?? 0} Points
                      </div>
                    </div>
                    <span style={{ fontSize: '1.8rem' }}>🎁</span>
                  </div>

                  {/* Edit Display Name */}
                  <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '12px', padding: '14px' }}>
                    <label style={{ fontSize: '0.8rem', color: '#fbbf24', fontWeight: 700, display: 'block', marginBottom: '6px' }}>
                      Your Full Name
                    </label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        type="text"
                        placeholder="Enter your name to save in database"
                        value={editDisplayName}
                        onChange={(e) => setEditDisplayName(e.target.value)}
                        style={{
                          flex: 1,
                          padding: '8px 12px',
                          background: 'rgba(255,255,255,0.05)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          color: '#fff',
                          fontSize: '0.88rem',
                        }}
                      />
                      <button
                        onClick={handleUpdateProfileName}
                        style={{
                          padding: '0 16px',
                          background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                          color: '#000',
                          border: 'none',
                          borderRadius: '8px',
                          fontWeight: 800,
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                        }}
                      >
                        Save
                      </button>
                    </div>
                    {!customerProfile?.displayName && (
                      <div style={{ fontSize: '0.70rem', color: '#94a3b8', marginTop: '6px' }}>
                        Your name is currently blank in the database. Enter your name and click Save to store it.
                      </div>
                    )}
                  </div>
                </>
              ) : (
                /* Guest Diner Card (Logged Out State) */
                <div
                  style={{
                    background: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '16px',
                    padding: '22px 18px',
                    textAlign: 'center',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    alignItems: 'center',
                  }}
                >
                  <div
                    style={{
                      width: '54px',
                      height: '54px',
                      borderRadius: '50%',
                      background: 'rgba(245,158,11,0.15)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      color: '#fbbf24',
                      fontSize: '1.6rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    👤
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: '#fff', fontSize: '1.1rem', marginBottom: '4px' }}>
                      Guest Diner
                    </div>
                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', lineHeight: 1.4, margin: 0 }}>
                      You are currently signed out. Sign in with your mobile number to unlock loyalty perks, track orders, and redeem rewards.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setIsProfileOpen(false);
                      openBottomAuthSheet('SIGNIN');
                    }}
                    style={{
                      width: '100%',
                      padding: '12px 16px',
                      background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                      color: '#000',
                      fontWeight: 800,
                      fontSize: '0.88rem',
                      borderRadius: '10px',
                      border: 'none',
                      cursor: 'pointer',
                      boxShadow: '0 4px 14px rgba(245,158,11,0.3)',
                      marginTop: '4px',
                    }}
                  >
                    Sign In with Mobile / WhatsApp 📲
                  </button>
                </div>
              )}

              {/* Table Orders Quick Access Card */}
              <div
                onClick={() => {
                  setIsProfileOpen(false);
                  setIsOrdersHistoryOpen(true);
                }}
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
                  border: '1px solid rgba(255,255,255,0.09)',
                  borderRadius: '14px',
                  padding: '14px 16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div
                    style={{
                      width: '40px',
                      height: '40px',
                      borderRadius: '10px',
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '1.25rem',
                    }}
                  >
                    📋
                  </div>
                  <div>
                    <div style={{ fontSize: '0.92rem', fontWeight: 800, color: '#fff' }}>
                      Table {selectedTable} Orders
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                      {flattenedPlates.length > 0
                        ? `${flattenedPlates.length} active dishes (cooking & served)`
                        : 'View active orders & course releases'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {flattenedPlates.length > 0 && (
                    <span
                      style={{
                        background: '#10b981',
                        color: '#000',
                        borderRadius: '999px',
                        padding: '2px 8px',
                        fontSize: '0.72rem',
                        fontWeight: 800,
                      }}
                    >
                      {flattenedPlates.length}
                    </span>
                  )}
                  <span style={{ color: '#94a3b8', fontSize: '1.1rem' }}>→</span>
                </div>
              </div>

              {/* Saved Table Diners & Dining Preferences (ONLY VISIBLE WHEN SIGNED IN) */}
              {customerToken ? (
                <div className="profile-diners-section">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ fontSize: '0.90rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>👥</span>
                        <span>Saved Table Diners</span>
                      </div>
                      <div style={{ fontSize: '0.70rem', color: '#94a3b8' }}>
                        Dining preferences applied per plate
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleStartCreateProfile()}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'rgba(245, 158, 11, 0.15)',
                        border: '1px solid rgba(245, 158, 11, 0.4)',
                        borderRadius: '8px',
                        color: '#fbbf24',
                        fontSize: '0.74rem',
                        fontWeight: 700,
                        padding: '5px 10px',
                        cursor: 'pointer',
                      }}
                    >
                      <span>＋</span>
                      <span>Add Diner</span>
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {dinerProfiles.length === 0 ? (
                      <div
                        style={{
                          textAlign: 'center',
                          padding: '24px 12px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '10px',
                          border: '1px dashed rgba(255, 255, 255, 0.1)',
                        }}
                      >
                        <div style={{ fontSize: '1.4rem', marginBottom: '6px' }}>🍽️</div>
                        <div style={{ fontSize: '0.82rem', color: '#fff', fontWeight: 700, marginBottom: '4px' }}>
                          No table diners added yet
                        </div>
                        <p style={{ fontSize: '0.72rem', color: '#94a3b8', margin: 0 }}>
                          Click &ldquo;+ Add Diner&rdquo; above to save spice and dietary preferences for your table.
                        </p>
                      </div>
                    ) : (
                      dinerProfiles.map((p) => {
                        const prefs = p.preferences;
                        return (
                          <div key={p.id} className="profile-diner-card">
                            <div className="profile-diner-card-header">
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ fontSize: '0.88rem', fontWeight: 800, color: '#fff' }}>
                                  {p.name}
                                </span>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <button
                                  type="button"
                                  onClick={() => handleStartEditProfile(p)}
                                  style={{
                                    background: 'rgba(255,255,255,0.06)',
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    borderRadius: '6px',
                                    color: '#e2e8f0',
                                    fontSize: '0.68rem',
                                    padding: '3px 8px',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                  }}
                                >
                                  ✏️ Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteDinerProfile(p.id)}
                                  style={{
                                    background: 'rgba(239,68,68,0.1)',
                                    border: '1px solid rgba(239,68,68,0.2)',
                                    borderRadius: '6px',
                                    color: '#f87171',
                                    fontSize: '0.68rem',
                                    padding: '3px 8px',
                                    cursor: 'pointer',
                                  }}
                                >
                                  🗑️
                                </button>
                              </div>
                            </div>

                            {/* Categorized Preferences Summary Chips */}
                            <div className="profile-diner-tags">
                              <span className="profile-pref-chip gold">
                                🍛 {p.spicePreference === 'MILD' ? 'Mild Spice' : p.spicePreference === 'HOT' ? 'Extra Spicy' : 'Medium Spice'}
                                {prefs?.onionGarlicPreference === 'NO_ONION_GARLIC' ? ' · Jain Prep' : ''}
                                {prefs?.cookingOilPreference === 'LESS_OIL_BUTTER' ? ' · Less Oil' : ''}
                              </span>

                              <span className="profile-pref-chip cyan">
                                ☕ {prefs?.milkPreference === 'OAT_MILK' ? 'Oat Milk' : prefs?.milkPreference === 'ALMOND_MILK' ? 'Almond Milk' : prefs?.milkPreference === 'NO_MILK' ? 'Black / No Milk' : 'Dairy Milk'}
                                {prefs?.sugarPreference === 'SUGAR_FREE' ? ' · Sugar-Free' : prefs?.sugarPreference === 'LESS_SUGAR' ? ' · Less Sugar' : prefs?.sugarPreference === 'JAGGERY' ? ' · Jaggery' : ''}
                                {prefs?.hotBeverageTemp === 'EXTRA_HOT' ? ' · Extra Hot' : ''}
                              </span>

                              <span className="profile-pref-chip emerald">
                                🍨 {prefs?.dessertSweetness === 'MILD_SWEET' ? 'Mild Sweet' : 'Regular Sweet'}
                                {prefs?.nutAllergyPreference === 'NO_NUTS_ALLERGY' ? ' · No Nuts' : ''}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                /* When Logged Out: Locked Table Diners Notice */
                <div
                  style={{
                    background: 'rgba(255, 255, 255, 0.02)',
                    border: '1px dashed rgba(255, 255, 255, 0.12)',
                    borderRadius: '12px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    marginTop: '8px',
                  }}
                >
                  <div style={{ fontSize: '2rem', marginBottom: '8px' }}>🔒</div>
                  <div style={{ fontSize: '0.94rem', fontWeight: 800, color: '#fff', marginBottom: '4px' }}>
                    Personal Diners Locked
                  </div>
                  <p style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.5, margin: '0 auto 16px', maxWidth: '280px' }}>
                    Sign in to save and manage your family and friends&apos; spice preferences, dietary requirements, and plate-level taste notes.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setIsProfileOpen(false);
                      openBottomAuthSheet('SIGNIN');
                    }}
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid rgba(245, 158, 11, 0.4)',
                      color: '#fbbf24',
                      padding: '8px 18px',
                      borderRadius: '8px',
                      fontSize: '0.80rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Sign In to Unlock Diners 🔐
                  </button>
                </div>
              )}

              {/* Sign out (Only visible when signed in) */}
              {customerToken && (
                <button
                  type="button"
                  onClick={() => {
                    const currentCustId = customerId;
                    setCustomerToken(null);
                    setCustomerId(null);
                    setCustomerProfile(null);
                    setEditDisplayName('');
                    setDinerProfiles([]);
                    setSessionOrders([]);
                    void logoutCustomerRemote(activeOrgId || undefined);
                    localStorage.removeItem('dineflow_diner_profiles');
                    if (currentCustId) {
                      localStorage.removeItem(`dineflow_diner_profiles_${currentCustId}`);
                    }
                    showToast('Signed out successfully');
                  }}
                  style={{
                    color: '#ef4444',
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    marginTop: 'auto',
                    padding: '12px',
                    background: 'rgba(239,68,68,0.1)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: '8px',
                    cursor: 'pointer',
                  }}
                >
                  🚪 Sign Out
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Chef AI Chat Modal / Sheet (Always accessible from bottom-left circular button) */}
      {isAiOpen && (
        <div className="filter-sheet-overlay" onClick={() => setIsAiOpen(false)}>
          <div
            className="filter-sheet-panel"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
          >
            <div className="filter-sheet-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '1.4rem' }}>👨‍🍳</span>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff' }}>Chef AI Assistant</h3>
                  <span style={{ fontSize: '0.72rem', color: '#10b981' }}>● Online · Table {selectedTable}</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => {
                    setAiSessionId(null);
                    setAiMessages([
                      {
                        role: 'assistant',
                        text: "Namaste! I'm Chef AI at Royal Spice Bistro. 👨‍🍳 Looking for dish recommendations, spice customisations, or pairing ideas for your table?",
                      },
                    ]);
                  }}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: '#cbd5e1',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '4px 9px',
                    borderRadius: '999px',
                    cursor: 'pointer',
                  }}
                >
                  New Chat
                </button>
                <button onClick={() => setIsAiOpen(false)} style={{ color: '#94a3b8', fontSize: '1.1rem' }}>
                  ✕
                </button>
              </div>
            </div>

            {/* Quick Suggestion Chips */}
            <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '6px' }}>
              <button
                className="dietary-chip-btn"
                onClick={() => handleSendAiMessage('What are your top vegetarian specialties?')}
              >
                🌱 Top Veg Dishes
              </button>
              <button
                className="dietary-chip-btn"
                onClick={() => handleSendAiMessage('What pairs well with Butter Chicken?')}
              >
                🥘 Bread Pairings
              </button>
              <button
                className="dietary-chip-btn"
                onClick={() => handleSendAiMessage('What is mild and suitable for kids?')}
              >
                👶 Mild Dishes
              </button>
            </div>

            {/* Messages Body */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                padding: '10px 0',
                minHeight: '200px',
              }}
            >
              {aiMessages.map((msg, i) => (
                <div
                  key={i}
                  style={{
                    alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: '12px',
                    fontSize: '0.85rem',
                    lineHeight: 1.4,
                    background:
                      msg.role === 'user'
                        ? 'linear-gradient(135deg, var(--accent-gold), var(--accent-gold-dark))'
                        : 'rgba(255,255,255,0.06)',
                    color: msg.role === 'user' ? '#000' : '#fff',
                    fontWeight: msg.role === 'user' ? 700 : 400,
                    whiteSpace: 'pre-line',
                  }}
                >
                  <div>{msg.text}</div>
                  {msg.proposedCartItems && msg.proposedCartItems.length > 0 && (
                    <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '0.72rem', color: 'var(--accent-gold)', fontWeight: 700 }}>
                        Chef suggestions for your cart:
                      </span>
                      {msg.proposedCartItems.map((prop, idx) => (
                        <div
                          key={idx}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: 'rgba(0,0,0,0.3)',
                            padding: '6px 10px',
                            borderRadius: '8px',
                            border: '1px solid rgba(255,255,255,0.1)',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{prop.name}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                              ₹{(prop.pricePaise / 100).toFixed(0)} {prop.quantity > 1 ? `· Qty: ${prop.quantity}` : ''}
                            </div>
                          </div>
                          <button
                            onClick={() => handleAddProposedItemToCart(prop)}
                            style={{
                              background: 'var(--accent-gold)',
                              color: '#000',
                              border: 'none',
                              padding: '4px 10px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              cursor: 'pointer',
                            }}
                          >
                            + Add
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {aiLoading && (
                <div style={{ alignSelf: 'flex-start', color: '#94a3b8', fontSize: '0.8rem' }}>
                  👨‍🍳 Chef AI is thinking...
                </div>
              )}
              <div ref={aiMessagesEndRef} />
            </div>

            {/* Input Row */}
            <div style={{ display: 'flex', gap: '8px', paddingTop: '8px' }}>
              <input
                type="text"
                placeholder="Ask Chef AI anything..."
                value={aiInput}
                onChange={(e) => setAiInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendAiMessage()}
                style={{
                  flex: 1,
                  padding: '10px 14px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: '999px',
                  color: '#fff',
                  fontSize: '0.86rem',
                }}
              />
              <button
                onClick={() => handleSendAiMessage()}
                style={{
                  background: 'var(--accent-gold)',
                  color: '#000',
                  padding: '0 16px',
                  borderRadius: '999px',
                  fontWeight: 800,
                  fontSize: '0.9rem',
                }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Subtle Plate Naming & Saved Profiles Popover / Modal ── */}
      {plateNamingTarget && (
        <div
          className="plate-naming-modal-backdrop"
          onClick={() => setPlateNamingTarget(null)}
        >
          <div
            className="plate-naming-modal-panel"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span>✏️</span>
                  <span>Assign Diner or Rename Plate</span>
                </h3>
                <p style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px' }}>
                  Choose a saved profile or type a custom name for this plate
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPlateNamingTarget(null)}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#94a3b8',
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Editable Text Input (Opens mobile keyboard immediately) */}
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '6px' }}>
                Plate Name / Diner Name:
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  autoFocus
                  className="plate-naming-input"
                  placeholder="e.g. Rahul, Mom's Plate, Priya, Baby Plate..."
                  value={plateNameInput}
                  onChange={(e) => setPlateNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCustomPlateName()}
                />
                <button
                  type="button"
                  onClick={handleSaveCustomPlateName}
                  style={{
                    flexShrink: 0,
                    padding: '8px 14px',
                    borderRadius: '8px',
                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                    color: '#000',
                    fontSize: '0.80rem',
                    fontWeight: 800,
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Set Name
                </button>
              </div>
            </div>

            {/* Guest Mode Notice vs Saved Profiles */}
            {!customerToken ? (
              <div
                style={{
                  padding: '12px 14px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px dashed rgba(255, 255, 255, 0.12)',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  marginBottom: '14px',
                }}
              >
                <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                  <span style={{ color: '#fff', fontWeight: 600 }}>Guest Mode:</span> Sign in to auto-apply saved diners &amp; taste preferences per plate.
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPlateNamingTarget(null);
                    openBottomAuthSheet('SIGNIN');
                  }}
                  style={{
                    flexShrink: 0,
                    background: 'rgba(245, 158, 11, 0.15)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    color: '#fbbf24',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    padding: '5px 10px',
                    borderRadius: '6px',
                    cursor: 'pointer',
                  }}
                >
                  Sign In 📲
                </button>
              </div>
            ) : dinerProfiles.length > 0 ? (
              <div style={{ marginBottom: '14px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#fbbf24', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Saved Diner Profiles:
                  </span>
                  <span style={{ fontSize: '0.68rem', color: '#64748b' }}>
                    Tap profile to auto-apply
                  </span>
                </div>

                <div className="saved-profiles-grid">
                  {dinerProfiles.map((prof) => {
                    const prefs = prof.preferences;
                    const isComboTarget = plateNamingTarget.type === 'COMBO';

                    // Determine active dish context
                    let contextSummary = '';
                    if (isComboTarget && plateNamingTarget.compId) {
                      const activeComp = activeComboOffer?.components.find((c) => c.id === plateNamingTarget.compId);
                      if (activeComp?.categoryType === 'BEVERAGE') {
                        const milkLabel = prefs?.milkPreference === 'OAT_MILK' ? 'Oat Milk' : prefs?.milkPreference === 'ALMOND_MILK' ? 'Almond Milk' : prefs?.milkPreference === 'NO_MILK' ? 'Black / No Milk' : 'Dairy Milk';
                        const sugarLabel = prefs?.sugarPreference === 'SUGAR_FREE' ? 'Sugar-Free' : prefs?.sugarPreference === 'LESS_SUGAR' ? 'Less Sugar' : prefs?.sugarPreference === 'JAGGERY' ? 'Jaggery' : 'Regular Sugar';
                        contextSummary = `☕ ${milkLabel} · ${sugarLabel}`;
                      } else if (activeComp?.categoryType === 'DESSERT') {
                        contextSummary = `🍨 ${prefs?.dessertSweetness === 'MILD_SWEET' ? 'Mild Sweet' : 'Regular Sweet'}${prefs?.nutAllergyPreference === 'NO_NUTS_ALLERGY' ? ' · No Nuts' : ''}`;
                      } else {
                        contextSummary = `🍛 ${prof.spicePreference === 'MILD' ? 'Mild Spice' : prof.spicePreference === 'HOT' ? 'Extra Spicy' : 'Medium Spice'}${prefs?.onionGarlicPreference === 'NO_ONION_GARLIC' ? ' · No Onion/Garlic' : ''}`;
                      }
                    } else {
                      const currentItem =
                        activeCustomizingItem ||
                        menuItems.find((m) => m.id === expandedAccordionItemId) ||
                        PILOT_MENU.find((m) => m.id === expandedAccordionItemId);
                      if (currentItem?.category === 'Beverages') {
                        const milkLabel = prefs?.milkPreference === 'OAT_MILK' ? 'Oat Milk' : prefs?.milkPreference === 'ALMOND_MILK' ? 'Almond Milk' : prefs?.milkPreference === 'NO_MILK' ? 'Black / No Milk' : 'Dairy Milk';
                        const sugarLabel = prefs?.sugarPreference === 'SUGAR_FREE' ? 'Sugar-Free' : prefs?.sugarPreference === 'LESS_SUGAR' ? 'Less Sugar' : prefs?.sugarPreference === 'JAGGERY' ? 'Jaggery' : 'Regular Sugar';
                        contextSummary = `☕ ${milkLabel} · ${sugarLabel}`;
                      } else if (currentItem?.category === 'Desserts') {
                        contextSummary = `🍨 ${prefs?.dessertSweetness === 'MILD_SWEET' ? 'Mild Sweet' : 'Regular Sweet'}${prefs?.nutAllergyPreference === 'NO_NUTS_ALLERGY' ? ' · No Nuts' : ''}`;
                      } else {
                        contextSummary = `🍛 ${prof.spicePreference === 'MILD' ? 'Mild' : prof.spicePreference === 'HOT' ? 'Extra Spicy' : 'Medium'}${prefs?.onionGarlicPreference === 'NO_ONION_GARLIC' ? ' · Jain' : ''}`;
                      }
                    }

                    return (
                      <div
                        key={prof.id}
                        className="saved-profile-card"
                        onClick={() => handleApplyProfileToPlate(prof)}
                      >
                        <div className="saved-profile-meta">
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '0.84rem', fontWeight: 800, color: '#fff' }}>
                              {prof.name}
                            </span>
                          </div>
                          <button
                            type="button"
                            title="Edit full preferences"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleStartEditProfile(prof);
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#fbbf24',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                              padding: '2px 4px',
                            }}
                          >
                            ✏️
                          </button>
                        </div>

                        <div className="saved-profile-taste-summary" style={{ color: '#fbbf24' }}>
                          {contextSummary}
                        </div>

                        {isComboTarget && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleApplyProfileToEntireFeast(prof);
                            }}
                            style={{
                              marginTop: '6px',
                              width: '100%',
                              padding: '4px 6px',
                              borderRadius: '5px',
                              background: 'rgba(245, 158, 11, 0.12)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              color: '#fbbf24',
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                            }}
                          >
                            <span>✨</span>
                            <span>Apply to Entire Combo Feast</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {/* Add or Edit Full Preferences Button (Only visible for authenticated user) */}
            {customerToken && (
              <div style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  onClick={() => handleStartCreateProfile(plateNameInput || '')}
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    borderRadius: '8px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px dashed rgba(245, 158, 11, 0.4)',
                    color: '#fbbf24',
                    fontSize: '0.76rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>＋</span>
                  <span>Add New Diner Profile with Full Restaurant Preferences</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Comprehensive Diner Preference Editor Modal (Accessible anytime) ── */}
      {editingDinerProfile && (
        <div className="pref-editor-backdrop" onClick={() => setEditingDinerProfile(null)}>
          <div className="pref-editor-panel" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="pref-editor-header">
              <div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{isNewDinerProfile ? '👥' : '✏️'}</span>
                  <span>{isNewDinerProfile ? 'Add Saved Diner Profile' : 'Edit Dining Preferences'}</span>
                </h3>
                <p style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                  Configures food, drinks & dessert preferences for {editorName || 'this diner'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDinerProfile(null)}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#94a3b8',
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  fontSize: '0.9rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="pref-editor-body">
              {/* Diner Name */}
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '6px' }}>
                  Diner Name / Nickname:
                </label>
                <input
                  type="text"
                  className="plate-naming-input"
                  placeholder="e.g. Rahul, Priya, Mom, Dad..."
                  value={editorName}
                  onChange={(e) => setEditorName(e.target.value)}
                  style={{ width: '100%' }}
                />
              </div>

              {/* 1. Biryani, Curries & Starters (Food) */}
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="pref-section-title">
                  <span>🍛</span>
                  <span>Food, Biryani & Curries</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                      Spice Level (Biryani / Curries / Starters):
                    </label>
                    <div className="pref-pill-group">
                      {[
                        { id: 'NONE', label: '🚫 Non-Spicy' },
                        { id: 'MILD', label: '🍃 Mild' },
                        { id: 'MEDIUM', label: '🌶️ Medium' },
                        { id: 'HOT', label: '🔥 Hot' },
                        { id: 'EXTRA_SPICY', label: '💥 Extra Spicy' },
                      ].map((sp) => (
                        <button
                          key={sp.id}
                          type="button"
                          className={`pref-pill-btn ${editorSpice === sp.id ? 'active' : ''}`}
                          onClick={() => setEditorSpice(sp.id as any)}
                        >
                          {sp.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                      Onion & Garlic (Dietary / Jain Prep):
                    </label>
                    <div className="pref-pill-group">
                      {[
                        { id: 'WITH_ONION_GARLIC', label: '🧅 Standard (With Onion & Garlic)' },
                        { id: 'NO_ONION_GARLIC', label: '🍃 Jain Style (No Onion / No Garlic)' },
                      ].map((og) => (
                        <button
                          key={og.id}
                          type="button"
                          className={`pref-pill-btn ${editorOnionGarlic === og.id ? 'active' : ''}`}
                          onClick={() => setEditorOnionGarlic(og.id as any)}
                        >
                          {og.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                        Cooking Oil & Butter:
                      </label>
                      <div className="pref-pill-group">
                        {[
                          { id: 'REGULAR_OIL', label: '🧈 Standard Butter/Ghee' },
                          { id: 'LESS_OIL_BUTTER', label: '🥗 Less Oil & Butter' },
                        ].map((oil) => (
                          <button
                            key={oil.id}
                            type="button"
                            className={`pref-pill-btn ${editorOil === oil.id ? 'active' : ''}`}
                            onClick={() => setEditorOil(oil.id as any)}
                          >
                            {oil.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                        Starter Crispiness:
                      </label>
                      <div className="pref-pill-group">
                        {[
                          { id: 'REGULAR', label: 'Standard Tender' },
                          { id: 'EXTRA_CRISPY', label: '🔥 Extra Crispy' },
                        ].map((cr) => (
                          <button
                            key={cr.id}
                            type="button"
                            className={`pref-pill-btn ${editorCrispy === cr.id ? 'active' : ''}`}
                            onClick={() => setEditorCrispy(cr.id as any)}
                          >
                            {cr.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* 2. Hot & Cold Beverages (Drinks) */}
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="pref-section-title">
                  <span>☕</span>
                  <span>Hot & Cold Beverages (Coffee, Tea, Lassi)</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                      Milk Choice (Entire Restaurant):
                    </label>
                    <div className="pref-pill-group">
                      {[
                        { id: 'REGULAR_MILK', label: '🥛 Regular Dairy Milk' },
                        { id: 'OAT_MILK', label: '🌾 Oat Milk (+₹30)' },
                        { id: 'ALMOND_MILK', label: '🌰 Almond Milk (+₹35)' },
                        { id: 'NO_MILK', label: '☕ Black / No Milk' },
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          className={`pref-pill-btn ${editorMilk === m.id ? 'active' : ''}`}
                          onClick={() => setEditorMilk(m.id as any)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                      Sugar & Sweetness Preference:
                    </label>
                    <div className="pref-pill-group">
                      {[
                        { id: 'REGULAR_SUGAR', label: 'Regular Sugar' },
                        { id: 'SUGAR_FREE', label: '🚫 Sugar-Free' },
                        { id: 'LESS_SUGAR', label: '🍯 Less Sugar' },
                        { id: 'JAGGERY', label: '🍯 Jaggery (Gud)' },
                        { id: 'EXTRA_SWEET', label: 'Extra Sweet' },
                      ].map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={`pref-pill-btn ${editorSugar === s.id ? 'active' : ''}`}
                          onClick={() => setEditorSugar(s.id as any)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                        Hot Temp:
                      </label>
                      <div className="pref-pill-group">
                        {[
                          { id: 'REGULAR_HOT', label: '☕ Regular Hot' },
                          { id: 'EXTRA_HOT', label: '🔥 Extra Hot' },
                        ].map((ht) => (
                          <button
                            key={ht.id}
                            type="button"
                            className={`pref-pill-btn ${editorHotTemp === ht.id ? 'active' : ''}`}
                            onClick={() => setEditorHotTemp(ht.id as any)}
                          >
                            {ht.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                        Cold Drink Ice:
                      </label>
                      <div className="pref-pill-group">
                        {[
                          { id: 'REGULAR_ICE', label: '🧊 Regular Ice' },
                          { id: 'LESS_ICE', label: 'Less Ice' },
                          { id: 'NO_ICE', label: '🚫 No Ice' },
                        ].map((ci) => (
                          <button
                            key={ci.id}
                            type="button"
                            className={`pref-pill-btn ${editorColdIce === ci.id ? 'active' : ''}`}
                            onClick={() => setEditorColdIce(ci.id as any)}
                          >
                            {ci.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                      Coffee / Chai Strength:
                    </label>
                    <div className="pref-pill-group">
                      {[
                        { id: 'MEDIUM_STRENGTH', label: 'Standard Strength' },
                        { id: 'STRONG_KADAK', label: '☕ Strong / Kadak' },
                        { id: 'LIGHT_MILD', label: 'Light / Mild' },
                      ].map((str) => (
                        <button
                          key={str.id}
                          type="button"
                          className={`pref-pill-btn ${editorStrength === str.id ? 'active' : ''}`}
                          onClick={() => setEditorStrength(str.id as any)}
                        >
                          {str.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Desserts & Sweets */}
              <div style={{ background: 'rgba(255,255,255,0.02)', padding: '12px', borderRadius: '10px', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="pref-section-title">
                  <span>🍨</span>
                  <span>Desserts & Sweets (Gulab Jamun, Rasmalai)</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                        Dessert Sweetness:
                      </label>
                      <div className="pref-pill-group">
                        {[
                          { id: 'REGULAR_SWEET', label: 'Regular Sweet' },
                          { id: 'MILD_SWEET', label: 'Mild Sweet' },
                          { id: 'EXTRA_SWEET', label: 'Extra Sweet' },
                        ].map((ds) => (
                          <button
                            key={ds.id}
                            type="button"
                            className={`pref-pill-btn ${editorDessertSweet === ds.id ? 'active' : ''}`}
                            onClick={() => setEditorDessertSweet(ds.id as any)}
                          >
                            {ds.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                        Dessert Temp:
                      </label>
                      <div className="pref-pill-group">
                        {[
                          { id: 'SERVED_WARM', label: '♨️ Served Warm' },
                          { id: 'SERVED_CHILLED', label: '❄️ Chilled' },
                          { id: 'ROOM_TEMP', label: 'Room Temp' },
                        ].map((dt) => (
                          <button
                            key={dt.id}
                            type="button"
                            className={`pref-pill-btn ${editorDessertTemp === dt.id ? 'active' : ''}`}
                            onClick={() => setEditorDessertTemp(dt.id as any)}
                          >
                            {dt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.70rem', color: '#94a3b8', marginBottom: '4px' }}>
                      Nut Allergies:
                    </label>
                    <div className="pref-pill-group">
                      {[
                        { id: 'REGULAR_NUTS', label: 'Regular (Garnished with Almonds & Pistachios)' },
                        { id: 'NO_NUTS_ALLERGY', label: '🚫 Without Nuts (Nut Allergy Safe)' },
                      ].map((na) => (
                        <button
                          key={na.id}
                          type="button"
                          className={`pref-pill-btn ${editorNutAllergy === na.id ? 'active' : ''}`}
                          onClick={() => setEditorNutAllergy(na.id as any)}
                        >
                          {na.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Special Instructions Note */}
              <div>
                <label style={{ display: 'block', fontSize: '0.72rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '6px' }}>
                  Custom Kitchen Notes (Optional):
                </label>
                <input
                  type="text"
                  placeholder="e.g. Less salt, sensitive to gluten, well-cooked chicken..."
                  value={editorNotes}
                  onChange={(e) => setEditorNotes(e.target.value)}
                  className="plate-naming-input"
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                padding: '14px 20px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.02)',
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '10px',
              }}
            >
              <button
                type="button"
                onClick={() => setEditingDinerProfile(null)}
                style={{
                  padding: '8px 16px',
                  borderRadius: '8px',
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  color: '#cbd5e1',
                  fontSize: '0.80rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveProfileForm}
                style={{
                  padding: '8px 20px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  color: '#000',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
                }}
              >
                💾 Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Square Item Card Component (Claude Spec: 1:1 image, truncated name, price, overlapping circular "+" button)
// ============================================================================

const FALLBACK_DISH_IMG = 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80';

interface SquareItemCardProps {
  item: MenuItem;
  qty: number;
  isHearted: boolean;
  onToggleHeart: (e: React.MouseEvent) => void;
  onAdd: (e: React.MouseEvent) => void;
  onDecrement: (e: React.MouseEvent) => void;
  onOpenAccordion: () => void;
}

function SquareItemCard({
  item,
  qty,
  isHearted,
  onToggleHeart,
  onAdd,
  onDecrement,
  onOpenAccordion,
}: SquareItemCardProps) {
  return (
    <div className="square-item-card">
      <div className="square-img-container" onClick={onOpenAccordion}>
        <img
          src={item.imageUrl || FALLBACK_DISH_IMG}
          alt={item.name}
          className="square-dish-img"
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = FALLBACK_DISH_IMG;
          }}
        />

        {/* Dietary Dot Badge */}
        <div className="square-veg-badge">
          <span style={{ fontSize: '0.7rem' }}>{item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
        </div>

        {/* Wishlist Heart Button */}
        <button
          className={`square-wishlist-btn ${isHearted ? 'hearted' : ''}`}
          onClick={onToggleHeart}
          title={isHearted ? 'In favorites' : 'Add to favorites'}
        >
          {isHearted ? '❤️' : '🤍'}
        </button>

        {/* Small circular "+" overlapping bottom-right corner of the image (or quantity stepper) */}
        {qty > 0 ? (
          <div className="square-stepper-btn" onClick={(e) => e.stopPropagation()}>
            <button onClick={onDecrement}>−</button>
            <span>{qty}</span>
            <button onClick={onAdd}>+</button>
          </div>
        ) : (
          <button className="square-circular-add-btn" onClick={onAdd} title="Add to Order">
            +
          </button>
        )}
      </div>

      <div className="square-card-body" onClick={onOpenAccordion}>
        <div className="square-card-name" title={item.name}>
          {item.name}
        </div>
        <div className="square-card-price">₹{(item.pricePaise / 100).toFixed(0)}</div>
      </div>
    </div>
  );
}
