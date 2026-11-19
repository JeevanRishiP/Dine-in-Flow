'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useOrderStore, computeCouponDiscountPaise } from '../store/useOrderStore';
import type { AvailableCoupon } from '../types';
import { SquareItemCard, FALLBACK_DISH_IMG } from '../components/menu/SquareItemCard';
import { resolveDishImageUrl } from '../components/menu/menu-image.utils';
import { DineInCheckoutModal, DineInBillBreakdown } from '../components/checkout/DineInCheckoutModal';
import { CartDrawer } from '../components/cart/CartDrawer';
import { ItemCustomizerModal } from '../components/modals/ItemCustomizerModal';
import { MenuGrid } from '../components/menu/MenuGrid';
import { DEFAULT_CATEGORIES } from '../components/menu/menu-constants';
import { OrdersHistoryView } from '../components/orders/OrdersHistoryView';
import { CustomerServeLaterModal } from '../components/orders/CustomerServeLaterModal';
import { ServeLaterPromptModal } from '../components/modals/ServeLaterPromptModal';
import {
  flattenPlates,
  filterPlatesByTab,
  deduplicateOrders,
} from '../components/orders/orders-utils';
import { BookingFlowModal } from '../components/booking/BookingFlowModal';
import { CustomerAuthModal } from '../components/modals/CustomerAuthModal';
import { TableModal, getLiveTableValidation as validateLiveTable } from '../components/modals/TableModal';
import { TopNavBar } from '../components/layout/TopNavBar';
import { OrderTrackerBanner } from '../components/layout/OrderTrackerBanner';
import {
  DEFAULT_DEV_OUTLET_ID,
  DEFAULT_DEV_ORG_ID,
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
  order_type?: 'DINE_IN' | 'PRE_BOOK_DINE_IN' | 'TAKEAWAY';
  scheduled_for?: string | null;
  guest_count?: number | null;
  paid_at?: string | null;
  main_course_served_at?: string | null;
  serve_later_prompt_sent_at?: string | null;
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
    course_sequence?: number;
    prep_time_minutes?: number;
    target_fire_at?: string | null;
    hold_status?: 'ACTIVE' | 'SCHEDULED_WAIT' | 'SERVE_LATER_HOLD' | 'RELEASED';
    is_combo_item?: boolean;
    combo_name?: string | null;
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
  courseSequence?: number;
  prepTimeMinutes?: number;
  targetFireAt?: string | null;
  holdStatus?: 'ACTIVE' | 'SCHEDULED_WAIT' | 'SERVE_LATER_HOLD' | 'RELEASED';
  isScheduledWait?: boolean;
  isComboItem?: boolean;
  comboName?: string | null;
  orderType?: string;
  scheduledFor?: string | null;
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
  const [activeCategory, setActiveCategory] = useState<string>('Combos');
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
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [availableCoupons, setAvailableCoupons] = useState<AvailableCoupon[]>([]);

  // Dynamically derived hero slides from live DB coupons and menu items
  const heroSlides = useMemo<HeroSlideItem[]>(() => {
    const slides: HeroSlideItem[] = [];
    if (availableCoupons.length > 0) {
      const topCoupon = availableCoupons[0]!;
      slides.push({
        tag: 'SPECIAL OFFER',
        title: topCoupon.title || `${topCoupon.code} Special`,
        subtitle: topCoupon.description || `Use code ${topCoupon.code}`,
        img: 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80',
        couponCode: topCoupon.code,
        btnText: `Apply ${topCoupon.code} →`,
      });
    }
    const featured = menuItems.filter((m) => m.isAvailable && m.imageUrl).slice(0, 3);
    for (const dish of featured) {
      slides.push({
        tag: dish.category.toUpperCase(),
        title: dish.name,
        subtitle: dish.description || `${dish.name} - freshly prepared`,
        img: dish.imageUrl,
        categoryTarget: dish.category,
        dishTarget: dish.name.toLowerCase(),
        btnText: `Explore ${dish.category} →`,
      });
    }
    return slides;
  }, [availableCoupons, menuItems]);

  // Dynamically derived combo offers from database menu items
  const combos: ComboOffer[] = useMemo(() => {
    return menuItems
      .filter((m) => m.category === 'Combos')
      .map((m) => ({
        id: m.id,
        name: m.name,
        tag: m.dietaryTag === 'VEG' ? '🌿 PURE VEG SPECIAL' : '⚡ CHEF FEAST',
        badge: 'SPECIAL VALUE',
        comboPricePaise: m.pricePaise,
        originalPricePaise: Math.round(m.pricePaise * 1.1),
        savingsPaise: Math.round(m.pricePaise * 0.1),
        discountPercent: 10,
        vegType: m.dietaryTag === 'VEG' ? 'VEG' : 'NON_VEG',
        prepTimeMinutes: m.prepTimeMinutes || 15,
        rating: m.rating || 4.8,
        imageUrl: m.imageUrl,
        description: m.description,
        components: [],
      }));
  }, [menuItems]);

  // Dynamically derived promotional offers from database coupons
  const offersData = useMemo(() => {
    return availableCoupons.map((c) => ({
      id: c.code,
      code: c.code,
      title: c.tag || c.code,
      discountDesc: `On orders above ₹${Math.ceil(c.minOrderPaise / 100)}`,
      validity: 'Valid today on dine-in',
      discountPaise: c.fixedPaise || (c.percent ? c.percent : 0),
    }));
  }, [availableCoupons]);

  const categoriesToDisplay = useMemo(() => {
    const raw = categories.length > 0 ? categories : (DEFAULT_CATEGORIES as unknown as string[]);
    const hasCombos = raw.some((c) => c.toLowerCase() === 'combos');
    if (!hasCombos) return raw;
    const withoutCombos = raw.filter((c) => c.toLowerCase() !== 'combos');
    const combosName = raw.find((c) => c.toLowerCase() === 'combos') || 'Combos';
    return [combosName, ...withoutCombos];
  }, [categories]);

  const fetchLiveCoupons = useCallback(async (outletId?: string, orgId?: string) => {
    try {
      const qs = new URLSearchParams();
      if (outletId) qs.set('outlet_id', outletId);
      if (orgId) qs.set('org_id', orgId);
      const url = qs.toString() ? `/api/v1/public/coupons?${qs.toString()}` : '/api/v1/public/coupons';
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) {
        const mapped: AvailableCoupon[] = data.map((c: any) => {
          const type = (c.type || 'FLAT').toUpperCase() as 'PERCENT' | 'PERCENTAGE' | 'FIXED' | 'FLAT';
          const isPercent = type === 'PERCENT' || type === 'PERCENTAGE';
          const valNum = Number(c.discountValue ?? c.discount_value ?? c.value ?? 0);
          const minPaise = Number(c.minOrderPaise ?? c.min_order_paise ?? 0);
          const maxPaise = c.maxDiscountPaise ?? c.max_discount_paise ? Number(c.maxDiscountPaise ?? c.max_discount_paise) : undefined;
          return {
            id: c.id,
            code: c.code,
            type,
            value: valNum,
            discountValue: valNum,
            percent: isPercent ? (valNum > 100 ? Math.round(valNum / 100) : valNum) : undefined,
            fixedPaise: !isPercent ? valNum : undefined,
            discountPaise: !isPercent ? valNum : 0,
            maxDiscountPaise: maxPaise,
            minOrderPaise: minPaise,
            tag: c.tag || (isPercent ? `${Math.round(valNum / 100)}% OFF` : `₹${Math.round(valNum / 100)} OFF`),
            title: c.title || (isPercent ? `Flat ${Math.round(valNum / 100)}% Off Your Feast` : `₹${Math.round(valNum / 100)} Instant Savings`),
            description: c.description || (minPaise > 0 ? `Valid on orders above ₹${Math.ceil(minPaise / 100)}` : 'No minimum order required'),
            validity: c.validity || 'Valid today on dine-in',
            isActive: c.isActive ?? c.is_active ?? true,
          };
        });
        setAvailableCoupons(mapped);
        useOrderStore.getState().setCoupons(mapped);
      }
    } catch {
      // Keep previous coupons
    }
  }, []);

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

  // Clean released holds cache when session changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem('dineflow_released_holds');
      } catch {}
    }
    setReleasedHoldPlateKeys({});
  }, [activeSessionId]);

  const handleReleaseHold = async (plateKeys: string[], itemName?: string) => {
    // 1. Persist to PostgreSQL database via backend API for each plate's item
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

    let anySuccess = false;
    for (const pair of pairs) {
      const [orderId, itemId] = pair.split('::');
      if (orderId && itemId) {
        try {
          const res = await customerApiFetch(
            `/api/v1/customer/orders/${encodeURIComponent(orderId)}/items/${encodeURIComponent(itemId)}/release-hold`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            },
            { preferToken: loadCustomerAuth() ? 'customer' : 'guest' },
          );
          if (res.ok) {
            anySuccess = true;
          } else {
            const errData = await res.json().catch(() => ({}));
            setToastMessage(errData.detail || errData.message || 'Could not fire dish to kitchen');
            setTimeout(() => setToastMessage(null), 4000);
          }
        } catch (err) {
          console.error('Failed to notify backend of hold release:', err);
          setToastMessage('Network error while firing dish to kitchen. Please retry.');
          setTimeout(() => setToastMessage(null), 4000);
        }
      }
    }

    if (anySuccess) {
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

      // Re-sync live session orders from backend
      if (activeSessionId) {
        await fetchSessionOrders(activeSessionId);
      }
    }
  };

  // ── Smart Kitchen Serve-Later Auto-Prompt State & Actions ──
  const serveLaterDismissedUntil = useOrderStore((s) => s.serveLaterDismissedUntil);
  const setServeLaterDismissedUntil = useOrderStore((s) => s.setServeLaterDismissedUntil);
  const serveLaterPrompt = useOrderStore((s) => s.serveLaterPrompt);
  const setServeLaterPrompt = useOrderStore((s) => s.setServeLaterPrompt);
  const isBookingModalOpen = useOrderStore((s) => s.isBookingModalOpen);
  const setIsBookingModalOpen = useOrderStore((s) => s.setIsBookingModalOpen);
  const storeOrderType = useOrderStore((s) => s.orderType);
  const setOrderType = useOrderStore((s) => s.setOrderType);
  const [serveLaterModalDismissed, setServeLaterModalDismissed] = useState(false);

  const activeServeLaterOrder = useMemo(() => {
    if (serveLaterModalDismissed) return null;
    if (serveLaterDismissedUntil && Date.now() < serveLaterDismissedUntil) {
      return null;
    }

    return sessionOrders.find((ord) => {
      if (ord.payment_status !== 'PAID') return false;
      const hasHeldItems = ord.items.some((it) => {
        const plateKey = `${ord.id}-${it.id}-1`;
        const isReleased =
          Boolean(releasedHoldPlateKeys[plateKey]) ||
          Boolean(it.notes?.includes('[RELEASED_TO_KITCHEN]')) ||
          it.hold_status === 'RELEASED';
        return (
          !isReleased &&
          (it.hold_status === 'SERVE_LATER_HOLD' ||
            (!it.hold_status &&
              isDessertOrPostMealItem(it.name_snapshot, it.notes) &&
              it.status !== 'SERVED' &&
              it.status !== 'CANCELLED'))
        );
      });
      if (!hasHeldItems) return false;

      // Trigger if backend marked prompt sent or main courses served >= 15m
      if (ord.serve_later_prompt_sent_at) return true;
      if (ord.main_course_served_at) {
        const elapsedMs = Date.now() - new Date(ord.main_course_served_at).getTime();
        if (elapsedMs >= 15 * 60 * 1000) return true;
      }
      return false;
    }) ?? null;
  }, [sessionOrders, serveLaterDismissedUntil, serveLaterModalDismissed, releasedHoldPlateKeys]);

  const handleSnoozeServeLater = async (orderId: string, minutes: number = 10) => {
    setServeLaterDismissedUntil(Date.now() + minutes * 60 * 1000);
    try {
      await customerApiFetch(
        `/api/v1/customer/orders/${encodeURIComponent(orderId)}/serve-later/snooze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes }),
        },
        { preferToken: loadCustomerAuth() ? 'customer' : 'guest' },
      );
      showToast(`⏰ Reminding you in ${minutes} minutes. Enjoy your meal!`);
    } catch {
      showToast(`⏰ Snoozed for ${minutes} minutes.`);
    }
  };

  useEffect(() => {
    if (!activeServeLaterOrder) return;
    const itemNames = activeServeLaterOrder.items
      .filter(
        (it) =>
          it.hold_status === 'SERVE_LATER_HOLD' ||
          (!it.hold_status && isDessertOrPostMealItem(it.name_snapshot, it.notes) && it.status !== 'SERVED' && it.status !== 'CANCELLED')
      )
      .map((it) => it.name_snapshot);
    setServeLaterPrompt({
      orderId: activeServeLaterOrder.id,
      itemNames: itemNames.length > 0 ? itemNames : ['Desserts & Beverages'],
      promptedAt: activeServeLaterOrder.serve_later_prompt_sent_at || new Date().toISOString(),
    });
  }, [activeServeLaterOrder, setServeLaterPrompt]);

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
    if (heroSlides.length <= 1) return;
    const timer = setInterval(() => {
      setHeroIndex((prev) => (prev + 1) % heroSlides.length);
    }, 4500);
    return () => clearInterval(timer);
  }, [heroSlides.length]);

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
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
    const devFallbackOutlet = isDev ? DEFAULT_DEV_OUTLET_ID : undefined;
    const targetOutlet = activeOutletId || tenant.outletId || devFallbackOutlet || undefined;
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
      const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
      const devFallbackOutlet = isDev ? DEFAULT_DEV_OUTLET_ID : undefined;
      const targetOutlet = activeOutletId || tenant.outletId || devFallbackOutlet || undefined;
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
      return validateLiveTable(
        digits,
        outletTables,
        outletTablesLoaded,
        activeOutletId,
        (devOutletId) => {
          void loadOutletTablesForTenant(devOutletId, activeSlug);
        },
      );
    },
    [activeOutletId, activeSlug, loadOutletTablesForTenant, outletTables, outletTablesLoaded],
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
      const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
      const devFallbackOutlet = isDev ? DEFAULT_DEV_OUTLET_ID : undefined;
      const targetOutletId = outletIdParam || tenant.outletId || devFallbackOutlet || undefined;
      if (slugParam) setActiveSlug(slugParam);

      // 1. Sync Table Selection immediately when URL params are parsed
      if (tableNumberParam) {
        useOrderStore.getState().setSelectedTable(tableNumberParam);
      }

      if (targetOutletId) {
        useOrderStore.getState().setSessionDetails({
          outletId: targetOutletId,
          orgId: tenant.orgId || (isDev ? DEFAULT_DEV_ORG_ID : ''),
        });
        setActiveOutletId(targetOutletId);
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
        if (remote.session.orgId === 'a0000000-0000-0000-0000-000000000001') {
          clearGuestSession();
          const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
          useOrderStore.getState().setSessionDetails({
            sessionId: '',
            tableId: '',
            orgId: isDev ? DEFAULT_DEV_ORG_ID : '',
            outletId: isDev ? DEFAULT_DEV_OUTLET_ID : '',
          });
          useOrderStore.getState().setSelectedTable('--');
          useOrderStore.getState().setIsTableVerified(false);
        } else {
          applyActiveGuestSession(remote.session, slugParam || undefined);
          void fetchSessionOrders(remote.session.sessionId);
          return;
        }
      }

      if (remote?.dissolved) {
        clearGuestSession();
        const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
        useOrderStore.getState().setSessionDetails({
          sessionId: '',
          tableId: '',
          orgId: isDev ? DEFAULT_DEV_ORG_ID : '',
          outletId: isDev ? DEFAULT_DEV_OUTLET_ID : '',
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
      let orgToFetch = activeOrgId || tenant.orgId;
      let outletToFetch = activeOutletId || tenant.outletId;
      if (orgToFetch === 'a0000000-0000-0000-0000-000000000001') {
        orgToFetch = DEFAULT_DEV_ORG_ID;
        outletToFetch = DEFAULT_DEV_OUTLET_ID;
      }
      if (!orgToFetch) return;

      void fetchLiveCoupons(outletToFetch, orgToFetch);

      try {
        const query = outletToFetch ? `?outlet_id=${encodeURIComponent(outletToFetch)}` : '';
        const res = await fetch(`/api/v1/public/menu/${encodeURIComponent(orgToFetch)}${query}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.items && Array.isArray(data.items)) {
            const catMap: Record<string, string> = {};
            if (Array.isArray(data.categories) && data.categories.length > 0) {
              const catNames = data.categories.map((c: any) => c.name as string);
              setCategories(catNames);
              data.categories.forEach((c: any) => {
                catMap[c.id] = c.name;
              });
            }

            const mapped: MenuItem[] = data.items.map((it: any) => {
              let cat = (it.category_name || catMap[it.category_id] || 'Main Course') as any;
              if (cat === 'Biryani' || cat === 'Rice & Biryani' || cat === 'Rice') {
                cat = 'Biryani & Rice';
              }
              const isNonSpicyCat = cat === 'Desserts' || cat === 'Beverages' || cat === 'Breads';
              let derivedSpice: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE' = 'NONE';
              if (!isNonSpicyCat) {
                if (it.spice_level !== undefined && it.spice_level !== null) {
                  derivedSpice = it.spice_level === 0 ? 'NONE' : it.spice_level > 1 ? 'HOT' : 'MEDIUM';
                } else {
                  derivedSpice = 'MILD';
                }
              }

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
                        id: mg.group_id || mg.id,
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
                          groupId: mg.group_id || mg.id,
                          groupName: grpName,
                        })),
                      };
                    })
                  : [];

              const liveModifiers: ModifierOption[] =
                liveModifierGroups.length > 0
                  ? liveModifierGroups.flatMap((g) => g.modifiers)
                  : [];

              const rawDbImageUrl =
                typeof it.image_url === 'string' && it.image_url.trim().length > 0
                  ? it.image_url.trim()
                  : null;
              const resolvedImage = rawDbImageUrl ? resolveDishImageUrl(rawDbImageUrl) : '';

              const desc =
                it.description ||
                (it.description_i18n
                  ? it.description_i18n.en || Object.values(it.description_i18n)[0]
                  : '') ||
                '';

              return {
                id: it.id,
                name: it.name,
                description: typeof desc === 'string' ? desc : '',
                category: cat,
                pricePaise: Number(it.price_paise),
                dietaryTag: it.veg_type === 'VEG' ? 'VEG' : it.veg_type === 'EGG' ? 'EGG' : 'NON_VEG',
                spiceLevel: derivedSpice,
                cuisine: it.cuisine || 'NORTH_INDIAN',
                isHealthy: Boolean(it.is_healthy),
                isAvailable: it.is_available !== false,
                rating:
                  it.rating !== undefined && it.rating !== null
                    ? parseFloat(it.rating)
                    : 4.8,
                ordersCount:
                  it.orders_count !== undefined && it.orders_count !== null
                    ? Number(it.orders_count)
                    : 0,
                prepTimeMinutes:
                  it.prep_time_min !== undefined && it.prep_time_min !== null
                    ? Number(it.prep_time_min)
                    : 15,
                imageUrl: resolvedImage,
                modifiers: liveModifiers,
                modifierGroups: liveModifierGroups,
              };
            });

            setMenuItems(mapped);
          }
        }
      } catch {
        // Keep current live menu on network error
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
          setSessionOrders(deduplicateOrders(data));
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
    const found = availableCoupons.find((c) => c.code.toUpperCase() === appliedCoupon.toUpperCase());
    if (found) {
      return computeCouponDiscountPaise(found, cartSubtotalPaise);
    }
    return 0;
  }, [appliedCoupon, availableCoupons, cartSubtotalPaise]);

  const netSubtotalPaise = Math.max(0, cartSubtotalPaise - discountPaise);
  const gstPaise = Math.round(netSubtotalPaise * 0.05);
  const cartGrandTotalPaise = netSubtotalPaise + gstPaise;

  // ── Flatten Session Orders into Individual Plates with Customisations & Note to Kitchen ──
  // Rule: Only PAID orders are visible in this section. If an order is not paid, it remains in the cart only.
  const flattenedPlates: FlattenedPlateItem[] = useMemo(() => {
    return flattenPlates(sessionOrders, selectedTable, releasedHoldPlateKeys);
  }, [sessionOrders, selectedTable, releasedHoldPlateKeys]);

  // Keep Zustand store activeOrderCount in sync with flattened active plates
  useEffect(() => {
    useOrderStore.getState().setActiveOrderCount(flattenedPlates.length);
  }, [flattenedPlates.length]);

  // Four distinct order sections: PREPARING (Cooking), ON_HOLD (Serve Later), SERVED, CANCELLED
  const onHoldPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'ON_HOLD'),
    [flattenedPlates],
  );

  const preparingPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'PREPARING'),
    [flattenedPlates],
  );

  const servedPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'SERVED'),
    [flattenedPlates],
  );

  const cancelledPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'CANCELLED'),
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
    if (item.category === 'Combos' || combos.some((c) => c.id === item.id)) {
      const combo = combos.find((c) => c.id === item.id);
      if (combo && combo.components && combo.components.length > 0) {
        openComboCustomizer(combo);
        return;
      }
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

    // Find live matching MenuItem from menuItems
    const matchingItem =
      menuItems.find((m) => m.id === activeComboOffer.id) || {
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
        ordersCount: 50,
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

  // Apply Coupon (database-validated with customer auth requirement)
  const handleApplyCoupon = async (code: string, overrideToken?: string, overrideCustomerId?: string) => {
    const trimmed = (code || '').trim().toUpperCase();
    if (!trimmed) {
      setCouponError('Please enter a coupon code.');
      return;
    }
    const tenant = resolveTenantIds(loadGuestSession());
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
    const targetOutlet = activeOutletId || tenant.outletId || (isDev ? DEFAULT_DEV_OUTLET_ID : '');

    const token = overrideToken || customerToken || loadCustomerAuth()?.accessToken;
    const cid = overrideCustomerId || customerId || loadCustomerAuth()?.customerId;

    // Requirement 2: Must be authenticated to apply coupons
    if (!token) {
      useOrderStore.getState().setPendingCouponCode(trimmed);
      useOrderStore.getState().setIsAuthModalOpen(true);
      setCouponError(`Log in or sign up to apply coupon ${trimmed}`);
      showToast(`Please log in or sign up to apply coupon ${trimmed}`);
      return;
    }

    try {
      const res = await fetch('/api/v1/customer/coupons/apply', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          code: trimmed,
          subtotalPaise: cartSubtotalPaise,
          outletId: targetOutlet,
          customerId: cid,
        }),
      });

      if (res.status === 401) {
        useOrderStore.getState().setPendingCouponCode(trimmed);
        useOrderStore.getState().setIsAuthModalOpen(true);
        setCouponError(`Please log in or sign up to apply coupon ${trimmed}`);
        showToast('Please log in or sign up to apply coupons');
        return;
      }

      const data = await res.json();
      if (!res.ok || !data.valid) {
        setCouponError(data.reason || data.detail || `Coupon code "${trimmed}" is not valid.`);
        setAppliedCoupon(null);
        useOrderStore.getState().setAppliedCouponDiscountPaise(null);
        return;
      }

      setCouponError(null);
      setAppliedCoupon(trimmed);
      setCouponInput(trimmed);
      useOrderStore.getState().setAppliedCouponDiscountPaise(data.discountPaise);
      showToast(`Coupon ${trimmed} applied! Saved ₹${Math.round(data.discountPaise / 100)} 🎉`);
    } catch (err: any) {
      setCouponError(err?.message || `Failed to apply coupon ${trimmed}`);
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
      const currentOrderType = useOrderStore.getState().orderType;
      const isTakeaway = currentOrderType === 'TAKEAWAY';
      const isPreBook = currentOrderType === 'PRE_BOOK_DINE_IN';
      const allocatedTables = useOrderStore.getState().allocatedTableNumbers;

      const tenant = resolveTenantIds(guestSession);
      const targetOutlet = activeOutletId || tenant.outletId || undefined;

      if (isTakeaway || (isPreBook && allocatedTables.length > 0)) {
        const tableNum = (isPreBook && allocatedTables[0]) ? allocatedTables[0] : (outletTables[0]?.table_number || 'T01');
        const created = await establishManualTableSession(
          targetOutlet,
          tableNum,
          useOrderStore.getState().guestCount || tablePax,
        );
        if (!created) return;
        guestSession = created;
        currentSessionId = created.sessionId;
      } else {
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
    }

    setIsPlacingOrder(true);
    useOrderStore.getState().resetCheckoutState();

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

      const storeOrderType = useOrderStore.getState().orderType;
      const storeScheduledFor = useOrderStore.getState().scheduledFor;
      const storeGuestCount = useOrderStore.getState().guestCount;
      const storeReservationId = useOrderStore.getState().reservationId;

      const orderBody = {
        session_id: currentSessionId,
        idempotency_key: crypto.randomUUID(),
        items: itemsPayload,
        order_type: storeOrderType || 'DINE_IN',
        scheduled_for: storeScheduledFor || null,
        guest_count: storeGuestCount || tablePax || null,
        reservation_id: storeReservationId || null,
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
        if (orderData && orderData.id) {
          setSessionOrders((prev) => deduplicateOrders([orderData, ...prev]));
        }

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

    // Auto-apply pending coupon upon successful login/signup
    const pendingCode = useOrderStore.getState().pendingCouponCode;
    if (pendingCode) {
      useOrderStore.getState().setPendingCouponCode(null);
      void handleApplyCoupon(pendingCode, data.accessToken, data.customerId);
    }

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
    useOrderStore.getState().resetCheckoutState();
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
  const handleHeroAction = (slide: HeroSlideItem) => {
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
            onOpenBookingModal={() => setIsBookingModalOpen(true)}
            customerToken={customerToken}
            customerDisplayName={customerProfile?.displayName}
            cartPulse={cartPulse}
            cartIconRef={cartIconRef}
            showToast={showToast}
          />

          {/* Omnichannel Ordering Mode Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
              margin: '10px 0 14px',
              padding: '4px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (storeOrderType !== 'DINE_IN') {
                  setOrderType('DINE_IN');
                }
                setIsTableModalOpen(true);
              }}
              style={{
                padding: '8px 4px',
                borderRadius: '8px',
                border: storeOrderType === 'DINE_IN' ? '1px solid rgba(16, 185, 129, 0.5)' : 'none',
                background: storeOrderType === 'DINE_IN' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                color: storeOrderType === 'DINE_IN' ? '#34d399' : '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={selectedTable ? `Table ${selectedTable}` : 'Select Table'}
            >
              <span>🪑</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedTable ? `Dine-In · Table ${selectedTable} ▾` : 'Dine-In · Select Table ▾'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsBookingModalOpen(true)}
              style={{
                padding: '8px 4px',
                borderRadius: '8px',
                border: storeOrderType === 'PRE_BOOK_DINE_IN' ? '1px solid rgba(251, 191, 36, 0.5)' : 'none',
                background: storeOrderType === 'PRE_BOOK_DINE_IN' ? 'rgba(251, 191, 36, 0.15)' : 'transparent',
                color: storeOrderType === 'PRE_BOOK_DINE_IN' ? '#fbbf24' : '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <span>📅</span>
              <span>Pre-Book</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBookingModalOpen(true)}
              style={{
                padding: '8px 4px',
                borderRadius: '8px',
                border: storeOrderType === 'TAKEAWAY' ? '1px solid rgba(56, 189, 248, 0.5)' : 'none',
                background: storeOrderType === 'TAKEAWAY' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: storeOrderType === 'TAKEAWAY' ? '#38bdf8' : '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <span>🛍️</span>
              <span>Takeaway</span>
            </button>
          </div>

          {/* Active Order Tracker Banner */}
          <OrderTrackerBanner />

          {/* 2. Hero Section (Auto-rotating Banner Carousel) */}
          {heroSlides.length > 0 && (
            <>
              <div className="hero-carousel-container">
                <div className="hero-slide-wrapper">
                  {(() => {
                    const currentSlide = heroSlides[heroIndex % heroSlides.length]!;
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
                    <span className="hero-slide-tag">{heroSlides[heroIndex % heroSlides.length]!.tag}</span>
                    <h1 className="hero-slide-title">{heroSlides[heroIndex % heroSlides.length]!.title}</h1>
                    <p className="hero-slide-subtitle">{heroSlides[heroIndex % heroSlides.length]!.subtitle}</p>
                    <button
                      className="hero-action-btn"
                      onClick={() => handleHeroAction(heroSlides[heroIndex % heroSlides.length]!)}
                    >
                      {heroSlides[heroIndex % heroSlides.length]!.btnText}
                    </button>
                  </div>
                </div>
              </div>

              {/* Dots Indicator */}
              <div className="hero-dots-container">
                {heroSlides.map((_, idx) => (
                  <div
                    key={idx}
                    className={`hero-dot ${idx === (heroIndex % heroSlides.length) ? 'active' : ''}`}
                    onClick={() => setHeroIndex(idx)}
                  />
                ))}
              </div>
            </>
          )}

          {/* 3. Offers and Coupons */}
          <section className="home-section">
            <div className="home-section-header">
              <div className="section-title-wrap">
                <span style={{ fontSize: '1.1rem' }}>🏷️</span>
                <h2 className="section-heading">Offers & Coupons</h2>
              </div>
              {offersData.length > 0 && (
                <button
                  className="section-see-all-btn"
                  onClick={() => toggleSectionExpand('offers')}
                >
                  <span>{expandedSection === 'offers' ? 'Show less ▲' : 'See all →'}</span>
                </button>
              )}
            </div>

            {offersData.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: '0.9rem',
                  fontStyle: 'italic',
                }}
              >
                No active offers right now
              </div>
            ) : expandedSection === 'offers' ? (
              <div
                className="home-expanded-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: '14px',
                  width: '100%',
                }}
              >
                {offersData.map((off) => (
                  <div
                    key={off.id}
                    className="offer-coupon-card"
                    style={{
                      maxWidth: '100%',
                      minWidth: 0,
                      width: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div>
                      <div className="offer-card-badge">{off.validity}</div>
                      <div className="offer-card-title">{off.title}</div>
                      <div className="offer-card-desc">{off.discountDesc}</div>
                    </div>
                    <div
                      className="offer-card-footer"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '10px',
                        flexWrap: 'wrap',
                        marginTop: '12px',
                      }}
                    >
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
                {offersData.map((off) => (
                  <div key={off.id} className="offer-coupon-card">
                    <div>
                      <div className="offer-card-badge">{off.validity}</div>
                      <div className="offer-card-title">{off.title}</div>
                      <div className="offer-card-desc">{off.discountDesc}</div>
                    </div>
                    <div
                      className="offer-card-footer"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap',
                        marginTop: '12px',
                      }}
                    >
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
              {combos.map((combo) => {
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
              {categoriesToDisplay.map((cat) => (
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
            onOpenBookingModal={() => setIsBookingModalOpen(true)}
            activeFilterCount={activeFilterCount}
            onOpenProfile={() => setIsProfileOpen(true)}
            customerToken={customerToken}
            customerDisplayName={customerProfile?.displayName}
            cartPulse={cartPulse}
            cartIconRef={cartIconRef}
            showToast={showToast}
          />

          {/* Omnichannel Ordering Mode Bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '6px',
              margin: '8px 16px 12px 16px',
              padding: '4px',
              background: 'rgba(255, 255, 255, 0.03)',
              borderRadius: '12px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <button
              type="button"
              onClick={() => {
                if (storeOrderType !== 'DINE_IN') {
                  setOrderType('DINE_IN');
                }
                setIsTableModalOpen(true);
              }}
              style={{
                padding: '8px 4px',
                borderRadius: '8px',
                border: storeOrderType === 'DINE_IN' ? '1px solid rgba(16, 185, 129, 0.5)' : 'none',
                background: storeOrderType === 'DINE_IN' ? 'rgba(16, 185, 129, 0.15)' : 'transparent',
                color: storeOrderType === 'DINE_IN' ? '#34d399' : '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={selectedTable ? `Table ${selectedTable}` : 'Select Table'}
            >
              <span>🪑</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {selectedTable ? `Dine-In · Table ${selectedTable} ▾` : 'Dine-In · Select Table ▾'}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setIsBookingModalOpen(true)}
              style={{
                padding: '8px 4px',
                borderRadius: '8px',
                border: storeOrderType === 'PRE_BOOK_DINE_IN' ? '1px solid rgba(251, 191, 36, 0.5)' : 'none',
                background: storeOrderType === 'PRE_BOOK_DINE_IN' ? 'rgba(251, 191, 36, 0.15)' : 'transparent',
                color: storeOrderType === 'PRE_BOOK_DINE_IN' ? '#fbbf24' : '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <span>📅</span>
              <span>Pre-Book</span>
            </button>
            <button
              type="button"
              onClick={() => setIsBookingModalOpen(true)}
              style={{
                padding: '8px 4px',
                borderRadius: '8px',
                border: storeOrderType === 'TAKEAWAY' ? '1px solid rgba(56, 189, 248, 0.5)' : 'none',
                background: storeOrderType === 'TAKEAWAY' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                color: storeOrderType === 'TAKEAWAY' ? '#38bdf8' : '#94a3b8',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
              }}
            >
              <span>🛍️</span>
              <span>Takeaway</span>
            </button>
          </div>

          {/* Active Order Tracker Banner */}
          <OrderTrackerBanner
            style={{ margin: '8px 16px 12px 16px' }}
          />

          {/* Phase 5 Extracted: Main Menu Browsing UI with Category Filters, Search, Dietary Chips, and Category Item Sections */}
          <MenuGrid
            menuItems={menuItems}
            combos={combos}
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
              {availableCoupons.length === 0 ? (
                <div style={{ padding: '32px 16px', textAlign: 'center', color: '#94a3b8', fontStyle: 'italic', fontSize: '0.9rem' }}>
                  No active offers right now
                </div>
              ) : (
                availableCoupons.map((coupon) => {
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
                              useOrderStore.getState().setAppliedCouponDiscountPaise(null);
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
                              setIsAvailableCouponsOpen(false);
                              void handleApplyCoupon(coupon.code);
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
                })
              )}
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
      <TableModal
        isOpen={isTableModalOpen}
        onClose={closeTopTableDrawer}
        outletTables={outletTables}
        outletTablesLoaded={outletTablesLoaded}
        activeOutletId={activeOutletId}
        onLoadTables={loadOutletTablesForTenant}
        showToast={showToast}
        activeSlug={activeSlug}
        onTableConfirmed={(session) => {
          void fetchSessionOrders(session.sessionId);
        }}
      />


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
                        menuItems.find((m) => m.id === expandedAccordionItemId);
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
        onApplyCoupon={handleApplyCoupon}
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
          setSessionOrders((prev) => prev.filter((o) => o.payment_status === 'PAID' || o.payment_method === 'CASH_APPROVED'));
          showToast('Payment not completed — your order was NOT sent to the kitchen. Items remain saved in your cart.');
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

      {/* 5. Smart Kitchen Serve-Later Auto-Prompt Dialog */}
      <ServeLaterPromptModal
        isOpen={activeServeLaterOrder !== null || serveLaterPrompt !== null}
        order={activeServeLaterOrder}
        onClose={() => {
          setServeLaterModalDismissed(true);
          setServeLaterPrompt(null);
        }}
        showToast={showToast}
        onRefreshOrders={async () => {
          if (activeSessionId) {
            await fetchSessionOrders(activeSessionId);
          }
        }}
      />

      {/* 6. Customer Authentication & Profile Modal */}
      <CustomerAuthModal
        onAuthSuccess={applyAuthenticatedCustomer}
      />

      {/* 7. Omnichannel Booking Flow Modal (Pre-Book / Takeaway / Dine-In) */}
      <BookingFlowModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        outletId={activeOutletId}
        showToast={showToast}
        onNavigateMenu={() => setCurrentView('menu')}
      />
    </div>
  );
}
