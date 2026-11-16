'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useOrderStore } from '../store/useOrderStore';
import { SquareItemCard, FALLBACK_DISH_IMG } from '../components/menu/SquareItemCard';
import { DineInCheckoutModal, DineInBillBreakdown } from '../components/checkout/DineInCheckoutModal';
import { CartDrawer } from '../components/cart/CartDrawer';
import { ItemCustomizerModal } from '../components/modals/ItemCustomizerModal';
import { MenuGrid } from '../components/menu/MenuGrid';
import { DEFAULT_CATEGORIES } from '../components/menu/menu-constants';
import { OrdersHistoryView } from '../components/orders/OrdersHistoryView';
import { CustomerAuthModal } from '../components/modals/CustomerAuthModal';
import { TopNavBar } from '../components/layout/TopNavBar';
import { OrderTrackerBanner } from '../components/layout/OrderTrackerBanner';
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

interface HeroSlideItem {
  tag: string;
  title: string;
  subtitle: string;
  img: string;
  categoryTarget?: string;
  dishTarget?: string;
  couponCode?: string;
  btnText: string;
}

const HERO_SLIDES: HeroSlideItem[] = [
  {
    tag: 'ROYAL DUM BIRYANI',
    title: 'Hyderabadi Chicken Dum Biryani',
    subtitle: 'Fragrant aged basmati rice slow dum-cooked with royal saffron, roasted spices & tender chicken.',
    img: 'https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?auto=format&fit=crop&w=1200&q=80',
    categoryTarget: 'Biryani & Rice',
    dishTarget: 'biryani',
    btnText: 'Explore Biryani & Rice →',
  },
  {
    tag: 'TANDOORI & CURRIES',
    title: 'Old Delhi Butter Chicken',
    subtitle: 'Smoky charcoal-roasted tandoori chicken simmered in rich velvety creamy tomato makhani gravy.',
    img: 'https://images.unsplash.com/photo-1603894584373-5ac82b2ae398?auto=format&fit=crop&w=1200&q=80',
    categoryTarget: 'Main Course',
    dishTarget: 'butter chicken',
    btnText: 'View Main Course →',
  },
  {
    tag: "CHEF'S SPECIALTY",
    title: 'Paneer Tikka Charcoal Char',
    subtitle: 'Fresh cottage cheese cubes marinated in spiced hung curd & roasted to perfection over live coals.',
    img: 'https://images.unsplash.com/photo-1567184109411-b28f27034344?auto=format&fit=crop&w=1200&q=80',
    categoryTarget: 'Starters',
    dishTarget: 'paneer tikka',
    btnText: 'Explore Starters →',
  },
  {
    tag: 'FESTIVE OFFER',
    title: 'Flat 15% OFF Dining',
    subtitle: 'Enjoy 15% instant savings on your dining feast today for orders above ₹500 with code ROYAL15.',
    img: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
    couponCode: 'ROYAL15',
    btnText: 'Apply ROYAL15 Coupon',
  },
];

interface AvailableCoupon {
  code: string;
  tag: string;
  title: string;
  description: string;
  minOrderPaise: number;
  type: 'PERCENT' | 'FIXED';
  percent?: number;
  fixedPaise?: number;
}

const AVAILABLE_COUPONS: AvailableCoupon[] = [
  {
    code: 'ROYAL15',
    tag: 'POPULAR · 15% OFF',
    title: 'Flat 15% Off Your Feast',
    description: 'Get 15% instant discount on dine-in orders above ₹500.',
    minOrderPaise: 50000,
    type: 'PERCENT',
    percent: 15,
  },
  {
    code: 'DINEFIRST',
    tag: 'FIRST DINE-IN',
    title: '₹100 Welcome Discount',
    description: 'Welcome gift of ₹100 off on dining bills above ₹300.',
    minOrderPaise: 30000,
    type: 'FIXED',
    fixedPaise: 10000,
  },
  {
    code: 'AWADHI50',
    tag: 'BIRYANI SPECIAL',
    title: '₹50 Biryani Delight',
    description: 'Flat ₹50 savings on any authentic handi biryani or feast above ₹400.',
    minOrderPaise: 40000,
    type: 'FIXED',
    fixedPaise: 5000,
  },
  {
    code: 'FEAST20',
    tag: 'GRAND GATHERINGS',
    title: '20% Mega Savings',
    description: 'Enjoy 20% savings for family gatherings and table bills above ₹1,500.',
    minOrderPaise: 150000,
    type: 'PERCENT',
    percent: 20,
  },
  {
    code: 'ROYAL200',
    tag: 'CHEF VIP',
    title: 'Flat ₹200 Off Royal Banquet',
    description: 'Flat ₹200 deduction on lavish banquet dining above ₹2,000.',
    minOrderPaise: 200000,
    type: 'FIXED',
    fixedPaise: 20000,
  },
];

function computeCouponDiscountPaise(coupon: AvailableCoupon, subtotalPaise: number): number {
  if (subtotalPaise < coupon.minOrderPaise) return 0;
  if (coupon.type === 'PERCENT' && coupon.percent) {
    return Math.round((subtotalPaise * coupon.percent) / 100);
  }
  if (coupon.type === 'FIXED' && coupon.fixedPaise) {
    return Math.min(coupon.fixedPaise, subtotalPaise);
  }
  return 0;
}

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

  // Table and Dining Session State (sourced strictly from Zustand store)
  const selectedTable = useOrderStore((s) => s.selectedTable);
  const setSelectedTable = useOrderStore((s) => s.setSelectedTable);
  const isTableVerified = useOrderStore((s) => s.isTableVerified);
  const setIsTableVerified = useOrderStore((s) => s.setIsTableVerified);
  const isTableModalOpen = useOrderStore((s) => s.isTableModalOpen);
  const setIsTableModalOpen = useOrderStore((s) => s.setIsTableModalOpen);
  const activeSessionId = useOrderStore((s) => s.activeSessionId);
  const activeTableId = useOrderStore((s) => s.activeTableId);
  const activeOrgId = useOrderStore((s) => s.activeOrgId || resolveTenantIds().orgId);
  const activeOutletId = useOrderStore((s) => s.activeOutletId || resolveTenantIds().outletId);
  const tablePax = useOrderStore((s) => s.tablePax);
  const setSessionDetails = useOrderStore((s) => s.setSessionDetails);

  const setActiveSessionId = useCallback((id: string) => setSessionDetails({ sessionId: id }), [setSessionDetails]);
  const setActiveTableId = useCallback((id: string) => setSessionDetails({ tableId: id }), [setSessionDetails]);
  const setActiveOrgId = useCallback((id: string) => setSessionDetails({ orgId: id }), [setSessionDetails]);
  const setActiveOutletId = useCallback((id: string) => setSessionDetails({ outletId: id }), [setSessionDetails]);
  const setTablePax = useCallback((pax: number) => useOrderStore.setState({ tablePax: pax }), []);
  const [manualQrInput, setManualQrInput] = useState('');
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
  const [wishlist, setWishlist] = useState<Set<string>>(new Set());

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

  // Cart & Line Items (with robust localStorage persistence and SSR hydration safety via Zustand)
  const [isMounted, setIsMounted] = useState(false);
  const cartLines = useOrderStore((state) => state.cartLines);
  const setCartLines = useOrderStore((state) => state.setCartLines);
  const [isAvailableCouponsOpen, setIsAvailableCouponsOpen] = useState(false);

  // Load cart from localStorage once on client mount to avoid SSR hydration mismatches
  useEffect(() => {
    setIsMounted(true);
    useOrderStore.getState().hydrateFromStorage();
  }, []);
  const isCartOpen = useOrderStore((s) => s.isCartOpen);
  const setIsCartOpen = useOrderStore((s) => s.setIsCartOpen);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const appliedCoupon = useOrderStore((s) => s.appliedCoupon);
  const setAppliedCoupon = useOrderStore((s) => s.setAppliedCoupon);
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);

  // Accordion-style in-place customisation state (Only one item expanded at a time)
  const [expandedAccordionItemId, setExpandedAccordionItemId] = useState<string | null>(null);

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
  const activeCustomizingItem = useOrderStore((s) => s.customizingItem);
  const setActiveCustomizingItem = useOrderStore((s) => s.setCustomizingItem);
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
  const isOrdersHistoryOpen = useOrderStore((s) => s.isOrdersHistoryOpen);
  const setIsOrdersHistoryOpen = useOrderStore((s) => s.setIsOrdersHistoryOpen);
  const [ordersFilterTab, setOrdersFilterTab] = useState<'PREPARING' | 'ON_HOLD' | 'SERVED' | 'CANCELLED'>('PREPARING');
  const [releasedHoldPlateKeys, setReleasedHoldPlateKeys] = useState<Record<string, boolean>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = localStorage.getItem('dineflow_released_holds');
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });
  const [expandedPlateKeys, setExpandedPlateKeys] = useState<Record<string, boolean>>({});

  const handleReleaseHold = async (plateKeys: string[], itemName?: string) => {
    // 1. Optimistically update state & persist to localStorage immediately
    setReleasedHoldPlateKeys((prev) => {
      const next = { ...prev };
      plateKeys.forEach((k) => {
        next[k] = true;
      });
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('dineflow_released_holds', JSON.stringify(next));
        } catch {}
      }
      return next;
    });

    setToastMessage(`🍳 Sent to kitchen! Chef will start preparing ${itemName || 'your item'} now.`);
    setTimeout(() => setToastMessage(null), 4000);

    // 2. Persist to PostgreSQL database via backend API for each plate's item
    const pairs = new Set<string>();
    plateKeys.forEach((k) => {
      // Plate key format: `${ord.id}-${it.id}-${pIdx}`
      const parts = k.split('-');
      if (parts.length >= 10) {
        const orderId = parts.slice(0, 5).join('-');
        const itemId = parts.slice(5, 10).join('-');
        pairs.add(`${orderId}::${itemId}`);
      }
    });

    for (const pair of pairs) {
      const [orderId, itemId] = pair.split('::');
      if (orderId && itemId) {
        try {
          await customerApiFetch(
            `/api/v1/customer/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/release-hold`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
            },
            { preferToken: loadCustomerAuth() ? 'customer' : 'guest' },
          );
        } catch (err) {
          console.error('Failed to notify backend of hold release:', err);
        }
      }
    }

    // 3. Re-sync live session orders from backend
    if (activeSessionId) {
      void fetchSessionOrders(activeSessionId);
    }
  };

  // Customer Authentication & Profile State (isAuthModalOpen sourced from Zustand store)
  const isAuthModalOpen = useOrderStore((s) => s.isAuthModalOpen);
  const setIsAuthModalOpen = useOrderStore((s) => s.setIsAuthModalOpen);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
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

  // Payment Settlement State (sourced from Zustand store)
  const isPaymentModalOpen = useOrderStore((s) => s.isPaymentModalOpen);
  const setIsPaymentModalOpen = useOrderStore((s) => s.setIsPaymentModalOpen);
  const selectedPaymentMethod = useOrderStore((s) => s.selectedPaymentMethod);
  const setSelectedPaymentMethod = useOrderStore((s) => s.setSelectedPaymentMethod);
  const paymentLoading = useOrderStore((s) => s.paymentLoading);
  const setPaymentLoading = useOrderStore((s) => s.setPaymentLoading);
  const paymentQrData = useOrderStore((s) => s.paymentQrData);
  const setPaymentQrData = useOrderStore((s) => s.setPaymentQrData);
  const paymentSuccessData = useOrderStore((s) => s.paymentSuccessData);
  const setPaymentSuccessData = useOrderStore((s) => s.setPaymentSuccessData);

  // Food Item Reviews State
  const [reviewingOrder, setReviewingOrder] = useState<TableOrderRecord | null>(null);
  const [dishRatings, setDishRatings] = useState<Record<string, { rating: number; review: string }>>({});
  const [overallOrderRating, setOverallOrderRating] = useState<number>(0);
  const [overallOrderComment, setOverallOrderComment] = useState<string>('');
  const [selectedReviewTags, setSelectedReviewTags] = useState<string[]>([]);
  const [submittingReview, setSubmittingReview] = useState<boolean>(false);
  const [reviewedOrderIds, setReviewedOrderIds] = useState<Set<string>>(new Set());

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
        notes?: string;
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

  // Synchronize top table drawer inputs & tables whenever isTableModalOpen opens (e.g. via TopNavBar)
  useEffect(() => {
    if (isTableModalOpen) {
      setIsTopTableClosing(false);
      setTableNumberInput((prev) => prev || (selectedTable !== '--' ? sanitizeTableDigits(selectedTable) : ''));
      const tenant = resolveTenantIds(loadGuestSession());
      const targetOutlet = activeOutletId || tenant.outletId || undefined;
      if (!outletTablesLoaded || outletTables.length === 0) {
        void loadOutletTablesForTenant(targetOutlet, activeSlug);
      }
    }
  }, [isTableModalOpen, activeOutletId, activeSlug, loadOutletTablesForTenant, outletTables.length, outletTablesLoaded, selectedTable]);

  const openBottomAuthSheet = useCallback(
    (_mode: 'SIGNIN' | 'SIGNUP' = 'SIGNIN') => {
      setIsAuthModalOpen(true);
    },
    [setIsAuthModalOpen],
  );

  const closeBottomAuthSheet = useCallback(() => {
    setIsAuthModalOpen(false);
  }, [setIsAuthModalOpen]);

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
      useOrderStore.getState().setIsTableVerified(false);
      showToast(res.error);
      return null;
    }
    useOrderStore.getState().setSessionDetails({
      sessionId: res.session.sessionId,
      tableId: res.session.tableId,
      orgId: res.session.orgId,
      outletId: res.session.outletId,
    });
    if (res.session.tableNumber) {
      useOrderStore.getState().setSelectedTable(res.session.tableNumber);
    }
    useOrderStore.getState().setIsTableVerified(true);
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
    useOrderStore.getState().setSessionDetails({
      sessionId: res.session.sessionId,
      tableId: res.session.tableId,
      orgId: res.session.orgId,
      outletId: res.session.outletId,
    });
    useOrderStore.getState().setSelectedTable(res.session.tableNumber || tableNumber);
    useOrderStore.getState().setIsTableVerified(true);
    void loadOutletTablesForTenant(res.session.outletId, slugToUse ?? activeSlug);
    fetchSessionOrders(res.session.sessionId);
    return res.session;
  };

  const applyActiveGuestSession = useCallback(
    (sess: GuestSessionState, slugHint?: string) => {
      useOrderStore.getState().setSessionDetails({
        sessionId: sess.sessionId,
        tableId: sess.tableId,
        orgId: sess.orgId,
        outletId: sess.outletId,
      });
      if (sess.tableNumber) {
        useOrderStore.getState().setSelectedTable(sess.tableNumber);
      }
      useOrderStore.getState().setIsTableVerified(true);
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

      // 1. Sync Table Selection immediately when URL params are parsed
      if (tableNumberParam) {
        useOrderStore.getState().setSelectedTable(tableNumberParam);
      }

      if (targetOutletId) {
        useOrderStore.getState().setSessionDetails({
          outletId: targetOutletId,
          orgId: tenant.orgId,
        });
      }
      void loadOutletTablesForTenant(targetOutletId, slugParam || undefined);

      // 2. Pre-hydrate from local/session storage if existing guest session is present
      const existing = loadGuestSession();
      if (existing?.sessionId) {
        useOrderStore.getState().setSessionDetails({
          sessionId: existing.sessionId,
          tableId: existing.tableId,
          orgId: existing.orgId,
          outletId: existing.outletId,
        });
        if (existing.tableNumber) {
          useOrderStore.getState().setSelectedTable(existing.tableNumber);
        }
        useOrderStore.getState().setIsTableVerified(true);
      }

      // 3. If signed QR token is present, establish signed session
      if (signedQrToken) {
        await establishSignedTableSession(signedQrToken, tablePax);
        return;
      }

      // 4. If table number param without QR token, establish manual session
      if (tableNumberParam) {
        await establishManualTableSession(targetOutletId, tableNumberParam, tablePax, slugParam || undefined);
        return;
      }

      // 5. Restore persistent temporary customer & active table from HttpOnly cookie (survives refresh & PhonePe tabs)
      const remote = await fetchCurrentGuestSessionRemote();
      if (!active) return;

      if (remote?.active && remote.session) {
        applyActiveGuestSession(remote.session, slugParam || undefined);
        void fetchSessionOrders(remote.session.sessionId);
        return;
      }

      if (remote?.dissolved) {
        useOrderStore.getState().setSessionDetails({
          sessionId: '',
          tableId: '',
        });
        useOrderStore.getState().setSelectedTable('--');
        useOrderStore.getState().setIsTableVerified(false);
        if (!loadCustomerAuth()) {
          setSessionOrders([]);
        }
        if (!urlParams.get('payment_success')) {
          setIsTableModalOpen(true);
        }
        return;
      }

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
  }, [applyActiveGuestSession, loadOutletTablesForTenant, tablePax]);

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
              } else {
                const itemHasLivePhoto =
                  typeof item.imageUrl === 'string' && item.imageUrl.trim().length > 0;
                const existingHasLivePhoto =
                  typeof existing.imageUrl === 'string' && existing.imageUrl.trim().length > 0;
                const chosenImg = itemHasLivePhoto
                  ? item.imageUrl
                  : existingHasLivePhoto
                  ? existing.imageUrl
                  : item.imageUrl || existing.imageUrl;

                const chosenModGroups =
                  (item.modifierGroups?.length || 0) >= (existing.modifierGroups?.length || 0)
                    ? item.modifierGroups
                    : existing.modifierGroups;
                const chosenModifiers =
                  (item.modifiers?.length || 0) >= (existing.modifiers?.length || 0)
                    ? item.modifiers
                    : existing.modifiers;

                seen.set(key, {
                  ...((item.modifierGroups?.length || 0) >= (existing.modifierGroups?.length || 0) ? item : existing),
                  imageUrl: chosenImg,
                  modifierGroups: chosenModGroups,
                  modifiers: chosenModifiers,
                });
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
    const onFocus = () => { void fetchLiveMenu(); };
    window.addEventListener('focus', onFocus);
    const interval = setInterval(() => { void fetchLiveMenu(); }, 12000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(interval);
    };
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

  // ── 7. Category Navigation ────────────────────────────────────────────────
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
    if (!customerToken) {
      openBottomAuthSheet('SIGNIN');
      showToast('Please sign in to save dishes to your favorites ❤️');
      return;
    }
    useOrderStore.getState().toggleWishlist(itemId);
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
    const found = AVAILABLE_COUPONS.find((c) => c.code === appliedCoupon);
    if (found) {
      return computeCouponDiscountPaise(found, cartSubtotalPaise);
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
          const isReleased =
            Boolean(releasedHoldPlateKeys[plateKey]) ||
            Boolean(it.notes && it.notes.includes('[RELEASED_TO_KITCHEN]'));
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

  // Keep Zustand store activeOrderCount in sync with flattened active plates
  useEffect(() => {
    useOrderStore.getState().setActiveOrderCount(flattenedPlates.length);
  }, [flattenedPlates.length]);

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

    setExpandedAccordionItemId(item.id);
    setActiveCustomizingItem(item);
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

  // ── Combo Customization Handlers ──
  const openComboCustomizer = (combo: ComboOffer) => {
    const liveComboItem = menuItems.find(
      (m) => m.id === combo.id || m.name.toLowerCase() === combo.name.toLowerCase(),
    );
    const effectiveCombo =
      liveComboItem?.imageUrl && liveComboItem.imageUrl.trim().length > 0
        ? { ...combo, imageUrl: liveComboItem.imageUrl }
        : combo;
    setActiveComboOffer(effectiveCombo);
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
      showToast(profile ? `Applied ${profile.name}'s preferences 👨‍🍳` : 'Profile applied');
      setPlateNamingTarget(null);
      return;
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
    const trimmed = (code || '').trim().toUpperCase();
    if (!trimmed) {
      setCouponError('Please enter a coupon code.');
      return;
    }
    const found = AVAILABLE_COUPONS.find((c) => c.code.toUpperCase() === trimmed);
    if (!found) {
      setCouponError(`Coupon code "${trimmed}" is not valid.`);
      setAppliedCoupon(null);
      return;
    }
    if (cartSubtotalPaise < found.minOrderPaise) {
      const deficit = found.minOrderPaise - cartSubtotalPaise;
      setCouponError(
        `Minimum order of ₹${(found.minOrderPaise / 100).toFixed(0)} required for ${found.code} (add ₹${(deficit / 100).toFixed(0)} more).`,
      );
      setAppliedCoupon(null);
      return;
    }
    setCouponError(null);
    setAppliedCoupon(found.code);
    setCouponInput(found.code);
    showToast(`Coupon ${found.code} applied! 🎉`);
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
    targetOrgId?: string,
  ) => {
    const effectiveOrgId = targetOrgId || activeOrgId || resolveTenantIds(loadGuestSession()).orgId;
    saveCustomerAuth({ accessToken: data.accessToken, customerId: data.customerId });
    setCustomerToken(data.accessToken);
    setCustomerId(data.customerId);

    const profRes = await customerApiFetch(
      '/api/v1/auth/customer/profile',
      undefined,
      { preferToken: 'customer', tokenOverride: data.accessToken, orgIdOverride: effectiveOrgId },
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
    setIsAuthModalOpen(false);
    showToast(
      data.displayName
        ? `Signed in as ${data.displayName}!`
        : 'Signed in successfully! Your mobile session is saved.'
    );
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
      const wishlistNames = Array.from(wishlist)
        .map((id) => menuItems.find((m) => m.id === id)?.name)
        .filter(Boolean) as string[];

      const sendRequest = async (sessionIdToUse: string | null) => {
        const payload: Record<string, unknown> = {
          org_id: targetOrgId,
          outlet_id: targetOutletId,
          message: userMsg,
        };
        if (wishlistNames.length > 0) {
          payload['wishlistDishNames'] = wishlistNames;
        }
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
    notes?: string;
  }) => {
    const matched = menuItems.find(
      (m) => m.id === proposed.itemId || m.name.toLowerCase() === proposed.name.toLowerCase(),
    );
    if (matched) {
      setCartLines((prev) => {
        const existingIdx = prev.findIndex(
          (c) => c.item.id === matched.id && !c.plateLabel && c.notes === (proposed.notes || undefined),
        );
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
            notes: proposed.notes || undefined,
            selectedModifiers: [],
          },
        ];
      });
      showToast(`Added ${matched.name}${proposed.notes ? ` (${proposed.notes})` : ''} to cart! 🛒`);
    } else {
      showToast(`Dish "${proposed.name}" added to order!`);
    }
  };

  const openReviewModal = (order: TableOrderRecord) => {
    // Collect ONLY the items from this order that have been served!
    const servedPlateItemIds = new Set(
      servedPlates.filter((p) => p.orderId === order.id).map((p) => p.itemId),
    );
    const servedItems = order.items.filter((item, idx) => {
      const key = (item as any).menu_item_id || (item as any).itemId || `item-${idx}`;
      return (
        order.status === 'SERVED' ||
        order.status === 'BILLED' ||
        item.status === 'SERVED' ||
        item.status === 'BILLED' ||
        servedPlateItemIds.has(item.id) ||
        servedPlateItemIds.has(key)
      );
    });

    if (servedItems.length === 0) {
      showToast('Dishes are still cooking in the kitchen! Rating unlocks once served to your table 🍽️');
      return;
    }

    const initialDishRatings: Record<string, { rating: number; review: string }> = {};
    servedItems.forEach((item, idx) => {
      const key = (item as any).menu_item_id || (item as any).itemId || `item-${idx}`;
      initialDishRatings[key] = { rating: 0, review: '' };
    });
    setDishRatings(initialDishRatings);
    setOverallOrderRating(0);
    setOverallOrderComment('');
    setSelectedReviewTags([]);
    setReviewingOrder({
      ...order,
      items: servedItems,
    });
  };

  const handleSubmitDishReviews = async () => {
    if (!reviewingOrder) return;
    const hasAnyDishRating = Object.values(dishRatings).some((r) => r.rating > 0);
    if (overallOrderRating === 0 && !hasAnyDishRating) {
      showToast('Please tap a star rating before submitting ⭐');
      return;
    }
    setSubmittingReview(true);
    try {
      const reviews = reviewingOrder.items
        .map((item, idx) => {
          const menuItemId = (item as any).menu_item_id || (item as any).itemId || `item-${idx}`;
          const matchedMenu = menuItems.find((m) => m.name.toLowerCase() === item.name_snapshot.toLowerCase());
          const realId = matchedMenu?.id || (menuItemId.length === 36 ? menuItemId : '00000000-0000-0000-0000-000000000001');
          const record = dishRatings[menuItemId] || { rating: 0, review: '' };
          const ratingToSubmit = record.rating > 0 ? record.rating : overallOrderRating > 0 ? overallOrderRating : 5;
          return {
            menuItemId: realId,
            dishName: item.name_snapshot,
            rating: ratingToSubmit,
            review: record.review.trim() || undefined,
            userRated: record.rating > 0,
          };
        })
        .filter((r) => r.userRated || overallOrderRating > 0)
        .map(({ userRated: _, ...r }) => r);

      const payload = {
        orderId: reviewingOrder.id,
        overallRating: overallOrderRating > 0 ? overallOrderRating : 5,
        overallComment: overallOrderComment.trim() || undefined,
        tags: selectedReviewTags,
        reviews,
      };

      const endpoint = customerToken ? '/api/v1/me/dish-reviews' : '/api/v1/public/dish-reviews';
      const tokenMode = customerToken ? 'customer' : 'guest';

      const res = await customerApiFetch(
        endpoint,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { preferToken: tokenMode, ...(customerToken ? { tokenOverride: customerToken } : {}) },
      );

      if (res.ok) {
        setReviewedOrderIds((prev) => new Set([...prev, reviewingOrder.id]));
        showToast('Thank you for reviewing! Your feedback has been saved ❤️ +₹10 store reward earned!');
        setReviewingOrder(null);
      } else {
        const err = (await res.json().catch(() => null)) as { detail?: string; message?: string } | null;
        showToast(err?.detail || err?.message || 'Failed to submit review. Please try again.');
      }
    } catch {
      showToast('Network error while saving review. Please try again.');
    } finally {
      setSubmittingReview(false);
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
    <div style={{ minHeight: '100vh', paddingBottom: (isMounted && cartItemCount > 0) ? '110px' : '80px', position: 'relative' }}>
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
          <TopNavBar
            view="home"
            onOpenProfile={() => setIsProfileOpen(true)}
            customerToken={customerToken}
            customerDisplayName={customerProfile?.displayName}
            cartPulse={cartPulse}
            cartIconRef={cartIconRef}
            showToast={showToast}
          />

          {/* Active Order Tracker Banner */}
          <OrderTrackerBanner />

          {/* 2. Hero Section (Auto-rotating Banner Carousel) */}
          <div className="hero-carousel-container">
            <div className="hero-slide-wrapper">
              {(() => {
                const currentSlide = HERO_SLIDES[heroIndex]!;
                let resolvedSlideImg = currentSlide.img;
                if (currentSlide.dishTarget) {
                  const match = menuItems.find((it) =>
                    it.name.toLowerCase().includes(currentSlide.dishTarget!.toLowerCase()),
                  );
                  if (match?.imageUrl && match.imageUrl.trim().length > 0) {
                    resolvedSlideImg = match.imageUrl;
                  }
                }
                return (
                  <img
                    src={resolvedSlideImg}
                    alt={currentSlide.title}
                    className="hero-slide-img"
                  />
                );
              })()}
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
              {COMBO_OFFERS.map((combo) => {
                const liveComboItem = menuItems.find(
                  (m) => m.id === combo.id || m.name.toLowerCase() === combo.name.toLowerCase(),
                );
                const comboImg =
                  liveComboItem?.imageUrl && liveComboItem.imageUrl.trim().length > 0
                    ? liveComboItem.imageUrl
                    : combo.imageUrl;
                return (
                  <div
                    key={combo.id}
                    className="combo-offer-card"
                    onClick={() => navigateToCombo(combo)}
                  >
                    <div className="combo-card-banner">
                      <img
                        src={comboImg}
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
              );
            })}
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
          <TopNavBar
            view="menu"
            onNavigateView={setCurrentView}
            onOpenFilterSheet={() => setIsFilterSheetOpen(true)}
            activeFilterCount={activeFilterCount}
            onOpenProfile={() => setIsProfileOpen(true)}
            customerToken={customerToken}
            customerDisplayName={customerProfile?.displayName}
            cartPulse={cartPulse}
            cartIconRef={cartIconRef}
            showToast={showToast}
          />

          {/* Active Order Tracker Banner */}
          <OrderTrackerBanner
            style={{ margin: '8px 16px 12px 16px' }}
          />

          {/* Phase 5 Extracted: Main Menu Browsing UI with Category Filters, Search, Dietary Chips, and Category Item Sections */}
          <MenuGrid
            menuItems={menuItems}
            combos={COMBO_OFFERS}
            onSelectItem={handleOpenAccordion}
            onQuickAdd={handleQuickAdd}
            onQuickDecrement={handleQuickDecrement}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
            wishlist={wishlist}
            onToggleWishlist={toggleWishlist}
            filterOptions={{
              filterNorthIndian,
              filterSouthIndian,
              filterHealthy,
              filterAvailableOnly,
            }}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            dietaryFilter={dietaryFilter}
            onDietaryFilterChange={setDietaryFilter}
            sortOption={sortOption}
            onSortOptionChange={setSortOption}
          />
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
          bottom: (isMounted && cartItemCount > 0) ? '84px' : '24px',
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
      {isMounted && cartItemCount > 0 && (
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


      {/* Available Coupons Modal Sheet (Drawer over Cart / Checkout) */}
      {isAvailableCouponsOpen && (
        <div
          className="side-drawer-wrap"
          style={{ zIndex: 120 }}
          onClick={() => setIsAvailableCouponsOpen(false)}
        >
          <div
            className="side-drawer-panel"
            style={{ maxWidth: '440px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="drawer-header" style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div>
                <div className="drawer-title" style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🏷️</span>
                  <span>Available Coupons</span>
                </div>
                <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '2px' }}>
                  Cart Total: <strong style={{ color: '#fbbf24' }}>₹{(cartSubtotalPaise / 100).toFixed(0)}</strong> · Select any eligible coupon
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAvailableCouponsOpen(false)}
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

            <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {AVAILABLE_COUPONS.map((coupon) => {
                const isApplied = appliedCoupon === coupon.code;
                const isEligible = cartSubtotalPaise >= coupon.minOrderPaise;
                const estSavingsPaise = computeCouponDiscountPaise(coupon, cartSubtotalPaise);
                const deficitPaise = coupon.minOrderPaise > cartSubtotalPaise ? coupon.minOrderPaise - cartSubtotalPaise : 0;

                return (
                  <div
                    key={coupon.code}
                    style={{
                      borderRadius: '12px',
                      padding: '14px',
                      border: isApplied
                        ? '1.5px solid #10b981'
                        : isEligible
                        ? '1.5px solid rgba(245, 158, 11, 0.45)'
                        : '1px solid rgba(255, 255, 255, 0.08)',
                      background: isApplied
                        ? 'rgba(16, 185, 129, 0.08)'
                        : isEligible
                        ? 'rgba(245, 158, 11, 0.04)'
                        : 'rgba(255, 255, 255, 0.02)',
                      opacity: isEligible || isApplied ? 1 : 0.72,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span
                          style={{
                            fontFamily: 'monospace',
                            fontWeight: 900,
                            fontSize: '0.92rem',
                            padding: '4px 8px',
                            borderRadius: '6px',
                            background: isApplied ? 'rgba(16, 185, 129, 0.25)' : 'rgba(245, 158, 11, 0.18)',
                            color: isApplied ? '#34d399' : '#fbbf24',
                            border: `1px solid ${isApplied ? '#10b981' : 'rgba(245, 158, 11, 0.4)'}`,
                            letterSpacing: '0.5px',
                          }}
                        >
                          {coupon.code}
                        </span>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            fontWeight: 800,
                            padding: '3px 7px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.08)',
                            color: '#cbd5e1',
                          }}
                        >
                          {coupon.tag}
                        </span>
                      </div>

                      {isApplied ? (
                        <span style={{ color: '#10b981', fontSize: '0.78rem', fontWeight: 800 }}>
                          ✓ Applied
                        </span>
                      ) : isEligible ? (
                        <span style={{ color: '#34d399', fontSize: '0.76rem', fontWeight: 700 }}>
                          ● Eligible
                        </span>
                      ) : (
                        <span style={{ color: '#f59e0b', fontSize: '0.74rem', fontWeight: 700 }}>
                          🔒 Min ₹{(coupon.minOrderPaise / 100).toFixed(0)}
                        </span>
                      )}
                    </div>

                    <div>
                      <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#fff' }}>
                        {coupon.title}
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#94a3b8', marginTop: '2px', lineHeight: 1.4 }}>
                        {coupon.description}
                      </div>
                    </div>

                    {/* Condition / Savings Note */}
                    <div
                      style={{
                        fontSize: '0.74rem',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        background: isApplied
                          ? 'rgba(16, 185, 129, 0.12)'
                          : isEligible
                          ? 'rgba(245, 158, 11, 0.1)'
                          : 'rgba(239, 68, 68, 0.1)',
                        color: isApplied
                          ? '#34d399'
                          : isEligible
                          ? '#fcd34d'
                          : '#fca5a5',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <span>
                        {isApplied
                          ? `Saves ₹${(discountPaise / 100).toFixed(0)} on this order!`
                          : isEligible
                          ? `Eligible! Saves ₹${(estSavingsPaise / 100).toFixed(0)}`
                          : `Add items worth ₹${(deficitPaise / 100).toFixed(0)} more to unlock`}
                      </span>
                      <span style={{ opacity: 0.75, fontSize: '0.7rem' }}>
                        Min ₹{(coupon.minOrderPaise / 100).toFixed(0)}
                      </span>
                    </div>

                    {/* Action Button */}
                    <div>
                      {isApplied ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAppliedCoupon(null);
                            setCouponInput('');
                            setCouponError(null);
                            showToast(`Removed coupon ${coupon.code}`);
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: 'rgba(239, 68, 68, 0.15)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            color: '#f87171',
                            fontWeight: 800,
                            fontSize: '0.78rem',
                            cursor: 'pointer',
                          }}
                        >
                          ✕ Remove Coupon
                        </button>
                      ) : isEligible ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAppliedCoupon(coupon.code);
                            setCouponInput(coupon.code);
                            setCouponError(null);
                            setIsAvailableCouponsOpen(false);
                            showToast(`✅ Applied coupon ${coupon.code}! Saved ₹${(estSavingsPaise / 100).toFixed(0)}`);
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                            border: 'none',
                            color: '#000',
                            fontWeight: 900,
                            fontSize: '0.8rem',
                            cursor: 'pointer',
                            boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                          }}
                        >
                          Apply Coupon (Save ₹{(estSavingsPaise / 100).toFixed(0)})
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          style={{
                            width: '100%',
                            padding: '8px 12px',
                            borderRadius: '8px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                            color: '#64748b',
                            fontWeight: 700,
                            fontSize: '0.76rem',
                            cursor: 'not-allowed',
                          }}
                        >
                          🔒 Add ₹{(deficitPaise / 100).toFixed(0)} more to unlock
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}




      {/* ── Rate & Review Food Items Modal Sheet ── */}
      {reviewingOrder && (
        <div className="filter-sheet-overlay" onClick={() => setReviewingOrder(null)} style={{ zIndex: 130 }}>
          <div
            className="filter-sheet-panel"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxHeight: '85vh',
              overflowY: 'auto',
              background: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '16px 16px 0 0',
              padding: '20px',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff', margin: 0 }}>
                  ⭐ Rate & Review Your Food
                </h3>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>
                  Order #{((reviewingOrder as any).order_number || reviewingOrder.id.slice(0, 8)).toUpperCase()} · Table {selectedTable}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReviewingOrder(null)}
                style={{
                  background: 'rgba(255,255,255,0.08)',
                  border: 'none',
                  color: '#94a3b8',
                  borderRadius: '50%',
                  width: '32px',
                  height: '32px',
                  fontSize: '1rem',
                  cursor: 'pointer',
                }}
              >
                ✕
              </button>
            </div>

            {/* Overall Experience Stars */}
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.03)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '12px',
                padding: '14px',
                marginBottom: '16px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: '0.82rem', color: '#cbd5e1', fontWeight: 700, marginBottom: '8px' }}>
                How was your dining experience?
              </div>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '10px', fontSize: '1.8rem', cursor: 'pointer' }}>
                {[1, 2, 3, 4, 5].map((star) => (
                  <span
                    key={star}
                    onClick={() => setOverallOrderRating(star)}
                    style={{
                      color: star <= overallOrderRating && overallOrderRating > 0 ? '#fbbf24' : '#475569',
                      transition: 'transform 0.15s ease',
                      transform: star <= overallOrderRating && overallOrderRating > 0 ? 'scale(1.1)' : 'scale(1)',
                    }}
                  >
                    ★
                  </span>
                ))}
              </div>
              <div style={{ fontSize: '0.74rem', color: overallOrderRating > 0 ? '#fbbf24' : '#94a3b8', marginTop: '4px', fontWeight: 700 }}>
                {overallOrderRating === 5
                  ? 'Exceptional! 🌟'
                  : overallOrderRating === 4
                  ? 'Very Good! 😊'
                  : overallOrderRating === 3
                  ? 'Good 👍'
                  : overallOrderRating === 2
                  ? 'Fair 😐'
                  : overallOrderRating === 1
                  ? 'Needs Improvement 😞'
                  : 'Tap stars to rate your overall dining experience'}
              </div>
            </div>

            {/* Per-Dish Ratings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '16px' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#f8fafc' }}>
                Served dishes in this order ({reviewingOrder.items.length}):
              </div>
              {reviewingOrder.items.map((item, idx) => {
                const menuItemId = (item as any).menu_item_id || (item as any).itemId || `item-${idx}`;
                const currentRating = dishRatings[menuItemId]?.rating ?? 0;
                const currentReview = dishRatings[menuItemId]?.review || '';
                const matchedMenu = menuItems.find((m) => m.name.toLowerCase() === item.name_snapshot.toLowerCase());

                return (
                  <div
                    key={idx}
                    style={{
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '12px',
                      padding: '12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {matchedMenu?.imageUrl && (
                          <img
                            src={matchedMenu.imageUrl}
                            alt={item.name_snapshot}
                            style={{ width: '36px', height: '36px', borderRadius: '6px', objectFit: 'cover' }}
                          />
                        )}
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#fff' }}>
                            {item.name_snapshot}
                          </div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                            {item.quantity}x · ₹{(((item.unit_price_paise || item.line_total_paise || 0)) / 100).toFixed(0)}
                          </div>
                        </div>
                      </div>
                      {/* Star Rating for Dish */}
                      <div style={{ display: 'flex', gap: '4px', fontSize: '1.3rem', cursor: 'pointer' }}>
                        {[1, 2, 3, 4, 5].map((s) => (
                          <span
                            key={s}
                            onClick={() => {
                              setDishRatings((prev) => ({
                                ...prev,
                                [menuItemId]: {
                                  rating: s,
                                  review: prev[menuItemId]?.review || '',
                                },
                              }));
                            }}
                            style={{ color: s <= currentRating && currentRating > 0 ? '#fbbf24' : '#475569' }}
                          >
                            ★
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* Review text for Dish */}
                    <input
                      type="text"
                      placeholder={`What did you like about ${item.name_snapshot}? (optional)`}
                      value={currentReview}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDishRatings((prev) => ({
                          ...prev,
                          [menuItemId]: {
                            rating: prev[menuItemId]?.rating ?? 0,
                            review: val,
                          },
                        }));
                      }}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: 'rgba(0, 0, 0, 0.4)',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        color: '#fff',
                        fontSize: '0.78rem',
                        marginTop: '4px',
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Quick Review Tags */}
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.78rem', color: '#94a3b8', fontWeight: 600, marginBottom: '6px' }}>
                Highlights:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {['Delicious Food', 'Authentic Flavors', 'Perfect Spice', 'Hot & Fresh', 'Quick Service', 'Great Ambience'].map((tag) => {
                  const isSelected = selectedReviewTags.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => {
                        setSelectedReviewTags((prev) =>
                          isSelected ? prev.filter((t) => t !== tag) : [...prev, tag]
                        );
                      }}
                      style={{
                        background: isSelected ? 'rgba(245, 158, 11, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                        border: isSelected ? '1px solid #f59e0b' : '1px solid rgba(255, 255, 255, 0.1)',
                        color: isSelected ? '#fbbf24' : '#94a3b8',
                        padding: '4px 10px',
                        borderRadius: '999px',
                        fontSize: '0.72rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {tag}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Overall Comments */}
            <div style={{ marginBottom: '18px' }}>
              <textarea
                placeholder="Additional comments or chef feedback (optional)..."
                value={overallOrderComment}
                onChange={(e) => setOverallOrderComment(e.target.value)}
                rows={2}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'rgba(0, 0, 0, 0.4)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  color: '#fff',
                  fontSize: '0.78rem',
                  resize: 'none',
                }}
              />
            </div>

            {/* Submit Button */}
            <button
              type="button"
              disabled={submittingReview}
              onClick={handleSubmitDishReviews}
              style={{
                width: '100%',
                padding: '12px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#000',
                fontWeight: 800,
                fontSize: '0.92rem',
                border: 'none',
                cursor: submittingReview ? 'not-allowed' : 'pointer',
                boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
              }}
            >
              {submittingReview ? 'Submitting Review...' : 'Submit Food Review & Earn Rewards ⭐'}
            </button>
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
              <OrderTrackerBanner
                variant="card"
                onViewOrders={() => {
                  setIsProfileOpen(false);
                  setIsOrdersHistoryOpen(true);
                }}
                alwaysShow
              />

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
                      {msg.proposedCartItems.map((prop, idx) => {
                        const matched = menuItems.find(
                          (m) => m.id === prop.itemId || m.name.toLowerCase() === prop.name.toLowerCase(),
                        );
                        const cartQty = getItemCartQty(matched?.id || prop.itemId);

                        return (
                          <div
                            key={idx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              background: 'rgba(0,0,0,0.3)',
                              padding: '8px 10px',
                              borderRadius: '8px',
                              border: '1px solid rgba(255,255,255,0.1)',
                              gap: '8px',
                            }}
                          >
                            <div style={{ flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: '0.82rem' }}>{prop.name}</div>
                              <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>
                                ₹{(prop.pricePaise / 100).toFixed(0)} {prop.quantity > 1 ? `· Qty: ${prop.quantity}` : ''}
                              </div>
                              {prop.notes && (
                                <div
                                  style={{
                                    display: 'inline-block',
                                    marginTop: '3px',
                                    fontSize: '0.70rem',
                                    color: '#fbbf24',
                                    background: 'rgba(245, 158, 11, 0.15)',
                                    border: '1px solid rgba(245, 158, 11, 0.3)',
                                    borderRadius: '4px',
                                    padding: '1px 6px',
                                    fontWeight: 600,
                                  }}
                                >
                                  📝 {prop.notes}
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              {cartQty > 0 ? (
                                <div className="menu-stepper-wrap" style={{ transform: 'scale(0.85)', margin: 0 }}>
                                  <button onClick={(e) => handleQuickDecrement(matched?.id || prop.itemId, e)}>
                                    −
                                  </button>
                                  <span>{cartQty}</span>
                                  <button
                                    onClick={(e) => {
                                      if (matched) handleQuickAdd(matched, e);
                                      else handleAddProposedItemToCart(prop);
                                    }}
                                  >
                                    +
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleAddProposedItemToCart(prop)}
                                  style={{
                                    background: 'var(--accent-gold)',
                                    color: '#000',
                                    border: 'none',
                                    padding: '5px 12px',
                                    borderRadius: '6px',
                                    fontSize: '0.75rem',
                                    fontWeight: 800,
                                    cursor: 'pointer',
                                    boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
                                  }}
                                >
                                  + Add
                                </button>
                              )}
                              {matched && (
                                <button
                                  type="button"
                                  onClick={() => handleOpenAccordion(matched)}
                                  style={{
                                    background: 'rgba(255, 255, 255, 0.08)',
                                    color: '#cbd5e1',
                                    border: '1px solid rgba(255, 255, 255, 0.16)',
                                    padding: '5px 8px',
                                    borderRadius: '6px',
                                    fontSize: '0.72rem',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title="Customize spice, portion & modifiers"
                                >
                                  ⚙️ Customize
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
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

      {/* ══════════════════════════════════════════════════════════════════════
          EXTRACTED GLOBAL MODALS & DRAWERS (ZUSTAND STORE-DRIVEN)
          ══════════════════════════════════════════════════════════════════════ */}
      {/* 1. Slide-Out Cart Drawer */}
      <CartDrawer
        onPlaceOrder={handlePlaceOrder}
        isPlacingOrder={isPlacingOrder}
        onViewOrders={() => setIsOrdersHistoryOpen(true)}
        flattenedPlatesCount={flattenedPlates.length}
        onBrowseMenu={() => setCurrentView('menu')}
        onOpenAvailableCoupons={() => setIsAvailableCouponsOpen(true)}
        outletTables={outletTables}
        outletTablesLoaded={outletTablesLoaded}
        showToast={showToast}
      />

      {/* 2. Interactive MenuItem Customizer Modal */}
      <ItemCustomizerModal
        item={activeCustomizingItem}
        isOpen={Boolean(activeCustomizingItem)}
        onClose={() => {
          setActiveCustomizingItem(null);
          setExpandedAccordionItemId(null);
        }}
        showToast={showToast}
        onFlyToCart={triggerFlyToCart}
        isWishlisted={activeCustomizingItem ? wishlist.has(activeCustomizingItem.id) : false}
        onToggleWishlist={(e) => {
          if (activeCustomizingItem) toggleWishlist(activeCustomizingItem.id, e);
        }}
        dinerProfiles={dinerProfiles}
      />

      {/* 3. Dine-In Payment Settlement Modal */}
      <DineInCheckoutModal
        onPaymentSuccess={async () => {
          if (activeSessionId) {
            await fetchSessionOrders(activeSessionId);
          }
          setOrdersFilterTab('PREPARING');
          setIsOrdersHistoryOpen(true);
          showToast('Payment confirmed! Kitchen is preparing your dishes 🍳');
        }}
        onPaymentInitiate={handleInitiatePayment}
        onPostponePayment={() => {
          showToast('Payment postponed. All items saved in your cart.');
        }}
        showToast={showToast}
      />

      {/* 4. Active Table Orders History Drawer & Settlement */}
      <OrdersHistoryView
        isOpen={isOrdersHistoryOpen}
        onClose={() => setIsOrdersHistoryOpen(false)}
        sessionOrders={sessionOrders}
        flattenedPlates={flattenedPlates}
        selectedTable={selectedTable}
        onRefreshOrders={async () => {
          if (activeSessionId) {
            await fetchSessionOrders(activeSessionId);
          }
        }}
        onCallWaiter={async (reason) => {
          try {
            await customerApiFetch('/api/v1/customer/session/service-call', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                table_number: selectedTable,
                session_id: activeSessionId,
                reason,
              }),
            });
            showToast(`🔔 Staff notified for Table ${selectedTable} (${reason})`);
          } catch {
            showToast(`🔔 Waiter call registered for Table ${selectedTable}`);
          }
        }}
        onReviewOrder={(order) => openReviewModal(order)}
        onOrderMore={() => setIsOrdersHistoryOpen(false)}
        outletTables={outletTables}
        releasedHoldPlateKeys={releasedHoldPlateKeys}
        onReleaseHold={handleReleaseHold}
        onMoveOrderPlateTable={handleMoveOrderPlateTable}
      />

      {/* 5. Customer Authentication & Profile Modal */}
      <CustomerAuthModal
        onAuthSuccess={applyAuthenticatedCustomer}
      />
    </div>
  );
}
