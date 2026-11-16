import { create } from 'zustand';
import type {
  CartLineItem,
  MenuItem,
  ModifierOption,
  AvailableCoupon,
  ActiveModalType,
} from '../types';

// ============================================================================
// Constants & Minor-Unit (Paise) Helper Functions
// ============================================================================

export const DEFAULT_COUPONS: AvailableCoupon[] = [
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

/**
 * Calculates discount in integer minor units (paise).
 * Rule 2.1: No floating-point money.
 */
export function computeCouponDiscountPaise(coupon: AvailableCoupon, subtotalPaise: number): number {
  if (subtotalPaise < coupon.minOrderPaise) return 0;
  if (coupon.type === 'PERCENT' && coupon.percent) {
    return Math.round((subtotalPaise * coupon.percent) / 100);
  }
  if (coupon.type === 'FIXED' && coupon.fixedPaise) {
    return Math.min(coupon.fixedPaise, subtotalPaise);
  }
  return 0;
}

const STORAGE_CART_KEY = 'dineflow_customer_cart_v2';

function persistCartToStorage(cartLines: CartLineItem[]) {
  if (typeof window === 'undefined') return;
  try {
    if (cartLines.length > 0) {
      localStorage.setItem(STORAGE_CART_KEY, JSON.stringify(cartLines));
    } else {
      localStorage.removeItem(STORAGE_CART_KEY);
    }
  } catch {
    // Ignore storage quota or access errors in restricted browser contexts
  }
}

// ============================================================================
// State Interface
// ============================================================================

export interface OrderState {
  // ── Cart & Items State ──
  cartLines: CartLineItem[];
  appliedCoupon: string | null;
  coupons: AvailableCoupon[];

  // ── Table & Session State ──
  selectedTable: string;
  tablePax: number;
  activeTableId: string;
  activeSessionId: string;
  activeOrgId: string;
  activeOutletId: string;
  isTableVerified: boolean;
  activeOrderCount: number;
  setActiveOrderCount: (count: number) => void;

  // ── Modals & Overlays ──
  activeModal: ActiveModalType;
  customizingItem: MenuItem | null;
  setCustomizingItem: (item: MenuItem | null) => void;

  // ── Wishlist State ──
  wishlist: string[];

  // ── Computed Getters (Integer Paise Only) ──
  getCartItemCount: () => number;
  getCartSubtotalPaise: () => number;
  getDiscountPaise: () => number;
  getNetSubtotalPaise: () => number;
  getGstPaise: () => number;
  getCartGrandTotalPaise: () => number;
  getItemCartQty: (itemId: string) => number;
  isInWishlist: (itemId: string) => boolean;

  // ── Actions ──
  setCartLines: (updater: CartLineItem[] | ((prev: CartLineItem[]) => CartLineItem[])) => void;
  quickAdd: (item: MenuItem, onCustomizationNeeded?: (item: MenuItem) => void) => void;
  quickDecrement: (itemId: string) => void;
  incrementCartLine: (cartLineId: string) => void;
  decrementCartLine: (cartLineId: string) => void;
  assignCartLineTable: (cartLineId: string, tableNumber: string, tableId?: string) => void;
  addCartLine: (line: CartLineItem) => void;
  removeCartLine: (cartLineId: string) => void;
  clearCart: () => void;
  setAppliedCoupon: (couponCode: string | null) => void;

  setSelectedTable: (table: string, pax?: number, tableId?: string, sessionId?: string) => void;
  setIsTableVerified: (verified: boolean) => void;
  setSessionDetails: (details: {
    sessionId?: string;
    tableId?: string;
    orgId?: string;
    outletId?: string;
  }) => void;

  openModal: (modal: ActiveModalType) => void;
  closeModal: () => void;

  // Backward-compatible individual modal helpers
  isCartOpen: boolean;
  setIsCartOpen: (open: boolean) => void;
  isTableModalOpen: boolean;
  setIsTableModalOpen: (open: boolean) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  isOrdersHistoryOpen: boolean;
  setIsOrdersHistoryOpen: (open: boolean) => void;
  isPaymentModalOpen: boolean;
  setIsPaymentModalOpen: (open: boolean) => void;

  // ── Payment & Settlement State ──
  selectedPaymentMethod: 'UPI' | 'CASH';
  setSelectedPaymentMethod: (method: 'UPI' | 'CASH') => void;
  paymentLoading: boolean;
  setPaymentLoading: (loading: boolean) => void;
  paymentQrData: {
    paymentId: string;
    orderId?: string;
    sessionId?: string;
    qrCodeUrl: string;
    upiString: string;
    redirectUrl?: string;
  } | null;
  setPaymentQrData: (data: {
    paymentId: string;
    orderId?: string;
    sessionId?: string;
    qrCodeUrl: string;
    upiString: string;
    redirectUrl?: string;
  } | null) => void;
  paymentSuccessData: {
    paymentId: string;
    totalPaise: number;
  } | null;
  setPaymentSuccessData: (data: {
    paymentId: string;
    totalPaise: number;
  } | null) => void;

  toggleWishlist: (itemId: string) => void;
  hydrateFromStorage: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useOrderStore = create<OrderState>((set, get) => ({
  // Initial state
  cartLines: [],
  appliedCoupon: null,
  coupons: DEFAULT_COUPONS,

  selectedTable: '--',
  tablePax: 2,
  activeTableId: '',
  activeSessionId: '',
  activeOrgId: '',
  activeOutletId: '',
  isTableVerified: false,
  activeOrderCount: 0,

  activeModal: null,
  customizingItem: null,
  isCartOpen: false,
  isTableModalOpen: false,
  isAuthModalOpen: false,
  isOrdersHistoryOpen: false,
  isPaymentModalOpen: false,
  selectedPaymentMethod: 'UPI',
  paymentLoading: false,
  paymentQrData: null,
  paymentSuccessData: null,

  wishlist: [],

  // ── Computed Getters ──
  getCartItemCount: () => {
    return get().cartLines.reduce((acc, c) => acc + c.quantity, 0);
  },

  getCartSubtotalPaise: () => {
    return get().cartLines.reduce((acc, c) => {
      const modsTotal = (c.selectedModifiers || []).reduce(
        (mAcc: number, m: ModifierOption) => mAcc + m.pricePaise,
        0,
      );
      return acc + (c.item.pricePaise + modsTotal) * c.quantity;
    }, 0);
  },

  getDiscountPaise: () => {
    const { appliedCoupon, coupons, getCartSubtotalPaise } = get();
    if (!appliedCoupon) return 0;
    const found = coupons.find((c) => c.code === appliedCoupon);
    if (!found) return 0;
    return computeCouponDiscountPaise(found, getCartSubtotalPaise());
  },

  getNetSubtotalPaise: () => {
    const subtotal = get().getCartSubtotalPaise();
    const discount = get().getDiscountPaise();
    return Math.max(0, subtotal - discount);
  },

  getGstPaise: () => {
    const net = get().getNetSubtotalPaise();
    return Math.round(net * 0.05); // 5% GST on dine-in services
  },

  getCartGrandTotalPaise: () => {
    const net = get().getNetSubtotalPaise();
    const gst = get().getGstPaise();
    return net + gst;
  },

  getItemCartQty: (itemId: string) => {
    return get()
      .cartLines.filter((c) => c.item.id === itemId)
      .reduce((acc, c) => acc + c.quantity, 0);
  },

  isInWishlist: (itemId: string) => {
    return get().wishlist.includes(itemId);
  },

  // ── Actions ──
  setCartLines: (updater) => {
    set((state) => {
      const nextLines = typeof updater === 'function' ? updater(state.cartLines) : updater;
      persistCartToStorage(nextLines);
      return { cartLines: nextLines };
    });
  },

  quickAdd: (item, onCustomizationNeeded) => {
    // If the item has modifiers/customizations, request parent/customizer to open
    if (item.modifiers && item.modifiers.length > 0) {
      if (onCustomizationNeeded) {
        onCustomizationNeeded(item);
        return;
      }
    }

    set((state) => {
      const prev = state.cartLines;
      const existingIdx = prev.findIndex(
        (c) => c.item.id === item.id && !c.plateLabel && !c.notes,
      );
      let nextLines: CartLineItem[];
      if (existingIdx >= 0) {
        const copy = [...prev];
        const existing = copy[existingIdx]!;
        copy[existingIdx] = {
          ...existing,
          quantity: existing.quantity + 1,
        };
        nextLines = copy;
      } else {
        nextLines = [
          ...prev,
          {
            cartLineId: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            item,
            quantity: 1,
            spiceLevel: item.spiceLevel,
            selectedModifiers: [],
          },
        ];
      }
      persistCartToStorage(nextLines);
      return { cartLines: nextLines };
    });
  },

  quickDecrement: (itemId: string) => {
    set((state) => {
      const prev = state.cartLines;
      const idx = prev.findIndex((c) => c.item.id === itemId);
      if (idx < 0) return {};
      const target = prev[idx]!;
      let nextLines: CartLineItem[];
      if (target.quantity <= 1) {
        nextLines = prev.filter((_, i) => i !== idx);
      } else {
        const copy = [...prev];
        copy[idx] = { ...target, quantity: target.quantity - 1 };
        nextLines = copy;
      }
      persistCartToStorage(nextLines);
      return { cartLines: nextLines };
    });
  },

  incrementCartLine: (cartLineId) => {
    set((state) => {
      const nextLines = state.cartLines.map((c) =>
        c.cartLineId === cartLineId ? { ...c, quantity: c.quantity + 1 } : c,
      );
      persistCartToStorage(nextLines);
      return { cartLines: nextLines };
    });
  },

  decrementCartLine: (cartLineId) => {
    set((state) => {
      const target = state.cartLines.find((c) => c.cartLineId === cartLineId);
      if (!target) return {};
      let nextLines: CartLineItem[];
      if (target.quantity <= 1) {
        nextLines = state.cartLines.filter((c) => c.cartLineId !== cartLineId);
      } else {
        nextLines = state.cartLines.map((c) =>
          c.cartLineId === cartLineId ? { ...c, quantity: c.quantity - 1 } : c,
        );
      }
      persistCartToStorage(nextLines);
      return { cartLines: nextLines };
    });
  },

  assignCartLineTable: (cartLineId, tableNumber, tableId) => {
    set((state) => {
      const next: CartLineItem[] = [];
      for (const line of state.cartLines) {
        if (line.cartLineId !== cartLineId) {
          next.push(line);
          continue;
        }
        if (line.quantity > 1) {
          next.push({ ...line, quantity: line.quantity - 1 });
          next.push({
            ...line,
            cartLineId: `${line.item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            quantity: 1,
            targetTableNumber: tableNumber,
            targetTableId: tableId,
          });
        } else {
          next.push({
            ...line,
            targetTableNumber: tableNumber,
            targetTableId: tableId,
          });
        }
      }
      persistCartToStorage(next);
      return { cartLines: next };
    });
  },

  addCartLine: (line) => {
    set((state) => {
      const nextLines = [...state.cartLines, line];
      persistCartToStorage(nextLines);
      return { cartLines: nextLines };
    });
  },

  removeCartLine: (cartLineId) => {
    set((state) => {
      const nextLines = state.cartLines.filter((c) => c.cartLineId !== cartLineId);
      persistCartToStorage(nextLines);
      return { cartLines: nextLines };
    });
  },

  clearCart: () => {
    persistCartToStorage([]);
    set({ cartLines: [], appliedCoupon: null });
  },

  setAppliedCoupon: (code) => {
    set({ appliedCoupon: code });
  },

  setSelectedTable: (table, pax = 2, tableId = '', sessionId = '') => {
    set({
      selectedTable: table,
      tablePax: pax,
      ...(tableId ? { activeTableId: tableId } : {}),
      ...(sessionId ? { activeSessionId: sessionId } : {}),
    });
  },

  setIsTableVerified: (verified) => {
    set({ isTableVerified: verified });
  },

  setActiveOrderCount: (count) => {
    set({ activeOrderCount: Math.max(0, count) });
  },

  setSessionDetails: (details) => {
    set((state) => ({
      activeSessionId: details.sessionId ?? state.activeSessionId,
      activeTableId: details.tableId ?? state.activeTableId,
      activeOrgId: details.orgId ?? state.activeOrgId,
      activeOutletId: details.outletId ?? state.activeOutletId,
    }));
  },

  openModal: (modal) => {
    set({
      activeModal: modal,
      isCartOpen: modal === 'cart',
      isTableModalOpen: modal === 'table',
      isAuthModalOpen: modal === 'auth',
      isOrdersHistoryOpen: modal === 'orders',
      isPaymentModalOpen: modal === 'payment',
    });
  },

  closeModal: () => {
    set({
      activeModal: null,
  customizingItem: null,
      isCartOpen: false,
      isTableModalOpen: false,
      isAuthModalOpen: false,
      isOrdersHistoryOpen: false,
      isPaymentModalOpen: false,
    });
  },

  setIsCartOpen: (open) => {
    set({
      isCartOpen: open,
      activeModal: open ? 'cart' : null,
    });
  },

  setIsTableModalOpen: (open) => {
    set({
      isTableModalOpen: open,
      activeModal: open ? 'table' : null,
    });
  },

  setIsAuthModalOpen: (open) => {
    set({
      isAuthModalOpen: open,
      activeModal: open ? 'auth' : null,
    });
  },

  setIsOrdersHistoryOpen: (open) => {
    set({
      isOrdersHistoryOpen: open,
      activeModal: open ? 'orders' : null,
    });
  },

  setIsPaymentModalOpen: (open) => {
    set({
      isPaymentModalOpen: open,
      activeModal: open ? 'payment' : null,
    });
  },

  setCustomizingItem: (item) => {
    set({
      customizingItem: item,
      activeModal: item ? 'customizer' : null,
    });
  },

  setSelectedPaymentMethod: (method) => set({ selectedPaymentMethod: method }),
  setPaymentLoading: (loading) => set({ paymentLoading: loading }),
  setPaymentQrData: (data) => set({ paymentQrData: data }),
  setPaymentSuccessData: (data) => set({ paymentSuccessData: data }),

  toggleWishlist: (itemId) => {
    set((state) => {
      const exists = state.wishlist.includes(itemId);
      return {
        wishlist: exists
          ? state.wishlist.filter((id) => id !== itemId)
          : [...state.wishlist, itemId],
      };
    });
  },

  hydrateFromStorage: () => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(STORAGE_CART_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          set({ cartLines: parsed });
        }
      }
    } catch {
      // Ignore parse failure
    }
    try {
      const rawSession = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('dineflow_guest_session_v1') : null;
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess?.sessionId) {
          set({
            activeSessionId: sess.sessionId,
            activeTableId: sess.tableId || '',
            activeOrgId: sess.orgId || '',
            activeOutletId: sess.outletId || '',
            selectedTable: sess.tableNumber || get().selectedTable,
            isTableVerified: true,
          });
        }
      }
    } catch {
      // Ignore session read failure
    }
  },
}));
