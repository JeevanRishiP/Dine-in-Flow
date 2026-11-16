// ============================================================================
// Core Domain Models & Types for Customer Web
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

export interface AvailableCoupon {
  code: string;
  tag: string;
  title: string;
  description: string;
  minOrderPaise: number;
  type: 'PERCENT' | 'FIXED';
  percent?: number;
  fixedPaise?: number;
}

export type ActiveModalType =
  | 'cart'
  | 'table'
  | 'auth'
  | 'profile'
  | 'orders'
  | 'filter'
  | 'coupons'
  | 'customizer'
  | 'combo'
  | 'payment'
  | null;

// ============================================================================
// Orders & Plate Tracking Models
// ============================================================================

export interface TableOrderItemModifier {
  modifier_id?: string;
  name: string;
  price_paise: number;
}

export interface TableOrderItemRecord {
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
  modifiers?: TableOrderItemModifier[];
}

export interface TableOrderRecord {
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
  items: TableOrderItemRecord[];
}

export interface FlattenedPlateItem {
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

