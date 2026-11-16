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
