import test from 'node:test';
import assert from 'node:assert/strict';
import { useOrderStore, computeCouponDiscountPaise } from './useOrderStore.ts';
import type { MenuItem } from '../types/index.ts';

const mockItem: MenuItem = {
  id: 'dish-paneer-tikka',
  name: 'Paneer Tikka',
  description: 'Charcoal grilled cottage cheese',
  category: 'Starters',
  pricePaise: 25000, // ₹250.00
  dietaryTag: 'VEG',
  spiceLevel: 'MEDIUM',
  cuisine: 'NORTH_INDIAN',
  isHealthy: true,
  isAvailable: true,
  rating: 4.8,
  ordersCount: 120,
  prepTimeMinutes: 15,
  imageUrl: 'https://example.com/paneer.jpg',
  modifiers: [],
};

const mockItemWithMods: MenuItem = {
  ...mockItem,
  id: 'dish-biryani',
  name: 'Hyderabadi Biryani',
  pricePaise: 35000, // ₹350.00
  modifiers: [
    {
      id: 'mod-extra-raita',
      name: 'Extra Raita',
      pricePaise: 3000, // ₹30.00
    },
  ],
};

test('useOrderStore initializes with default empty state', () => {
  const state = useOrderStore.getState();
  assert.equal(state.selectedTable, '--');
  assert.equal(state.tablePax, 2);
  assert.equal(state.activeModal, null);
  assert.equal(state.cartLines.length, 0);
  assert.equal(state.getCartSubtotalPaise(), 0);
  assert.equal(state.getCartGrandTotalPaise(), 0);
});

test('useOrderStore quickAdd & quickDecrement updates cart in integer paise', () => {
  const store = useOrderStore.getState();
  store.clearCart();

  // Add 1 Paneer Tikka (₹250 = 25000 paise)
  store.quickAdd(mockItem);
  assert.equal(useOrderStore.getState().cartLines.length, 1);
  assert.equal(useOrderStore.getState().getItemCartQty(mockItem.id), 1);
  assert.equal(useOrderStore.getState().getCartSubtotalPaise(), 25000);

  // Add another Paneer Tikka (qty should be 2, subtotal ₹500 = 50000 paise)
  store.quickAdd(mockItem);
  assert.equal(useOrderStore.getState().cartLines.length, 1);
  assert.equal(useOrderStore.getState().getItemCartQty(mockItem.id), 2);
  assert.equal(useOrderStore.getState().getCartSubtotalPaise(), 50000);

  // Decrement once (qty should be 1, subtotal 25000 paise)
  store.quickDecrement(mockItem.id);
  assert.equal(useOrderStore.getState().getItemCartQty(mockItem.id), 1);
  assert.equal(useOrderStore.getState().getCartSubtotalPaise(), 25000);

  // Decrement to zero (item should be removed)
  store.quickDecrement(mockItem.id);
  assert.equal(useOrderStore.getState().getItemCartQty(mockItem.id), 0);
  assert.equal(useOrderStore.getState().cartLines.length, 0);
  assert.equal(useOrderStore.getState().getCartSubtotalPaise(), 0);
});

test('useOrderStore computes coupon discounts, 5% GST, and grand total in integer paise', () => {
  const store = useOrderStore.getState();
  store.clearCart();

  // Add 2 Paneer Tikka = 50,000 paise (₹500.00)
  store.quickAdd(mockItem);
  store.quickAdd(mockItem);

  // Configure database coupons in store (100% DB-driven)
  store.setCoupons([
    {
      code: 'ROYAL15',
      tag: '15% OFF',
      title: 'Flat 15% OFF',
      description: '15% off orders above ₹500',
      minOrderPaise: 50000,
      type: 'PERCENTAGE',
      percent: 15,
      maxDiscountPaise: 10000,
    },
  ]);

  // ROYAL15 gives 15% off orders >= 50,000 paise
  store.setAppliedCoupon('ROYAL15');
  const subtotal = useOrderStore.getState().getCartSubtotalPaise();
  assert.equal(subtotal, 50000);

  // 15% of 50000 = 7500 paise (₹75.00)
  const discount = useOrderStore.getState().getDiscountPaise();
  assert.equal(discount, 7500);

  // Net subtotal = 50000 - 7500 = 42500 paise
  const netSubtotal = useOrderStore.getState().getNetSubtotalPaise();
  assert.equal(netSubtotal, 42500);

  // 5% GST on 42500 = Math.round(42500 * 0.05) = 2125 paise (₹21.25)
  const gst = useOrderStore.getState().getGstPaise();
  assert.equal(gst, 2125);

  // Grand total = 42500 + 2125 = 44625 paise
  const grandTotal = useOrderStore.getState().getCartGrandTotalPaise();
  assert.equal(grandTotal, 44625);
});

test('computeCouponDiscountPaise enforces minimum order threshold strictly', () => {
  const coupon = {
    code: 'TEST100',
    tag: 'TAG',
    title: 'Test',
    description: 'Test',
    minOrderPaise: 50000,
    type: 'FIXED' as const,
    fixedPaise: 10000,
  };

  // Below threshold: 0 discount
  assert.equal(computeCouponDiscountPaise(coupon, 49999), 0);

  // At or above threshold: 10000 paise discount
  assert.equal(computeCouponDiscountPaise(coupon, 50000), 10000);
});

test('useOrderStore triggers customizer callback when item requires modifiers', () => {
  const store = useOrderStore.getState();
  store.clearCart();

  let customizerOpened = false;
  store.quickAdd(mockItemWithMods, () => {
    customizerOpened = true;
  });

  // Should NOT directly add item to cart, but call customizer callback
  assert.equal(customizerOpened, true);
  assert.equal(useOrderStore.getState().cartLines.length, 0);
});

test('useOrderStore manages table and modal transitions cleanly', () => {
  const store = useOrderStore.getState();

  store.setSelectedTable('T-12', 4, 'tbl-123', 'sess-456');
  assert.equal(useOrderStore.getState().selectedTable, 'T-12');
  assert.equal(useOrderStore.getState().tablePax, 4);
  assert.equal(useOrderStore.getState().activeTableId, 'tbl-123');
  assert.equal(useOrderStore.getState().activeSessionId, 'sess-456');

  store.openModal('cart');
  assert.equal(useOrderStore.getState().activeModal, 'cart');
  assert.equal(useOrderStore.getState().isCartOpen, true);

  store.closeModal();
  assert.equal(useOrderStore.getState().activeModal, null);
  assert.equal(useOrderStore.getState().isCartOpen, false);
});

test('useOrderStore manages payment modal and gateway payload state', () => {
  const store = useOrderStore.getState();

  assert.equal(store.isPaymentModalOpen, false);
  assert.equal(store.selectedPaymentMethod, 'UPI');

  store.openModal('payment');
  assert.equal(useOrderStore.getState().isPaymentModalOpen, true);
  assert.equal(useOrderStore.getState().activeModal, 'payment');

  store.setSelectedPaymentMethod('CASH');
  assert.equal(useOrderStore.getState().selectedPaymentMethod, 'CASH');

  store.setPaymentQrData({
    paymentId: 'pay-test-123',
    orderId: 'ord-test-456',
    sessionId: 'sess-789',
    qrCodeUrl: 'https://example.com/qr',
    upiString: 'upi://pay?pa=test@phonepe',
    redirectUrl: 'https://mercury-uat.phonepe.com/transact',
  });
  assert.equal(useOrderStore.getState().paymentQrData?.paymentId, 'pay-test-123');
  assert.equal(useOrderStore.getState().paymentQrData?.redirectUrl, 'https://mercury-uat.phonepe.com/transact');

  store.setPaymentSuccessData({
    paymentId: 'pay-test-123',
    totalPaise: 44625,
  });
  assert.equal(useOrderStore.getState().paymentSuccessData?.totalPaise, 44625);

  store.closeModal();
  assert.equal(useOrderStore.getState().isPaymentModalOpen, false);
});

test('useOrderStore supports line-level increment, decrement, and table assignment', () => {
  const store = useOrderStore.getState();
  store.clearCart();

  store.quickAdd(mockItem);
  const lineId = useOrderStore.getState().cartLines[0]!.cartLineId;

  // Increment line quantity
  store.incrementCartLine(lineId);
  assert.equal(useOrderStore.getState().cartLines[0]!.quantity, 2);

  // Split plate assignment across tables
  store.assignCartLineTable(lineId, '15', 'tbl-15');
  const lines = useOrderStore.getState().cartLines;
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.quantity, 1);
  assert.equal(lines[1]!.quantity, 1);
  assert.equal(lines[1]!.targetTableNumber, '15');

  // Decrement line to removal
  store.decrementCartLine(lines[0]!.cartLineId);
  assert.equal(useOrderStore.getState().cartLines.length, 1);
});

test('useOrderStore manages smart scheduling, pre-booking and serve-later prompt snooze', () => {
  const store = useOrderStore.getState();

  // Pre-booking mode and party size
  store.setOrderType('PRE_BOOK_DINE_IN');
  store.setGuestCount(6);
  const scheduledTime = '2026-11-16T19:30:00.000Z';
  store.setScheduledFor(scheduledTime);
  store.setReservationId('res-1234-abcd');

  assert.equal(useOrderStore.getState().orderType, 'PRE_BOOK_DINE_IN');
  assert.equal(useOrderStore.getState().guestCount, 6);
  assert.equal(useOrderStore.getState().scheduledFor, scheduledTime);
  assert.equal(useOrderStore.getState().reservationId, 'res-1234-abcd');

  // Serve later snooze timestamp
  const snoozeUntil = Date.now() + 10 * 60 * 1000;
  store.setServeLaterDismissedUntil(snoozeUntil);
  assert.equal(useOrderStore.getState().serveLaterDismissedUntil, snoozeUntil);

  // Reset to regular dine-in
  store.setOrderType('DINE_IN');
  store.setScheduledFor(null);
  assert.equal(useOrderStore.getState().orderType, 'DINE_IN');
  assert.equal(useOrderStore.getState().scheduledFor, null);
});

test('useOrderStore manages omnichannel booking details and serve-later prompt', () => {
  const store = useOrderStore.getState();

  // Test setOrderMode
  store.setOrderMode('TAKEAWAY');
  assert.equal(useOrderStore.getState().orderType, 'TAKEAWAY');

  // Test setAllocatedTableNumbers
  store.setAllocatedTableNumbers(['T04', 'T05']);
  assert.deepEqual(useOrderStore.getState().allocatedTableNumbers, ['T04', 'T05']);

  // Test setBookingDetails
  const bookingIso = '2026-11-20T19:30:00.000Z';
  store.setBookingDetails({
    orderType: 'PRE_BOOK_DINE_IN',
    scheduledFor: bookingIso,
    guestCount: 8,
    reservationId: 'res-888',
    allocatedTableNumbers: ['T08', 'T09'],
  });

  const state = useOrderStore.getState();
  assert.equal(state.orderType, 'PRE_BOOK_DINE_IN');
  assert.equal(state.scheduledFor, bookingIso);
  assert.equal(state.guestCount, 8);
  assert.equal(state.reservationId, 'res-888');
  assert.deepEqual(state.allocatedTableNumbers, ['T08', 'T09']);

  // Test serveLaterPrompt setter
  store.setServeLaterPrompt({
    orderId: 'ord-123',
    itemNames: ['Gulab Jamun', 'Filter Coffee'],
    promptedAt: '2026-11-19T14:30:00.000Z',
  });
  assert.deepEqual(useOrderStore.getState().serveLaterPrompt, {
    orderId: 'ord-123',
    itemNames: ['Gulab Jamun', 'Filter Coffee'],
    promptedAt: '2026-11-19T14:30:00.000Z',
  });

  // Test clearBookingDetails resets state cleanly
  store.clearBookingDetails();
  const resetState = useOrderStore.getState();
  assert.equal(resetState.orderType, 'DINE_IN');
  assert.equal(resetState.scheduledFor, null);
  assert.equal(resetState.guestCount, 2);
  assert.equal(resetState.reservationId, null);
  assert.deepEqual(resetState.allocatedTableNumbers, []);
});

test('regression: resetCheckoutState wipes stale payment data so Order #2 opens clean', () => {
  const store = useOrderStore.getState();

  // Simulate Order #1 payment completion
  store.setPaymentSuccessData({
    paymentId: 'pay-ord-1',
    totalPaise: 85000,
  });
  store.setPaymentLoading(true);
  store.setPaymentQrData({
    paymentId: 'pay-ord-1',
    qrCodeUrl: 'https://phonepe.example/qr',
    upiString: 'upi://pay?pa=test',
  });

  assert.ok(useOrderStore.getState().paymentSuccessData !== null);
  assert.equal(useOrderStore.getState().paymentLoading, true);
  assert.ok(useOrderStore.getState().paymentQrData !== null);

  // Calling resetCheckoutState (e.g., when adding dishes for Order #2 or opening fresh checkout)
  store.resetCheckoutState();

  const cleanedState = useOrderStore.getState();
  assert.equal(cleanedState.paymentSuccessData, null, 'Stale paymentSuccessData must be cleared');
  assert.equal(cleanedState.paymentLoading, false);
  assert.equal(cleanedState.paymentQrData, null, 'Stale paymentQrData must be cleared');
});

test('computeCouponDiscountPaise computes exact non-zero savings for FLAT and PERCENTAGE coupons', () => {
  // FLAT coupon: saves fixed 10000 paise (₹100) on order >= 40000 paise (₹400)
  const flatCoupon = {
    code: 'FLAT100',
    type: 'FLAT' as const,
    minOrderPaise: 40000,
    discountValue: 10000,
    fixedPaise: 10000,
  };
  assert.equal(computeCouponDiscountPaise(flatCoupon, 50000), 10000);
  assert.equal(computeCouponDiscountPaise(flatCoupon, 35000), 0); // below min order

  // PERCENTAGE coupon: saves 20% capped at 8000 paise (₹80)
  const pctCoupon = {
    code: 'FESTIVE20',
    type: 'PERCENTAGE' as const,
    minOrderPaise: 30000,
    percent: 20,
    maxDiscountPaise: 8000,
  };
  // 20% of 35000 = 7000
  assert.equal(computeCouponDiscountPaise(pctCoupon, 35000), 7000);
  // 20% of 50000 = 10000, capped at maxDiscountPaise = 8000
  assert.equal(computeCouponDiscountPaise(pctCoupon, 50000), 8000);
});

test('unauthenticated coupon apply sets pendingCouponCode and preserves cartLines & table 100%', () => {
  const store = useOrderStore.getState();
  store.clearCart();
  store.setSelectedTable('T09', 4, 'tbl-09');
  store.setOrderType('DINE_IN');
  store.quickAdd(mockItem);

  assert.equal(useOrderStore.getState().cartLines.length, 1);
  assert.equal(useOrderStore.getState().selectedTable, 'T09');

  // Customer attempts to apply coupon while unauthenticated
  store.setPendingCouponCode('WELCOME50');
  store.setIsAuthModalOpen(true);

  // Cart and table are 100% preserved
  const currentState = useOrderStore.getState();
  assert.equal(currentState.pendingCouponCode, 'WELCOME50');
  assert.equal(currentState.isAuthModalOpen, true);
  assert.equal(currentState.cartLines.length, 1);
  assert.equal(currentState.cartLines[0]!.item.id, mockItem.id);
  assert.equal(currentState.selectedTable, 'T09');
  assert.equal(currentState.orderType, 'DINE_IN');

  // Login completes: pendingCouponCode is consumed, cart and table remain intact
  store.setPendingCouponCode(null);
  store.setIsAuthModalOpen(false);
  store.setAppliedCoupon('WELCOME50');
  store.setAppliedCouponDiscountPaise(5000);

  const finalState = useOrderStore.getState();
  assert.equal(finalState.appliedCoupon, 'WELCOME50');
  assert.equal(finalState.getDiscountPaise(), 5000);
  assert.equal(finalState.cartLines.length, 1);
  assert.equal(finalState.selectedTable, 'T09');
});

test('zero hardcoded fallback: empty DB coupon array produces zero coupons in store', () => {
  const store = useOrderStore.getState();
  store.setCoupons([]);
  assert.equal(useOrderStore.getState().coupons.length, 0);

  // Setting an unknown coupon when DB is empty results in 0 discount
  store.setAppliedCoupon('FAKE100');
  assert.equal(useOrderStore.getState().getDiscountPaise(), 0);
});

test('item without modifierGroups allows direct quickAdd to cart', () => {
  const store = useOrderStore.getState();
  store.clearCart();

  const plainItem: MenuItem = {
    ...mockItem,
    id: 'dish-plain-roti',
    name: 'Tandoori Roti',
    pricePaise: 3000,
    modifiers: [],
    modifierGroups: [],
  };

  let modalOpened = false;
  store.quickAdd(plainItem, () => {
    modalOpened = true;
  });

  assert.equal(modalOpened, false, 'Modal must NOT open for items with zero modifiers');
  assert.equal(useOrderStore.getState().cartLines.length, 1);
  assert.equal(useOrderStore.getState().cartLines[0]!.item.id, 'dish-plain-roti');
});
