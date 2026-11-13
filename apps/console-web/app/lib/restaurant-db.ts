/**
 * DineFlow Operational Restaurant Database
 * Sourced directly from seed_full_restaurant.sql
 * 
 * Organization: Royal Spice Bistro Group (a0000000-0000-0000-0000-000000000001)
 * Outlets:
 *  - Branch 1: Royal Spice Flagship, Indiranagar (b0000000-0000-0000-0000-000000000001) - FULLY POPULATED
 *  - Branch 2: Royal Spice, Koramangala (b0000000-0000-0000-0000-000000000002) - BLANK CHILD TABLES
 *  - Branch 3: Royal Spice, Whitefield (b0000000-0000-0000-0000-000000000003) - BLANK CHILD TABLES
 */

export interface Outlet {
  id: string;
  orgId: string;
  name: string;
  shortName: string;
  address: string;
  timezone: string;
  isActive: boolean;
}

export interface StaffMember {
  id: string;
  orgId: string;
  name: string;
  email: string;
  username?: string;
  phone: string;
  role: 'OWNER' | 'MANAGER' | 'CAPTAIN' | 'KITCHEN' | 'CASHIER' | 'WAITER';
  avatar: string;
  outletId: string | null;
  isActive: boolean;
  mfaEnrolled?: boolean;
}

export interface MenuItem {
  id: string;
  categoryId: string;
  categoryName: string;
  name: string;
  nameHindi: string;
  description: string;
  pricePaise: number;
  vegType: 'VEG' | 'NON_VEG' | 'VEGAN';
  allergens: string[];
  spiceLevel: number; // 0 = mild, 1 = medium, 2 = spicy, 3 = very spicy
  isAvailable: boolean;
  isActive: boolean;
  sortOrder: number;
  prepTimeMin: number;
  calories: number;
  stockCount?: number;
  allowHalfPortion?: boolean;
  halfPricePaise?: number;
}

export interface DinerProfile {
  id: string;
  orgId: string;
  customerId?: string;
  name: string;
  relationshipTag?: string;
  spicePreference: 'MILD' | 'MEDIUM' | 'HOT' | 'NONE';
  dietaryPreference: 'ANY' | 'VEG' | 'NON_VEG' | 'JAIN' | 'VEGAN';
  kitchenInstructions: string[];
  notes?: string;
  preferences?: Record<string, any>;
}

export interface MenuCategory {
  id: string;
  name: string;
  nameHindi: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Table {
  id: string;
  number: string;
  capacity: number;
  section: 'Main Dining Hall' | 'Verandah / Terrace' | 'Family Lounge';
  qrTokenVersion: number;
  isActive: boolean;
  x: number;
  y: number;
}

export interface TableSession {
  id: string;
  tableId: string;
  tableNumber: string;
  status: 'OPEN' | 'CLOSED';
  guestCount: number;
  openedAt: string;
  closedAt: string | null;
  activeOrderId?: string;
  tableCode: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  itemId: string;
  name: string;
  pricePaise: number;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';
  notes?: string;
  targetTableNumber?: string | null;
  createdAt?: string;
}

export interface OrderEvent {
  id: string;
  orderId: string;
  previousStatus: string;
  newStatus: string;
  actorName: string;
  createdAt: string;
}

export interface Order {
  id: string;
  displayId: string;
  outletId: string;
  tableNumber: string;
  sessionId: string;
  status: 'PENDING_APPROVAL' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'SERVED' | 'BILLED' | 'CANCELLED';
  subtotalPaise: number;
  taxPaise: number;
  discountPaise: number;
  totalPaise: number;
  createdAt: string;
  items: OrderItem[];
  events: OrderEvent[];
  unverifiedGuest?: boolean;
  needsAck?: boolean;
  paymentMethod?: 'UPI' | 'CARD' | 'CASH' | 'DIRECT_UPI_STAFF';
  customerName?: string;
  specialInstructions?: string;
}

export interface Payment {
  id: string;
  orderId: string;
  displayId: string;
  tableNumber: string;
  method: 'UPI' | 'CARD' | 'CASH' | 'DIRECT_UPI_STAFF';
  status: 'PAID' | 'REFUNDED' | 'FAILED';
  amountPaise: number;
  gatewayFeePaise: number;
  netDepositedPaise: number;
  timestamp: string;
  customerName: string;
}

export interface Invoice {
  id: string;
  orderId: string;
  invoiceNumber: string;
  sellerGstin: string;
  buyerName: string;
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalPaise: number;
  issuedAt: string;
  tableNumber: string;
  paymentMethod: string;
}

export interface DailyRollup {
  id: string;
  date: string;
  orderCount: number;
  grossSalesPaise: number;
  taxPaise: number;
  discountPaise: number;
  netSalesPaise: number;
  tipPaise: number;
}

export interface HourlyRollup {
  hour: number;
  hourLabel: string;
  orderCount: number;
  grossSalesPaise: number;
}

export interface Coupon {
  id: string;
  code: string;
  discountType: 'FLAT' | 'PERCENTAGE';
  discountValue: number;
  maxDiscountPaise: number;
  minOrderPaise: number;
  isActive: boolean;
  usedCount: number;
}

export interface FeedbackReview {
  id: string;
  tableNumber: string;
  rating: number;
  tags: string[];
  comments: string;
  resolutionNotes: string | null;
  customerName: string;
  createdAt: string;
  isResolved: boolean;
}

export interface ServiceCall {
  id: string;
  table: string;
  timestamp: number;
  reason: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'RESOLVED';
}

// -----------------------------------------------------------------------------
// CONSTANT MASTER DATA
// -----------------------------------------------------------------------------

export const ORGANIZATION = {
  id: '7762b6af-d052-4e74-b917-39e3c56e7914',
  name: 'Royal Spice Bistro Group',
  slug: 'royal-spice-bistro',
  currency: 'INR',
  currencySymbol: '₹',
  plan: 'pro',
  timezone: 'Asia/Kolkata',
  gstin: '29AAAAA0000A1Z5',
  fssai: '11223344556677',
};

export const OUTLETS: Outlet[] = [
  {
    id: '71ad00a6-d79b-4035-b563-bf9543fcfa86',
    orgId: ORGANIZATION.id,
    name: 'Royal Spice Flagship, Indiranagar',
    shortName: 'Indiranagar Flagship',
    address: '100ft Road, Indiranagar, Bengaluru, KA 560038',
    timezone: 'Asia/Kolkata',
    isActive: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000002',
    orgId: ORGANIZATION.id,
    name: 'Royal Spice, Koramangala',
    shortName: 'Koramangala Hub',
    address: '80ft Road, 4th Block, Koramangala, Bengaluru, KA 560034',
    timezone: 'Asia/Kolkata',
    isActive: true,
  },
  {
    id: 'b0000000-0000-0000-0000-000000000003',
    orgId: ORGANIZATION.id,
    name: 'Royal Spice, Whitefield',
    shortName: 'Whitefield Center',
    address: 'ITPL Main Road, Whitefield, Bengaluru, KA 560066',
    timezone: 'Asia/Kolkata',
    isActive: true,
  },
];

export const ALL_STAFF_MEMBERS: StaffMember[] = [
  {
    id: 'c0000000-0000-0000-0000-000000000001',
    orgId: ORGANIZATION.id,
    name: 'Vikram Malhotra',
    email: 'owner@royalspice.in',
    username: 'owner',
    phone: '+919876543101',
    role: 'OWNER',
    avatar: '👔',
    outletId: null, // Org-wide access
    isActive: true,
    mfaEnrolled: true,
  },
  {
    id: 'c0000000-0000-0000-0000-000000000002',
    orgId: ORGANIZATION.id,
    name: 'Anand Joshi',
    email: 'manager@royalspice.in',
    username: 'manager',
    phone: '+919876543102',
    role: 'MANAGER',
    avatar: '📋',
    outletId: '71ad00a6-d79b-4035-b563-bf9543fcfa86',
    isActive: true,
    mfaEnrolled: true,
  },
  {
    id: 'c0000000-0000-0000-0000-000000000003',
    orgId: ORGANIZATION.id,
    name: 'Rajesh Sharma',
    email: 'rajesh.captain@royalspice.in',
    username: 'captain',
    phone: '+919876543103',
    role: 'CAPTAIN',
    avatar: '👨‍💼',
    outletId: '71ad00a6-d79b-4035-b563-bf9543fcfa86',
    isActive: true,
  },
  {
    id: 'c0000000-0000-0000-0000-000000000004',
    orgId: ORGANIZATION.id,
    name: 'Chef Amit Roy',
    email: 'chef.amit@royalspice.in',
    username: 'kitchen',
    phone: '+919876543104',
    role: 'KITCHEN',
    avatar: '👨‍🍳',
    outletId: '71ad00a6-d79b-4035-b563-bf9543fcfa86',
    isActive: true,
  },
  {
    id: 'c0000000-0000-0000-0000-000000000005',
    orgId: ORGANIZATION.id,
    name: 'Pooja Iyer',
    email: 'pooja.cashier@royalspice.in',
    username: 'cashier',
    phone: '+919876543105',
    role: 'CASHIER',
    avatar: '👩‍💼',
    outletId: '71ad00a6-d79b-4035-b563-bf9543fcfa86',
    isActive: true,
  },
  {
    id: 'c0000000-0000-0000-0000-000000000006',
    orgId: ORGANIZATION.id,
    name: 'Suresh Kumar',
    email: 'suresh.waiter@royalspice.in',
    username: 'waiter',
    phone: '+919876543106',
    role: 'WAITER',
    avatar: '🤵',
    outletId: '71ad00a6-d79b-4035-b563-bf9543fcfa86',
    isActive: true,
  },
];

// Branch 1 Menu Categories
export const BRANCH_1_CATEGORIES: MenuCategory[] = [
  { id: 'd0000000-0000-0000-0000-000000000001', name: 'Starters', nameHindi: 'शुरुआती व्यंजन', sortOrder: 1, isActive: true },
  { id: 'd0000000-0000-0000-0000-000000000002', name: 'Main Course', nameHindi: 'मुख्य व्यंजन', sortOrder: 2, isActive: true },
  { id: 'd0000000-0000-0000-0000-000000000003', name: 'Biryani & Rice', nameHindi: 'बिरयानी और चावल', sortOrder: 3, isActive: true },
  { id: 'd0000000-0000-0000-0000-000000000004', name: 'Breads', nameHindi: 'रोटी और नान', sortOrder: 4, isActive: true },
  { id: 'd0000000-0000-0000-0000-000000000005', name: 'Desserts', nameHindi: 'मिठाइयाँ', sortOrder: 5, isActive: true },
  { id: 'd0000000-0000-0000-0000-000000000006', name: 'Beverages', nameHindi: 'पेय पदार्थ', sortOrder: 6, isActive: true },
];

// Branch 1 Menu Items (All 17 items from SQL)
export const BRANCH_1_MENU_ITEMS: MenuItem[] = [
  // Starters
  {
    id: 'f0000000-0000-0000-0000-000000000001',
    categoryId: 'd0000000-0000-0000-0000-000000000001',
    categoryName: 'Starters',
    name: 'Paneer Tikka Charcoal Char',
    nameHindi: 'पनीर टिक्का चारकोल चार',
    description: 'Smoky clay oven roasted cottage cheese with bell peppers and house blend masala.',
    pricePaise: 34000,
    vegType: 'VEG',
    allergens: ['DAIRY'],
    spiceLevel: 2,
    isAvailable: true,
    isActive: true,
    sortOrder: 1,
    prepTimeMin: 15,
    calories: 320,
    stockCount: 16,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000002',
    categoryId: 'd0000000-0000-0000-0000-000000000001',
    categoryName: 'Starters',
    name: 'Mutton Galouti Kebab',
    nameHindi: 'मटन गलौटी कबाब',
    description: 'Melt-in-mouth minced lamb delicacies flavored with royal Lucknowi spices.',
    pricePaise: 42000,
    vegType: 'NON_VEG',
    allergens: ['DAIRY'],
    spiceLevel: 2,
    isAvailable: true,
    isActive: true,
    sortOrder: 2,
    prepTimeMin: 20,
    calories: 410,
    stockCount: 12,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000003',
    categoryId: 'd0000000-0000-0000-0000-000000000001',
    categoryName: 'Starters',
    name: 'Crispy Corn & Spinach',
    nameHindi: 'क्रिस्पी कॉर्न और पालक',
    description: 'Crunchy corn kernels tossed with fresh baby spinach, salt, pepper and lemon.',
    pricePaise: 26000,
    vegType: 'VEGAN',
    allergens: [],
    spiceLevel: 1,
    isAvailable: true,
    isActive: true,
    sortOrder: 3,
    prepTimeMin: 10,
    calories: 200,
    stockCount: 25,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000004',
    categoryId: 'd0000000-0000-0000-0000-000000000001',
    categoryName: 'Starters',
    name: 'Amritsari Fish Tikka',
    nameHindi: 'अमृतसरी फिश टिक्का',
    description: 'Gram flour coated deep fried fish chunks seasoned with carom seeds.',
    pricePaise: 39000,
    vegType: 'NON_VEG',
    allergens: ['FISH'],
    spiceLevel: 2,
    isAvailable: false, // Currently marked 86 out of stock
    isActive: true,
    sortOrder: 4,
    prepTimeMin: 15,
    calories: 290,
    stockCount: 0,
  },

  // Main Course
  {
    id: 'f0000000-0000-0000-0000-000000000005',
    categoryId: 'd0000000-0000-0000-0000-000000000002',
    categoryName: 'Main Course',
    name: 'Old Delhi Butter Chicken',
    nameHindi: 'पुरानी दिल्ली बटर चिकन',
    description: 'Classic creamy tomato chicken gravy slow-simmered with butter and fenugreek.',
    pricePaise: 54000,
    vegType: 'NON_VEG',
    allergens: ['DAIRY'],
    spiceLevel: 2,
    isAvailable: true,
    isActive: true,
    sortOrder: 1,
    prepTimeMin: 20,
    calories: 580,
    stockCount: 18,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000006',
    categoryId: 'd0000000-0000-0000-0000-000000000002',
    categoryName: 'Main Course',
    name: 'Dal Makhani Bukhara',
    nameHindi: 'दाल मखनी बुखारा',
    description: 'Slow-cooked black lentils overnight with fresh cream, butter, and mild spice.',
    pricePaise: 38000,
    vegType: 'VEG',
    allergens: ['DAIRY'],
    spiceLevel: 1,
    isAvailable: true,
    isActive: true,
    sortOrder: 2,
    prepTimeMin: 15,
    calories: 340,
    stockCount: 22,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000007',
    categoryId: 'd0000000-0000-0000-0000-000000000002',
    categoryName: 'Main Course',
    name: 'Kashmiri Rogan Josh',
    nameHindi: 'कश्मीरी रोगन जोश',
    description: 'Traditional Kashmiri tender lamb curry infused with maval petals and rattan jyot.',
    pricePaise: 56000,
    vegType: 'NON_VEG',
    allergens: [],
    spiceLevel: 3,
    isAvailable: true,
    isActive: true,
    sortOrder: 3,
    prepTimeMin: 20,
    calories: 460,
    stockCount: 9,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000008',
    categoryId: 'd0000000-0000-0000-0000-000000000002',
    categoryName: 'Main Course',
    name: 'Palak Paneer',
    nameHindi: 'पालक पनीर',
    description: 'Fresh spinach puree tempered with garlic, cumin, and soft cottage cheese cubes.',
    pricePaise: 36000,
    vegType: 'VEG',
    allergens: ['DAIRY'],
    spiceLevel: 1,
    isAvailable: true,
    isActive: true,
    sortOrder: 4,
    prepTimeMin: 15,
    calories: 290,
    stockCount: 14,
  },

  // Biryani & Rice
  {
    id: 'f0000000-0000-0000-0000-000000000009',
    categoryId: 'd0000000-0000-0000-0000-000000000003',
    categoryName: 'Biryani & Rice',
    name: 'Dum Biryani Hyderabadi',
    nameHindi: 'दम बिरयानी हैदराबादी',
    description: 'Slow-cooked fragrant chicken biryani layered with aged long grain basmati rice and saffron.',
    pricePaise: 48000,
    vegType: 'NON_VEG',
    allergens: ['DAIRY'],
    spiceLevel: 2,
    isAvailable: true,
    isActive: true,
    sortOrder: 1,
    prepTimeMin: 22,
    calories: 600,
    stockCount: 15,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000010',
    categoryId: 'd0000000-0000-0000-0000-000000000003',
    categoryName: 'Biryani & Rice',
    name: 'Royal Veg Dum Biryani',
    nameHindi: 'रॉयल वेज दम बिरयानी',
    description: 'Mixed vegetable aromatic biryani served with spiced burani raita and salan.',
    pricePaise: 36000,
    vegType: 'VEG',
    allergens: ['DAIRY'],
    spiceLevel: 1,
    isAvailable: true,
    isActive: true,
    sortOrder: 2,
    prepTimeMin: 18,
    calories: 450,
    stockCount: 20,
  },

  // Breads
  {
    id: 'f0000000-0000-0000-0000-000000000011',
    categoryId: 'd0000000-0000-0000-0000-000000000004',
    categoryName: 'Breads',
    name: 'Butter Garlic Naan',
    nameHindi: 'बटर गार्लिक नान',
    description: 'Refined flour bread with crushed garlic, coriander, and fresh butter.',
    pricePaise: 11000,
    vegType: 'VEG',
    allergens: ['GLUTEN', 'DAIRY'],
    spiceLevel: 1,
    isAvailable: true,
    isActive: true,
    sortOrder: 1,
    prepTimeMin: 8,
    calories: 220,
    stockCount: 50,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000012',
    categoryId: 'd0000000-0000-0000-0000-000000000004',
    categoryName: 'Breads',
    name: 'Tandoori Roti',
    nameHindi: 'तंदूरी रोटी',
    description: 'Whole wheat clay oven baked bread.',
    pricePaise: 4500,
    vegType: 'VEGAN',
    allergens: ['GLUTEN'],
    spiceLevel: 0,
    isAvailable: true,
    isActive: true,
    sortOrder: 2,
    prepTimeMin: 6,
    calories: 120,
    stockCount: 60,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000013',
    categoryId: 'd0000000-0000-0000-0000-000000000004',
    categoryName: 'Breads',
    name: 'Laccha Paratha',
    nameHindi: 'लच्छा पराठा',
    description: 'Multi-layered whole wheat bread crisped with ghee.',
    pricePaise: 6000,
    vegType: 'VEG',
    allergens: ['GLUTEN', 'DAIRY'],
    spiceLevel: 0,
    isAvailable: true,
    isActive: true,
    sortOrder: 3,
    prepTimeMin: 8,
    calories: 180,
    stockCount: 40,
  },

  // Desserts
  {
    id: 'f0000000-0000-0000-0000-000000000014',
    categoryId: 'd0000000-0000-0000-0000-000000000005',
    categoryName: 'Desserts',
    name: 'Gulab Jamun with Kesar Rabri',
    nameHindi: 'गुलाब जामुन केसर रबड़ी के साथ',
    description: 'Sweet milk dumplings dipped in rose cardamom syrup, served with chilled saffron rabri.',
    pricePaise: 21000,
    vegType: 'VEG',
    allergens: ['DAIRY', 'NUTS'],
    spiceLevel: 0,
    isAvailable: true,
    isActive: true,
    sortOrder: 1,
    prepTimeMin: 5,
    calories: 450,
    stockCount: 15,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000015',
    categoryId: 'd0000000-0000-0000-0000-000000000005',
    categoryName: 'Desserts',
    name: 'Rasmalai',
    nameHindi: 'रसमलाई',
    description: 'Spongy cottage cheese discs soaked in clotted sweetened milk garnished with pistachio.',
    pricePaise: 24000,
    vegType: 'VEG',
    allergens: ['DAIRY', 'NUTS'],
    spiceLevel: 0,
    isAvailable: true,
    isActive: true,
    sortOrder: 2,
    prepTimeMin: 5,
    calories: 380,
    stockCount: 12,
  },

  // Beverages
  {
    id: 'f0000000-0000-0000-0000-000000000016',
    categoryId: 'd0000000-0000-0000-0000-000000000006',
    categoryName: 'Beverages',
    name: 'Alphonso Mango Lassi',
    nameHindi: 'अल्फांसो आम की लस्सी',
    description: 'Creamy sweet yogurt drink infused with Ratnagiri Alphonso mango pulp.',
    pricePaise: 18000,
    vegType: 'VEG',
    allergens: ['DAIRY'],
    spiceLevel: 0,
    isAvailable: true,
    isActive: true,
    sortOrder: 1,
    prepTimeMin: 5,
    calories: 250,
    stockCount: 25,
  },
  {
    id: 'f0000000-0000-0000-0000-000000000017',
    categoryId: 'd0000000-0000-0000-0000-000000000006',
    categoryName: 'Beverages',
    name: 'Fresh Lime Soda',
    nameHindi: 'फ्रेश लाइम सोडा',
    description: 'Sweet or salted refreshing lime drink with bubbling sparkling water.',
    pricePaise: 9000,
    vegType: 'VEGAN',
    allergens: [],
    spiceLevel: 0,
    isAvailable: true,
    isActive: true,
    sortOrder: 2,
    prepTimeMin: 5,
    calories: 80,
    stockCount: 50,
  },
];

// Branch 1 Tables (All 12 tables T01 - T12)
export const BRANCH_1_TABLES: Table[] = [
  // Main Dining Hall
  { id: 't0000000-0000-0000-0000-000000000001', number: 'T01', capacity: 2, section: 'Main Dining Hall', qrTokenVersion: 1, isActive: true, x: 40, y: 40 },
  { id: 't0000000-0000-0000-0000-000000000002', number: 'T02', capacity: 4, section: 'Main Dining Hall', qrTokenVersion: 1, isActive: true, x: 180, y: 40 },
  { id: 't0000000-0000-0000-0000-000000000003', number: 'T03', capacity: 4, section: 'Main Dining Hall', qrTokenVersion: 1, isActive: true, x: 320, y: 40 },
  { id: 't0000000-0000-0000-0000-000000000004', number: 'T04', capacity: 4, section: 'Main Dining Hall', qrTokenVersion: 1, isActive: true, x: 460, y: 40 },

  // Verandah / Terrace
  { id: 't0000000-0000-0000-0000-000000000005', number: 'T05', capacity: 4, section: 'Verandah / Terrace', qrTokenVersion: 1, isActive: true, x: 40, y: 180 },
  { id: 't0000000-0000-0000-0000-000000000006', number: 'T06', capacity: 4, section: 'Verandah / Terrace', qrTokenVersion: 1, isActive: true, x: 180, y: 180 },
  { id: 't0000000-0000-0000-0000-000000000007', number: 'T07', capacity: 6, section: 'Verandah / Terrace', qrTokenVersion: 1, isActive: true, x: 320, y: 180 },
  { id: 't0000000-0000-0000-0000-000000000008', number: 'T08', capacity: 6, section: 'Verandah / Terrace', qrTokenVersion: 1, isActive: true, x: 460, y: 180 },

  // Family Lounge
  { id: 't0000000-0000-0000-0000-000000000009', number: 'T09', capacity: 6, section: 'Family Lounge', qrTokenVersion: 1, isActive: true, x: 40, y: 320 },
  { id: 't0000000-0000-0000-0000-000000000010', number: 'T10', capacity: 6, section: 'Family Lounge', qrTokenVersion: 1, isActive: true, x: 180, y: 320 },
  { id: 't0000000-0000-0000-0000-000000000011', number: 'T11', capacity: 8, section: 'Family Lounge', qrTokenVersion: 1, isActive: true, x: 320, y: 320 },
  { id: 't0000000-0000-0000-0000-000000000012', number: 'T12', capacity: 8, section: 'Family Lounge', qrTokenVersion: 1, isActive: true, x: 460, y: 320 },
];

// Branch 1 Active Table Sessions
export const BRANCH_1_SESSIONS: TableSession[] = [
  {
    id: 's0000000-0000-0000-0000-000000000004',
    tableId: 't0000000-0000-0000-0000-000000000004',
    tableNumber: 'T04',
    status: 'OPEN',
    guestCount: 4,
    openedAt: '45 mins ago',
    closedAt: null,
    activeOrderId: '10000000-0000-0000-0000-000000000001',
    tableCode: '7729',
  },
  {
    id: 's0000000-0000-0000-0000-000000000007',
    tableId: 't0000000-0000-0000-0000-000000000007',
    tableNumber: 'T07',
    status: 'OPEN',
    guestCount: 3,
    openedAt: '30 mins ago',
    closedAt: null,
    activeOrderId: '10000000-0000-0000-0000-000000000003',
    tableCode: '9012',
  },
  {
    id: 's0000000-0000-0000-0000-000000000012',
    tableId: 't0000000-0000-0000-0000-000000000012',
    tableNumber: 'T12',
    status: 'OPEN',
    guestCount: 6,
    openedAt: '55 mins ago',
    closedAt: null,
    activeOrderId: '10000000-0000-0000-0000-000000000002',
    tableCode: '3318',
  },
];

// Branch 1 Active Orders
export const BRANCH_1_ACTIVE_ORDERS: Order[] = [
  {
    id: '10000000-0000-0000-0000-000000000001',
    displayId: 'RS-1001',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T04',
    sessionId: 's0000000-0000-0000-0000-000000000004',
    status: 'CONFIRMED',
    subtotalPaise: 72381,
    taxPaise: 3619,
    discountPaise: 39619,
    totalPaise: 76000,
    createdAt: '5 mins ago',
    customerName: 'Aman Verma',
    specialInstructions: 'Extra spicy, customer requested quick service if possible.',
    items: [
      {
        id: 'oi000000-0000-0000-0000-000000000001',
        orderId: '10000000-0000-0000-0000-000000000001',
        itemId: 'f0000000-0000-0000-0000-000000000005',
        name: 'Old Delhi Butter Chicken',
        pricePaise: 54000,
        quantity: 1,
        status: 'CONFIRMED',
        notes: 'Extra spicy',
      },
      {
        id: 'oi000000-0000-0000-0000-000000000002',
        orderId: '10000000-0000-0000-0000-000000000001',
        itemId: 'f0000000-0000-0000-0000-000000000011',
        name: 'Butter Garlic Naan',
        pricePaise: 11000,
        quantity: 2,
        status: 'CONFIRMED',
      },
      {
        id: 'oi000000-0000-0000-0000-000000000003',
        orderId: '10000000-0000-0000-0000-000000000001',
        itemId: 'f0000000-0000-0000-0000-000000000016',
        name: 'Alphonso Mango Lassi',
        pricePaise: 18000,
        quantity: 2,
        status: 'CONFIRMED',
      },
    ],
    events: [
      { id: 'oe01', orderId: '10000000-0000-0000-0000-000000000001', previousStatus: 'PENDING', newStatus: 'CONFIRMED', actorName: 'Customer (Paid Online)', createdAt: '5m ago' },
    ],
  },
  {
    id: '10000000-0000-0000-0000-000000000002',
    displayId: 'RS-1002',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T12',
    sessionId: 's0000000-0000-0000-0000-000000000012',
    status: 'CONFIRMED',
    subtotalPaise: 118095,
    taxPaise: 5905,
    discountPaise: 0,
    totalPaise: 124000,
    createdAt: '50 mins ago',
    customerName: 'Meera Nair & Family',
    unverifiedGuest: true,
    needsAck: true,
    specialInstructions: 'With extra raita and mint chutney.',
    items: [
      {
        id: 'oi000000-0000-0000-0000-000000000004',
        orderId: '10000000-0000-0000-0000-000000000002',
        itemId: 'f0000000-0000-0000-0000-000000000009',
        name: 'Dum Biryani Hyderabadi',
        pricePaise: 48000,
        quantity: 2,
        status: 'CONFIRMED',
        notes: 'With extra raita',
      },
      {
        id: 'oi000000-0000-0000-0000-000000000005',
        orderId: '10000000-0000-0000-0000-000000000002',
        itemId: 'f0000000-0000-0000-0000-000000000002',
        name: 'Mutton Galouti Kebab',
        pricePaise: 18095,
        quantity: 1,
        status: 'CONFIRMED',
        notes: 'Lunch special promotion',
      },
      {
        id: 'oi000000-0000-0000-0000-000000000006',
        orderId: '10000000-0000-0000-0000-000000000002',
        itemId: 'f0000000-0000-0000-0000-000000000017',
        name: 'Fresh Lime Soda',
        pricePaise: 2000,
        quantity: 2,
        status: 'CONFIRMED',
        notes: 'Sweet and Salt mix',
      },
    ],
    events: [
      { id: 'oe03', orderId: '10000000-0000-0000-0000-000000000002', previousStatus: 'PENDING', newStatus: 'CONFIRMED', actorName: 'Rajesh Sharma (Captain)', createdAt: '49m ago' },
    ],
  },
  {
    id: '10000000-0000-0000-0000-000000000003',
    displayId: 'RS-1003',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T08',
    sessionId: 's0000000-0000-0000-0000-000000000008',
    status: 'PREPARING',
    subtotalPaise: 72000,
    taxPaise: 3600,
    discountPaise: 0,
    totalPaise: 75600,
    createdAt: '20 mins ago',
    customerName: 'Kunal Kapoor',
    specialInstructions: 'Cooking in progress. Table requested timely delivery.',
    items: [
      {
        id: 'oi000000-0000-0000-0000-000000000007',
        orderId: '10000000-0000-0000-0000-000000000003',
        itemId: 'f0000000-0000-0000-0000-000000000006',
        name: 'Dal Makhani Bukhara',
        pricePaise: 38000,
        quantity: 1,
        status: 'PREPARING',
      },
      {
        id: 'oi000000-0000-0000-0000-000000000008',
        orderId: '10000000-0000-0000-0000-000000000003',
        itemId: 'f0000000-0000-0000-0000-000000000001',
        name: 'Paneer Tikka Charcoal Char',
        pricePaise: 34000,
        quantity: 1,
        status: 'PREPARING',
      },
    ],
    events: [
      { id: 'oe04', orderId: '10000000-0000-0000-0000-000000000003', previousStatus: 'PENDING', newStatus: 'CONFIRMED', actorName: 'Customer (Paid Online)', createdAt: '20m ago' },
      { id: 'oe05', orderId: '10000000-0000-0000-0000-000000000003', previousStatus: 'CONFIRMED', newStatus: 'PREPARING', actorName: 'Chef Amit Roy (Kitchen)', createdAt: '15m ago' },
    ],
  },
  {
    id: '10000000-0000-0000-0000-000000000004',
    displayId: 'RS-1004',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T02',
    sessionId: 's0000000-0000-0000-0000-000000000002',
    status: 'READY',
    subtotalPaise: 68571,
    taxPaise: 3429,
    discountPaise: 3429,
    totalPaise: 72000,
    createdAt: '25 mins ago',
    customerName: 'Priya Mehta',
    specialInstructions: 'Ready on pass, waiting for runner/captain takeaway.',
    items: [
      {
        id: 'oi000000-0000-0000-0000-000000000010',
        orderId: '10000000-0000-0000-0000-000000000004',
        itemId: 'f0000000-0000-0000-0000-000000000006',
        name: 'Dal Makhani Bukhara',
        pricePaise: 38000,
        quantity: 1,
        status: 'READY',
      },
      {
        id: 'oi000000-0000-0000-0000-000000000011',
        orderId: '10000000-0000-0000-0000-000000000004',
        itemId: 'f0000000-0000-0000-0000-000000000013',
        name: 'Laccha Paratha',
        pricePaise: 0,
        quantity: 3,
        status: 'READY',
        notes: 'Complimentary bread basket',
      },
    ],
    events: [
      { id: 'oe06', orderId: '10000000-0000-0000-0000-000000000004', previousStatus: 'PENDING', newStatus: 'CONFIRMED', actorName: 'Customer (Paid Online)', createdAt: '25m ago' },
      { id: 'oe07', orderId: '10000000-0000-0000-0000-000000000004', previousStatus: 'CONFIRMED', newStatus: 'PREPARING', actorName: 'Chef Amit Roy (Kitchen)', createdAt: '18m ago' },
      { id: 'oe08', orderId: '10000000-0000-0000-0000-000000000004', previousStatus: 'PREPARING', newStatus: 'READY', actorName: 'Chef Amit Roy (Kitchen)', createdAt: '3m ago' },
    ],
  },
];

// Branch 1 Completed Past Billed Orders (Orders 4 to 17 from SQL)
export const BRANCH_1_PAST_ORDERS: Order[] = [
  {
    id: '10000000-0000-0000-0000-000000000004',
    displayId: 'RS-1004',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T01',
    sessionId: 's0000000-0000-0000-0000-000000000001',
    status: 'BILLED',
    subtotalPaise: 40000,
    taxPaise: 2000,
    discountPaise: 0,
    totalPaise: 42000,
    createdAt: '4.0 hours ago',
    customerName: 'Aman Verma',
    paymentMethod: 'UPI',
    items: [
      { id: 'p-oi-1', orderId: '10000000-0000-0000-0000-000000000004', itemId: 'f-1', name: 'Dal Makhani Bukhara', pricePaise: 38000, quantity: 1, status: 'SERVED' },
      { id: 'p-oi-2', orderId: '10000000-0000-0000-0000-000000000004', itemId: 'f-2', name: 'Tandoori Roti', pricePaise: 4000, quantity: 1, status: 'SERVED' },
    ],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000005',
    displayId: 'RS-1005',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T02',
    sessionId: 's0000000-0000-0000-0000-000000000002',
    status: 'BILLED',
    subtotalPaise: 55000,
    taxPaise: 2750,
    discountPaise: 0,
    totalPaise: 57750,
    createdAt: '3.9 hours ago',
    customerName: 'Priya Mehta',
    paymentMethod: 'CARD',
    items: [
      { id: 'p-oi-3', orderId: '10000000-0000-0000-0000-000000000005', itemId: 'f-3', name: 'Old Delhi Butter Chicken', pricePaise: 54000, quantity: 1, status: 'SERVED' },
    ],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000006',
    displayId: 'RS-1006',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T09',
    sessionId: 's0000000-0000-0000-0000-000000000009',
    status: 'BILLED',
    subtotalPaise: 80000,
    taxPaise: 4000,
    discountPaise: 0,
    totalPaise: 84000,
    createdAt: '3.8 hours ago',
    customerName: 'Rohit Joshi',
    paymentMethod: 'CASH',
    items: [
      { id: 'p-oi-4', orderId: '10000000-0000-0000-0000-000000000006', itemId: 'f-4', name: 'Dum Biryani Hyderabadi', pricePaise: 48000, quantity: 1, status: 'SERVED' },
      { id: 'p-oi-5', orderId: '10000000-0000-0000-0000-000000000006', itemId: 'f-5', name: 'Paneer Tikka Charcoal Char', pricePaise: 32000, quantity: 1, status: 'SERVED' },
    ],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000007',
    displayId: 'RS-1007',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T05',
    sessionId: 's0000000-0000-0000-0000-000000000001',
    status: 'BILLED',
    subtotalPaise: 30000,
    taxPaise: 1500,
    discountPaise: 0,
    totalPaise: 31500,
    createdAt: '3.7 hours ago',
    customerName: 'Neha Kapoor',
    paymentMethod: 'UPI',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000008',
    displayId: 'RS-1008',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T11',
    sessionId: 's0000000-0000-0000-0000-000000000002',
    status: 'BILLED',
    subtotalPaise: 110000,
    taxPaise: 5500,
    discountPaise: 10000,
    totalPaise: 105500,
    createdAt: '4.8 hours ago',
    customerName: 'Walk-in Guest',
    paymentMethod: 'CARD',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000009',
    displayId: 'RS-1009',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T03',
    sessionId: 's0000000-0000-0000-0000-000000000002',
    status: 'BILLED',
    subtotalPaise: 60000,
    taxPaise: 3000,
    discountPaise: 0,
    totalPaise: 63000,
    createdAt: '4.5 hours ago',
    customerName: 'Walk-in Guest',
    paymentMethod: 'CASH',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000010',
    displayId: 'RS-1010',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T06',
    sessionId: 's0000000-0000-0000-0000-000000000002',
    status: 'BILLED',
    subtotalPaise: 45000,
    taxPaise: 2250,
    discountPaise: 0,
    totalPaise: 47250,
    createdAt: '4.2 hours ago',
    customerName: 'Karan Singh',
    paymentMethod: 'DIRECT_UPI_STAFF',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000011',
    displayId: 'RS-1011',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T08',
    sessionId: 's0000000-0000-0000-0000-000000000002',
    status: 'BILLED',
    subtotalPaise: 25000,
    taxPaise: 1250,
    discountPaise: 0,
    totalPaise: 26250,
    createdAt: '4.0 hours ago',
    customerName: 'Sneha Reddy',
    paymentMethod: 'UPI',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000012',
    displayId: 'RS-1012',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T10',
    sessionId: 's0000000-0000-0000-0000-000000000009',
    status: 'BILLED',
    subtotalPaise: 130000,
    taxPaise: 6500,
    discountPaise: 0,
    totalPaise: 136500,
    createdAt: '3.4 hours ago',
    customerName: 'Walk-in Guest',
    paymentMethod: 'CARD',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000013',
    displayId: 'RS-1013',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T12',
    sessionId: 's0000000-0000-0000-0000-000000000009',
    status: 'BILLED',
    subtotalPaise: 95000,
    taxPaise: 4750,
    discountPaise: 0,
    totalPaise: 99750,
    createdAt: '3.0 hours ago',
    customerName: 'Anjali Desai',
    paymentMethod: 'CARD',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000014',
    displayId: 'RS-1014',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T02',
    sessionId: 's0000000-0000-0000-0000-000000000009',
    status: 'BILLED',
    subtotalPaise: 52000,
    taxPaise: 2600,
    discountPaise: 0,
    totalPaise: 54600,
    createdAt: '2.5 hours ago',
    customerName: 'Walk-in Guest',
    paymentMethod: 'UPI',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000015',
    displayId: 'RS-1015',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T04',
    sessionId: 's0000000-0000-0000-0000-000000000009',
    status: 'BILLED',
    subtotalPaise: 38000,
    taxPaise: 1900,
    discountPaise: 0,
    totalPaise: 39900,
    createdAt: '2.2 hours ago',
    customerName: 'Siddharth Rao',
    paymentMethod: 'CASH',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000016',
    displayId: 'RS-1016',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T07',
    sessionId: 's0000000-0000-0000-0000-000000000009',
    status: 'BILLED',
    subtotalPaise: 71000,
    taxPaise: 3550,
    discountPaise: 0,
    totalPaise: 74550,
    createdAt: '2.1 hours ago',
    customerName: 'Walk-in Guest',
    paymentMethod: 'UPI',
    items: [],
    events: [],
  },
  {
    id: '10000000-0000-0000-0000-000000000017',
    displayId: 'RS-1017',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T09',
    sessionId: 's0000000-0000-0000-0000-000000000009',
    status: 'BILLED',
    subtotalPaise: 66000,
    taxPaise: 3300,
    discountPaise: 0,
    totalPaise: 69300,
    createdAt: '2.0 hours ago',
    customerName: 'Meera Nair',
    paymentMethod: 'CARD',
    items: [],
    events: [],
  },
  // Cancelled Order
  {
    id: '10000000-0000-0000-0000-000000000018',
    displayId: 'RS-1018',
    outletId: 'b0000000-0000-0000-0000-000000000001',
    tableNumber: 'T12',
    sessionId: 's0000000-0000-0000-0000-000000000012',
    status: 'CANCELLED',
    subtotalPaise: 24000,
    taxPaise: 1200,
    discountPaise: 0,
    totalPaise: 25200,
    createdAt: '1.0 hour ago',
    customerName: 'Guest',
    items: [],
    events: [],
  },
];

// Branch 1 Payments (All 14 from SQL)
export const BRANCH_1_PAYMENTS: Payment[] = [
  { id: 'p0000000-0000-0000-0000-000000000004', orderId: '10000000-0000-0000-0000-000000000004', displayId: 'RS-1004', tableNumber: 'T01', method: 'UPI', status: 'PAID', amountPaise: 42000, gatewayFeePaise: 0, netDepositedPaise: 42000, timestamp: '4.0h ago', customerName: 'Aman Verma' },
  { id: 'p0000000-0000-0000-0000-000000000005', orderId: '10000000-0000-0000-0000-000000000005', displayId: 'RS-1005', tableNumber: 'T02', method: 'CARD', status: 'PAID', amountPaise: 57750, gatewayFeePaise: 1155, netDepositedPaise: 56595, timestamp: '3.9h ago', customerName: 'Priya Mehta' },
  { id: 'p0000000-0000-0000-0000-000000000006', orderId: '10000000-0000-0000-0000-000000000006', displayId: 'RS-1006', tableNumber: 'T09', method: 'CASH', status: 'PAID', amountPaise: 84000, gatewayFeePaise: 0, netDepositedPaise: 84000, timestamp: '3.8h ago', customerName: 'Rohit Joshi' },
  { id: 'p0000000-0000-0000-0000-000000000007', orderId: '10000000-0000-0000-0000-000000000007', displayId: 'RS-1007', tableNumber: 'T05', method: 'UPI', status: 'PAID', amountPaise: 31500, gatewayFeePaise: 0, netDepositedPaise: 31500, timestamp: '3.7h ago', customerName: 'Neha Kapoor' },
  { id: 'p0000000-0000-0000-0000-000000000008', orderId: '10000000-0000-0000-0000-000000000008', displayId: 'RS-1008', tableNumber: 'T11', method: 'CARD', status: 'PAID', amountPaise: 105500, gatewayFeePaise: 2110, netDepositedPaise: 103390, timestamp: '4.8h ago', customerName: 'Walk-in Guest' },
  { id: 'p0000000-0000-0000-0000-000000000009', orderId: '10000000-0000-0000-0000-000000000009', displayId: 'RS-1009', tableNumber: 'T03', method: 'CASH', status: 'PAID', amountPaise: 63000, gatewayFeePaise: 0, netDepositedPaise: 63000, timestamp: '4.5h ago', customerName: 'Walk-in Guest' },
  { id: 'p0000000-0000-0000-0000-000000000010', orderId: '10000000-0000-0000-0000-000000000010', displayId: 'RS-1010', tableNumber: 'T06', method: 'DIRECT_UPI_STAFF', status: 'PAID', amountPaise: 47250, gatewayFeePaise: 0, netDepositedPaise: 47250, timestamp: '4.2h ago', customerName: 'Karan Singh' },
  { id: 'p0000000-0000-0000-0000-000000000011', orderId: '10000000-0000-0000-0000-000000000011', displayId: 'RS-1011', tableNumber: 'T08', method: 'UPI', status: 'PAID', amountPaise: 26250, gatewayFeePaise: 0, netDepositedPaise: 26250, timestamp: '4.0h ago', customerName: 'Sneha Reddy' },
  { id: 'p0000000-0000-0000-0000-000000000012', orderId: '10000000-0000-0000-0000-000000000012', displayId: 'RS-1012', tableNumber: 'T10', method: 'CARD', status: 'PAID', amountPaise: 136500, gatewayFeePaise: 2730, netDepositedPaise: 133770, timestamp: '3.4h ago', customerName: 'Walk-in Guest' },
  { id: 'p0000000-0000-0000-0000-000000000013', orderId: '10000000-0000-0000-0000-000000000013', displayId: 'RS-1013', tableNumber: 'T12', method: 'CARD', status: 'PAID', amountPaise: 99750, gatewayFeePaise: 1995, netDepositedPaise: 97755, timestamp: '3.0h ago', customerName: 'Anjali Desai' },
  { id: 'p0000000-0000-0000-0000-000000000014', orderId: '10000000-0000-0000-0000-000000000014', displayId: 'RS-1014', tableNumber: 'T02', method: 'UPI', status: 'PAID', amountPaise: 54600, gatewayFeePaise: 0, netDepositedPaise: 54600, timestamp: '2.5h ago', customerName: 'Walk-in Guest' },
  { id: 'p0000000-0000-0000-0000-000000000015', orderId: '10000000-0000-0000-0000-000000000015', displayId: 'RS-1015', tableNumber: 'T04', method: 'CASH', status: 'PAID', amountPaise: 39900, gatewayFeePaise: 0, netDepositedPaise: 39900, timestamp: '2.2h ago', customerName: 'Siddharth Rao' },
  { id: 'p0000000-0000-0000-0000-000000000016', orderId: '10000000-0000-0000-0000-000000000016', displayId: 'RS-1016', tableNumber: 'T07', method: 'UPI', status: 'PAID', amountPaise: 74550, gatewayFeePaise: 0, netDepositedPaise: 74550, timestamp: '2.1h ago', customerName: 'Walk-in Guest' },
  { id: 'p0000000-0000-0000-0000-000000000017', orderId: '10000000-0000-0000-0000-000000000017', displayId: 'RS-1017', tableNumber: 'T09', method: 'CARD', status: 'PAID', amountPaise: 69300, gatewayFeePaise: 1386, netDepositedPaise: 67914, timestamp: '2.0h ago', customerName: 'Meera Nair' },
];

// Branch 1 Gapless Sequential Invoices (14 invoices from SQL)
export const BRANCH_1_INVOICES: Invoice[] = [
  { id: 'i0000000-0000-0000-0000-000000000001', orderId: '10000000-0000-0000-0000-000000000004', invoiceNumber: 'INV/2026-27/000001', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Aman Verma', subtotalPaise: 40000, cgstPaise: 1000, sgstPaise: 1000, totalPaise: 42000, issuedAt: '4.0h ago', tableNumber: 'T01', paymentMethod: 'UPI' },
  { id: 'i0000000-0000-0000-0000-000000000002', orderId: '10000000-0000-0000-0000-000000000005', invoiceNumber: 'INV/2026-27/000002', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Priya Mehta', subtotalPaise: 55000, cgstPaise: 1375, sgstPaise: 1375, totalPaise: 57750, issuedAt: '3.9h ago', tableNumber: 'T02', paymentMethod: 'CARD' },
  { id: 'i0000000-0000-0000-0000-000000000003', orderId: '10000000-0000-0000-0000-000000000006', invoiceNumber: 'INV/2026-27/000003', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Rohit Joshi', subtotalPaise: 80000, cgstPaise: 2000, sgstPaise: 2000, totalPaise: 84000, issuedAt: '3.8h ago', tableNumber: 'T09', paymentMethod: 'CASH' },
  { id: 'i0000000-0000-0000-0000-000000000004', orderId: '10000000-0000-0000-0000-000000000007', invoiceNumber: 'INV/2026-27/000004', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Neha Kapoor', subtotalPaise: 30000, cgstPaise: 750, sgstPaise: 750, totalPaise: 31500, issuedAt: '3.7h ago', tableNumber: 'T05', paymentMethod: 'UPI' },
  { id: 'i0000000-0000-0000-0000-000000000005', orderId: '10000000-0000-0000-0000-000000000008', invoiceNumber: 'INV/2026-27/000005', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Walk-in', subtotalPaise: 100000, cgstPaise: 2750, sgstPaise: 2750, totalPaise: 105500, issuedAt: '4.8h ago', tableNumber: 'T11', paymentMethod: 'CARD' },
  { id: 'i0000000-0000-0000-0000-000000000006', orderId: '10000000-0000-0000-0000-000000000009', invoiceNumber: 'INV/2026-27/000006', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Walk-in', subtotalPaise: 60000, cgstPaise: 1500, sgstPaise: 1500, totalPaise: 63000, issuedAt: '4.5h ago', tableNumber: 'T03', paymentMethod: 'CASH' },
  { id: 'i0000000-0000-0000-0000-000000000007', orderId: '10000000-0000-0000-0000-000000000010', invoiceNumber: 'INV/2026-27/000007', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Karan Singh', subtotalPaise: 45000, cgstPaise: 1125, sgstPaise: 1125, totalPaise: 47250, issuedAt: '4.2h ago', tableNumber: 'T06', paymentMethod: 'DIRECT_UPI_STAFF' },
  { id: 'i0000000-0000-0000-0000-000000000008', orderId: '10000000-0000-0000-0000-000000000011', invoiceNumber: 'INV/2026-27/000008', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Sneha Reddy', subtotalPaise: 25000, cgstPaise: 625, sgstPaise: 625, totalPaise: 26250, issuedAt: '4.0h ago', tableNumber: 'T08', paymentMethod: 'UPI' },
  { id: 'i0000000-0000-0000-0000-000000000009', orderId: '10000000-0000-0000-0000-000000000012', invoiceNumber: 'INV/2026-27/000009', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Walk-in', subtotalPaise: 130000, cgstPaise: 3250, sgstPaise: 3250, totalPaise: 136500, issuedAt: '3.4h ago', tableNumber: 'T10', paymentMethod: 'CARD' },
  { id: 'i0000000-0000-0000-0000-000000000010', orderId: '10000000-0000-0000-0000-000000000013', invoiceNumber: 'INV/2026-27/000010', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Anjali Desai', subtotalPaise: 95000, cgstPaise: 2375, sgstPaise: 2375, totalPaise: 99750, issuedAt: '3.0h ago', tableNumber: 'T12', paymentMethod: 'CARD' },
  { id: 'i0000000-0000-0000-0000-000000000011', orderId: '10000000-0000-0000-0000-000000000014', invoiceNumber: 'INV/2026-27/000011', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Walk-in', subtotalPaise: 52000, cgstPaise: 1300, sgstPaise: 1300, totalPaise: 54600, issuedAt: '2.5h ago', tableNumber: 'T02', paymentMethod: 'UPI' },
  { id: 'i0000000-0000-0000-0000-000000000012', orderId: '10000000-0000-0000-0000-000000000015', invoiceNumber: 'INV/2026-27/000012', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Siddharth Rao', subtotalPaise: 38000, cgstPaise: 950, sgstPaise: 950, totalPaise: 39900, issuedAt: '2.2h ago', tableNumber: 'T04', paymentMethod: 'CASH' },
  { id: 'i0000000-0000-0000-0000-000000000013', orderId: '10000000-0000-0000-0000-000000000016', invoiceNumber: 'INV/2026-27/000013', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Walk-in', subtotalPaise: 71000, cgstPaise: 1775, sgstPaise: 1775, totalPaise: 74550, issuedAt: '2.1h ago', tableNumber: 'T07', paymentMethod: 'UPI' },
  { id: 'i0000000-0000-0000-0000-000000000014', orderId: '10000000-0000-0000-0000-000000000017', invoiceNumber: 'INV/2026-27/000014', sellerGstin: '29AAAAA0000A1Z5', buyerName: 'Meera Nair', subtotalPaise: 66000, cgstPaise: 1650, sgstPaise: 1650, totalPaise: 69300, issuedAt: '2.0h ago', tableNumber: 'T09', paymentMethod: 'CARD' },
];

// Branch 1 Daily Analytics Rollups (Past 7 Days from SQL)
export const BRANCH_1_DAILY_ROLLUPS: DailyRollup[] = [
  { id: 'ad01', date: 'Yesterday', orderCount: 85, grossSalesPaise: 8200000, taxPaise: 410000, discountPaise: 150000, netSalesPaise: 8460000, tipPaise: 25000 },
  { id: 'ad02', date: '2 days ago', orderCount: 76, grossSalesPaise: 7500000, taxPaise: 375000, discountPaise: 120000, netSalesPaise: 7755000, tipPaise: 18000 },
  { id: 'ad03', date: '3 days ago', orderCount: 90, grossSalesPaise: 8500000, taxPaise: 425000, discountPaise: 200000, netSalesPaise: 8725000, tipPaise: 31000 },
  { id: 'ad04', date: '4 days ago', orderCount: 82, grossSalesPaise: 7900000, taxPaise: 395000, discountPaise: 160000, netSalesPaise: 8135000, tipPaise: 22000 },
  { id: 'ad05', date: '5 days ago', orderCount: 65, grossSalesPaise: 5800000, taxPaise: 290000, discountPaise: 90000, netSalesPaise: 6000000, tipPaise: 14000 },
  { id: 'ad06', date: '6 days ago', orderCount: 60, grossSalesPaise: 5500000, taxPaise: 275000, discountPaise: 85000, netSalesPaise: 5690000, tipPaise: 12000 },
  { id: 'ad07', date: '7 days ago', orderCount: 72, grossSalesPaise: 7100000, taxPaise: 355000, discountPaise: 110000, netSalesPaise: 7345000, tipPaise: 19000 },
];

// Branch 1 Hourly Rollups (12:00 to 23:00 from SQL)
export const BRANCH_1_HOURLY_ROLLUPS: HourlyRollup[] = [
  { hour: 12, hourLabel: '12:00', orderCount: 5, grossSalesPaise: 450000 },
  { hour: 13, hourLabel: '13:00', orderCount: 18, grossSalesPaise: 1800000 },
  { hour: 14, hourLabel: '14:00', orderCount: 22, grossSalesPaise: 2100000 },
  { hour: 15, hourLabel: '15:00', orderCount: 8, grossSalesPaise: 750000 },
  { hour: 16, hourLabel: '16:00', orderCount: 3, grossSalesPaise: 200000 },
  { hour: 17, hourLabel: '17:00', orderCount: 4, grossSalesPaise: 280000 },
  { hour: 18, hourLabel: '18:00', orderCount: 9, grossSalesPaise: 810000 },
  { hour: 19, hourLabel: '19:00', orderCount: 25, grossSalesPaise: 2600000 },
  { hour: 20, hourLabel: '20:00', orderCount: 32, grossSalesPaise: 3350000 },
  { hour: 21, hourLabel: '21:00', orderCount: 28, grossSalesPaise: 2900000 },
  { hour: 22, hourLabel: '22:00', orderCount: 14, grossSalesPaise: 1500000 },
  { hour: 23, hourLabel: '23:00', orderCount: 4, grossSalesPaise: 380000 },
];

// Branch 1 Coupons
export const BRANCH_1_COUPONS: Coupon[] = [
  {
    id: 'cp000000-0000-0000-0000-000000000001',
    code: 'ROYAL100',
    discountType: 'FLAT',
    discountValue: 10000, // ₹100
    maxDiscountPaise: 10000,
    minOrderPaise: 50000, // ₹500
    isActive: true,
    usedCount: 28,
  },
  {
    id: 'cp000000-0000-0000-0000-000000000002',
    code: 'FESTIVE15',
    discountType: 'PERCENTAGE',
    discountValue: 15, // 15%
    maxDiscountPaise: 20000, // ₹200
    minOrderPaise: 80000, // ₹800
    isActive: true,
    usedCount: 42,
  },
];

// Branch 1 Customer Feedback
export const BRANCH_1_FEEDBACK: FeedbackReview[] = [
  {
    id: 'fb000000-0000-0000-0000-000000000001',
    tableNumber: 'T01',
    customerName: 'Aman Verma',
    rating: 5,
    tags: ['Authentic Flavors', 'Great Ambiance'],
    comments: 'The Butter Chicken was phenomenal. Perfect balance of spices.',
    resolutionNotes: null,
    createdAt: '4 hours ago',
    isResolved: true,
  },
  {
    id: 'fb000000-0000-0000-0000-000000000002',
    tableNumber: 'T02',
    customerName: 'Priya Mehta',
    rating: 4,
    tags: ['Fast Service', 'Value for Money'],
    comments: 'Loved the biryani, but the naan could be softer.',
    resolutionNotes: null,
    createdAt: '3.9 hours ago',
    isResolved: true,
  },
  {
    id: 'fb000000-0000-0000-0000-000000000003',
    tableNumber: 'T09',
    customerName: 'Rohit Joshi',
    rating: 2,
    tags: ['Slow Service'],
    comments: 'Drinks took too long to arrive. We were waiting for 20 mins for a simple lassi.',
    resolutionNotes: 'Manager Anand Joshi contacted the customer and offered a 15% discount coupon for next visit.',
    createdAt: '3.8 hours ago',
    isResolved: true,
  },
  {
    id: 'fb000000-0000-0000-0000-000000000004',
    tableNumber: 'T04',
    customerName: 'Sneha Reddy',
    rating: 5,
    tags: ['Chef Special', 'Authentic Flavors'],
    comments: 'Chef Amit is a wizard! The Dal Makhani tasted exactly like what you get in Old Delhi.',
    resolutionNotes: null,
    createdAt: '45 mins ago',
    isResolved: true,
  },
  {
    id: 'fb000000-0000-0000-0000-000000000005',
    tableNumber: 'T12',
    customerName: 'Meera Nair',
    rating: 5,
    tags: ['Friendly Staff'],
    comments: 'Rajesh was an excellent host. Recommended the best starters for our family.',
    resolutionNotes: null,
    createdAt: '55 mins ago',
    isResolved: true,
  },
];

// Branch 1 Waiter Calls
export const BRANCH_1_CALLS: ServiceCall[] = [
  { id: 'call-1', table: 'T07', timestamp: Date.now() - 4 * 60 * 1000, reason: 'Request Bill / Settle', status: 'PENDING' },
  { id: 'call-2', table: 'T04', timestamp: Date.now() - 1 * 60 * 1000, reason: 'Water & Extra Cutlery', status: 'PENDING' },
];

// -----------------------------------------------------------------------------
// BRANCH-AWARE REPOSITORY ACCESSOR
// -----------------------------------------------------------------------------

export interface BranchData {
  outlet: Outlet;
  isPopulated: boolean;
  categories: MenuCategory[];
  menuItems: MenuItem[];
  tables: Table[];
  sessions: TableSession[];
  activeOrders: Order[];
  pastOrders: Order[];
  payments: Payment[];
  invoices: Invoice[];
  dailyRollups: DailyRollup[];
  hourlyRollups: HourlyRollup[];
  coupons: Coupon[];
  feedback: FeedbackReview[];
  serviceCalls: ServiceCall[];
  staffMembers: StaffMember[];
}

// -----------------------------------------------------------------------------
// DYNAMIC STORAGE HELPERS (Hotels/Outlets, Staff Credentials, Owner Password)
// -----------------------------------------------------------------------------

export function getStoredOutlets(): Outlet[] {
  if (typeof window === 'undefined') return OUTLETS;
  try {
    const raw = localStorage.getItem('dineflow_custom_outlets');
    if (raw) {
      const custom: Outlet[] = JSON.parse(raw);
      const map = new Map<string, Outlet>();
      OUTLETS.forEach((o) => map.set(o.id, o));
      custom.forEach((o) => map.set(o.id, o));
      return Array.from(map.values());
    }
  } catch {}
  return OUTLETS;
}

export function saveStoredOutlet(outlet: Outlet): Outlet[] {
  if (typeof window === 'undefined') return OUTLETS;
  try {
    const current = getStoredOutlets();
    const updated = [outlet, ...current.filter((o) => o.id !== outlet.id)];
    const toPersist = updated.filter((o) => !OUTLETS.some((def) => def.id === o.id));
    localStorage.setItem('dineflow_custom_outlets', JSON.stringify(toPersist));
    return updated;
  } catch {}
  return OUTLETS;
}

export function getStoredStaff(): StaffMember[] {
  if (typeof window === 'undefined') return ALL_STAFF_MEMBERS;
  try {
    const raw = localStorage.getItem('dineflow_custom_staff_v2');
    localStorage.removeItem('dineflow_custom_staff');
    if (raw) {
      const custom: StaffMember[] = JSON.parse(raw);
      const map = new Map<string, StaffMember>();
      ALL_STAFF_MEMBERS.forEach((s) => map.set(s.id, { ...s }));
      custom.forEach((s) => {
        const existing = map.get(s.id);
        map.set(s.id, {
          ...existing,
          ...s,
          username: s.username || existing?.username || s.email.split('@')[0],
        });
      });
      return Array.from(map.values());
    }
  } catch {}
  return ALL_STAFF_MEMBERS;
}

export function saveStoredStaffMember(staff: StaffMember): StaffMember[] {
  if (typeof window === 'undefined') return ALL_STAFF_MEMBERS;
  try {
    const current = getStoredStaff();
    const sanitized: StaffMember = {
      id: staff.id,
      orgId: staff.orgId,
      name: staff.name,
      email: staff.email,
      username: staff.username,
      phone: staff.phone,
      role: staff.role,
      avatar: staff.avatar,
      outletId: staff.outletId,
      isActive: staff.isActive,
      mfaEnrolled: staff.mfaEnrolled,
    };
    const updated = [sanitized, ...current.filter((s) => s.id !== staff.id)];
    localStorage.setItem('dineflow_custom_staff_v2', JSON.stringify(updated));
    return updated;
  } catch {}
  return ALL_STAFF_MEMBERS;
}

export function deleteStoredStaffMember(staffId: string): StaffMember[] {
  if (typeof window === 'undefined') return ALL_STAFF_MEMBERS;
  try {
    const current = getStoredStaff();
    const updated = current.filter((s) => s.id !== staffId);
    localStorage.setItem('dineflow_custom_staff_v2', JSON.stringify(updated));
    return updated;
  } catch {}
  return ALL_STAFF_MEMBERS;
}

// -----------------------------------------------------------------------------
// SESSION READ HELPERS (backed by verified JWT storage in auth-client.ts)
// -----------------------------------------------------------------------------
import { getConsoleAuthState } from './auth-client';

export function getLoggedInUser(): StaffMember | null {
  const session = getConsoleAuthState();
  if (!session) return null;
  const known = getStoredStaff().find(
    (s) => s.id === session.user.id || s.email.toLowerCase() === session.user.email.toLowerCase(),
  );
  if (known) {
    return {
      ...known,
      id: session.user.id,
      orgId: session.user.orgId,
      outletId: session.user.outletId,
      username: session.user.username || known.username,
      email: session.user.email || known.email,
      name: session.user.name || known.name,
      role: (session.user.role as StaffMember['role']) || known.role,
    };
  }
  return {
    id: session.user.id,
    orgId: session.user.orgId,
    name: session.user.name || session.user.username || session.user.email,
    username: session.user.username || session.user.email.split('@')[0],
    email: session.user.email,
    phone: '',
    role: (session.user.role as StaffMember['role']) || 'WAITER',
    avatar: session.user.role === 'OWNER' ? '👔' : '👤',
    outletId: session.user.outletId,
    isActive: true,
  };
}

export function getBranchData(outletId: string): BranchData {
  const allOutlets = typeof window !== 'undefined' ? getStoredOutlets() : OUTLETS;
  const outlet = allOutlets.find((o) => o.id === outletId) ?? allOutlets[0] ?? OUTLETS[0]!;
  const allStaff = typeof window !== 'undefined' ? getStoredStaff() : ALL_STAFF_MEMBERS;

  // Branch 1 (Indiranagar Flagship) is the ONLY fully populated branch
  if (outlet.id === '71ad00a6-d79b-4035-b563-bf9543fcfa86' || outlet.id === 'b0000000-0000-0000-0000-000000000001') {
    return {
      outlet,
      isPopulated: true,
      categories: BRANCH_1_CATEGORIES,
      menuItems: BRANCH_1_MENU_ITEMS,
      tables: BRANCH_1_TABLES,
      sessions: BRANCH_1_SESSIONS,
      activeOrders: BRANCH_1_ACTIVE_ORDERS,
      pastOrders: BRANCH_1_PAST_ORDERS,
      payments: BRANCH_1_PAYMENTS,
      invoices: BRANCH_1_INVOICES,
      dailyRollups: BRANCH_1_DAILY_ROLLUPS,
      hourlyRollups: BRANCH_1_HOURLY_ROLLUPS,
      coupons: BRANCH_1_COUPONS,
      feedback: BRANCH_1_FEEDBACK,
      serviceCalls: BRANCH_1_CALLS,
      staffMembers: allStaff.filter((s) => s.outletId === outlet.id || s.outletId === null),
    };
  }

  // Other branches or newly created hotels/restaurants
  return {
    outlet,
    isPopulated: true,
    categories: BRANCH_1_CATEGORIES,
    menuItems: BRANCH_1_MENU_ITEMS,
    tables: [
      { id: `tbl-${outlet.id}-1`, number: 'T01', capacity: 2, section: 'Main Dining Hall', qrTokenVersion: 1, isActive: true, x: 40, y: 40 },
      { id: `tbl-${outlet.id}-2`, number: 'T02', capacity: 4, section: 'Main Dining Hall', qrTokenVersion: 1, isActive: true, x: 180, y: 40 },
      { id: `tbl-${outlet.id}-3`, number: 'T03', capacity: 4, section: 'Verandah / Terrace', qrTokenVersion: 1, isActive: true, x: 40, y: 180 },
      { id: `tbl-${outlet.id}-4`, number: 'T04', capacity: 6, section: 'Family Lounge', qrTokenVersion: 1, isActive: true, x: 40, y: 320 },
      { id: `tbl-${outlet.id}-5`, number: 'T05', capacity: 4, section: 'Main Dining Hall', qrTokenVersion: 1, isActive: true, x: 320, y: 40 },
      { id: `tbl-${outlet.id}-6`, number: 'T06', capacity: 8, section: 'Family Lounge', qrTokenVersion: 1, isActive: true, x: 180, y: 320 },
    ],
    sessions: [],
    activeOrders: [],
    pastOrders: [],
    payments: [],
    invoices: [],
    dailyRollups: [],
    hourlyRollups: [],
    coupons: [],
    feedback: [],
    serviceCalls: [],
    staffMembers: allStaff.filter((s) => s.outletId === outlet.id || s.outletId === null),
  };
}

export function formatPaise(paise: number): string {
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', {
    minimumFractionDigits: paise % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/** Format an ISO/date timestamp as date + time, keeping human-readable relative labels intact. */
export function formatOrderDateTime(value?: string | null): string {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (!/\d{4}-\d{2}-\d{2}/.test(trimmed) && !trimmed.includes('GMT') && !trimmed.includes('T')) {
    return trimmed;
  }
  const dt = new Date(trimmed);
  if (Number.isNaN(dt.getTime())) return trimmed;
  return dt.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Derive parent order status from item statuses matching backend order-state-machine. */
export function deriveOrderStatusFromItems(
  items: Array<{ status?: OrderItem['status'] }>,
  fallbackStatus: Order['status'],
): Order['status'] {
  const active = items.filter((it) => it.status !== 'CANCELLED');
  if (active.length === 0) return 'CANCELLED';
  if (active.every((it) => it.status === 'SERVED')) return 'SERVED';
  if (active.every((it) => it.status === 'READY' || it.status === 'SERVED')) return 'READY';
  if (active.some((it) => it.status === 'PREPARING')) return 'PREPARING';
  return fallbackStatus;
}
