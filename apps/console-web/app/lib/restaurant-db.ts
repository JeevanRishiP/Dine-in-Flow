/**
 * DineFlow Operational Restaurant Database
 *
 * Enforcing 100% Database-Only Multi-Tenant Rule:
 * ZERO hardcoded business data. All static master arrays default to empty.
 * If database is empty, UI renders clean empty states.
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
  nameHindi?: string;
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
  nameHindi?: string;
  sortOrder: number;
  isActive: boolean;
}

export interface Table {
  id: string;
  number: string;
  capacity: number;
  section: string;
  qrTokenVersion: number;
  isActive: boolean;
  x?: number;
  y?: number;
  table_number?: string;
  qr_token_version?: number;
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
  targetTableId?: string | null;
  dinerId?: string | null;
  dinerLabel?: string | null;
  createdAt?: string;
  courseSequence?: number;
  prepTimeMinutes?: number;
  targetFireAt?: string | null;
  holdStatus?: 'ACTIVE' | 'SCHEDULED_WAIT' | 'SERVE_LATER_HOLD' | 'RELEASED';
  isComboItem?: boolean;
  comboName?: string | null;
}

export interface KdsItemTicket {
  itemId: string;
  orderId: string;
  displayId?: string;
  orderDisplayId: string;
  orderNumber?: number | null;
  orderType: 'DINE_IN' | 'PRE_BOOK_DINE_IN' | 'TAKEAWAY';
  tableId?: string | null;
  tableNumber: string;
  dinerId?: string | null;
  dinerLabel?: string | null;
  scheduledFor: string | null;
  dishName: string;
  quantity: number;
  modifiers: unknown[];
  spiceLevel: string | null;
  notes: string | null;
  isComboItem: boolean;
  comboName: string | null;
  courseSequence: number;
  prepTimeMinutes: number;
  targetFireAt: string | null;
  holdStatus: 'ACTIVE' | 'SCHEDULED_WAIT' | 'SERVE_LATER_HOLD' | 'RELEASED';
  itemStatus: string;
  paidAt: string | null;
  claimedByStaffId?: string | null;
  claimedAt?: string | null;
}

export interface TableReservationRecord {
  id: string;
  tableNumber: string;
  guestCount: number;
  reservedFor: string;
  customerName?: string;
  status?: string;
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
  tableId?: string;
  tableNumber: string;
  sessionId: string;
  dinerId?: string | null;
  dinerLabel?: string | null;
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
  paymentStatus?: string;
  orderType?: 'DINE_IN' | 'PRE_BOOK_DINE_IN' | 'TAKEAWAY';
  scheduledFor?: string | null;
  paidAt?: string | null;
  mainCourseServedAt?: string | null;
  serveLaterPromptSentAt?: string | null;
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
// CONSTANT MASTER DATA (100% Empty per strict database-only multi-tenant rule)
// -----------------------------------------------------------------------------

export const ORGANIZATION = {
  id: '',
  name: '',
  slug: '',
  currency: 'INR',
  currencySymbol: '₹',
  plan: 'pro',
  timezone: 'Asia/Kolkata',
  gstin: '',
  fssai: '',
};

export const OUTLETS: Outlet[] = [];
export const ALL_STAFF_MEMBERS: StaffMember[] = [];
export const BRANCH_1_CATEGORIES: MenuCategory[] = [];
export const BRANCH_1_MENU_ITEMS: MenuItem[] = [];
export const BRANCH_1_TABLES: Table[] = [];
export const BRANCH_1_SESSIONS: TableSession[] = [];
export const BRANCH_1_ACTIVE_ORDERS: Order[] = [];
export const BRANCH_1_PAST_ORDERS: Order[] = [];
export const BRANCH_1_PAYMENTS: Payment[] = [];
export const BRANCH_1_INVOICES: Invoice[] = [];
export const BRANCH_1_DAILY_ROLLUPS: DailyRollup[] = [];
export const BRANCH_1_HOURLY_ROLLUPS: HourlyRollup[] = [];
export const BRANCH_1_COUPONS: Coupon[] = [];
export const BRANCH_1_FEEDBACK: FeedbackReview[] = [];
export const BRANCH_1_CALLS: ServiceCall[] = [];

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
// DYNAMIC STORAGE HELPERS (Local Fallback & JWT Cache)
// -----------------------------------------------------------------------------

export function getStoredOutlets(): Outlet[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('dineflow_custom_outlets');
    if (raw) {
      const custom: Outlet[] = JSON.parse(raw);
      if (Array.isArray(custom)) return custom;
    }
  } catch {}
  return [];
}

export function saveStoredOutlet(outlet: Outlet): Outlet[] {
  if (typeof window === 'undefined') return [outlet];
  try {
    const current = getStoredOutlets();
    const updated = [outlet, ...current.filter((o) => o.id !== outlet.id)];
    localStorage.setItem('dineflow_custom_outlets', JSON.stringify(updated));
    return updated;
  } catch {}
  return [outlet];
}

export function getStoredStaff(): StaffMember[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('dineflow_custom_staff_v2');
    localStorage.removeItem('dineflow_custom_staff');
    if (raw) {
      const custom: StaffMember[] = JSON.parse(raw);
      if (Array.isArray(custom)) return custom;
    }
  } catch {}
  return [];
}

export function saveStoredStaffMember(staff: StaffMember): StaffMember[] {
  if (typeof window === 'undefined') return [staff];
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
  return [staff];
}

export function deleteStoredStaffMember(staffId: string): StaffMember[] {
  if (typeof window === 'undefined') return [];
  try {
    const current = getStoredStaff();
    const updated = current.filter((s) => s.id !== staffId);
    localStorage.setItem('dineflow_custom_staff_v2', JSON.stringify(updated));
    return updated;
  } catch {}
  return [];
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
  const outlet = allOutlets.find((o) => o.id === outletId) ?? {
    id: outletId || '',
    orgId: '',
    name: '',
    shortName: '',
    address: '',
    timezone: 'Asia/Kolkata',
    isActive: true,
  };
  const allStaff = typeof window !== 'undefined' ? getStoredStaff() : ALL_STAFF_MEMBERS;

  return {
    outlet,
    isPopulated: false,
    categories: [],
    menuItems: [],
    tables: [],
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
