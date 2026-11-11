import { describe, it, expect } from 'vitest';
import { evaluateCoupon, type CouponRuleData } from '../coupon.engine.js';

describe('Coupon Engine (Pure Rule Evaluation)', () => {
  const baseCoupon: CouponRuleData = {
    id: 'coupon-uuid-1',
    code: 'SAVE20',
    type: 'PERCENT',
    value: 2000, // 20%
    maxDiscountPaise: 10000, // max ₹100
    minOrderPaise: 25000,    // min ₹250
    audience: 'ALL',
    validFrom: new Date('2026-01-01T00:00:00Z'),
    validTo: new Date('2026-12-31T23:59:59Z'),
    usageLimitTotal: 100,
    usageLimitPerCustomer: 2,
    stackable: false,
    outlets: [],
    isActive: true,
  };

  const defaultCtx = {
    subtotalPaise: 40000, // ₹400
    outletId: 'outlet-uuid-1',
    customerId: 'cust-uuid-1',
    customerOrderCount: 1,
    now: new Date('2026-06-01T12:00:00Z'),
  };

  it('calculates 20% discount with max cap correctly', () => {
    // 20% of ₹400 (40000 paise) = 8000 paise (₹80), under ₹100 cap
    const res = evaluateCoupon(baseCoupon, defaultCtx);
    expect(res.valid).toBe(true);
    expect(res.discountPaise).toBe(8000);
    expect(res.description).toContain('SAVE20 — 20% off');

    // 20% of ₹800 (80000 paise) = 16000 paise (₹160), capped at ₹100 (10000 paise)
    const cappedRes = evaluateCoupon(baseCoupon, { ...defaultCtx, subtotalPaise: 80000 });
    expect(cappedRes.valid).toBe(true);
    expect(cappedRes.discountPaise).toBe(10000);
  });

  it('calculates flat discount correctly', () => {
    const flatCoupon: CouponRuleData = {
      ...baseCoupon,
      type: 'FLAT',
      value: 5000, // ₹50 flat
      maxDiscountPaise: null,
    };
    const res = evaluateCoupon(flatCoupon, defaultCtx);
    expect(res.valid).toBe(true);
    expect(res.discountPaise).toBe(5000);
  });

  it('rejects coupon if subtotal is below min_order_paise', () => {
    const res = evaluateCoupon(baseCoupon, { ...defaultCtx, subtotalPaise: 20000 }); // ₹200 < ₹250
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Minimum order amount');
  });

  it('rejects expired or not-yet-valid coupons', () => {
    const expiredRes = evaluateCoupon(baseCoupon, {
      ...defaultCtx,
      now: new Date('2027-01-01T00:00:00Z'),
    });
    expect(expiredRes.valid).toBe(false);
    expect(expiredRes.reason).toContain('expired');

    const futureRes = evaluateCoupon(baseCoupon, {
      ...defaultCtx,
      now: new Date('2025-12-31T00:00:00Z'),
    });
    expect(futureRes.valid).toBe(false);
    expect(futureRes.reason).toContain('expired or not yet valid');
  });

  it('enforces audience restrictions (NEW vs RETURNING)', () => {
    const newCustomerCoupon: CouponRuleData = {
      ...baseCoupon,
      audience: 'NEW',
    };

    // Customer with 0 orders -> valid
    const newRes = evaluateCoupon(newCustomerCoupon, {
      ...defaultCtx,
      customerOrderCount: 0,
    });
    expect(newRes.valid).toBe(true);

    // Customer with 1+ orders -> rejected
    const returningRes = evaluateCoupon(newCustomerCoupon, {
      ...defaultCtx,
      customerOrderCount: 2,
    });
    expect(returningRes.valid).toBe(false);
    expect(returningRes.reason).toContain('first order');

    // Guest ordering with SIGNED_IN required coupon -> rejected
    const signedInCoupon: CouponRuleData = { ...baseCoupon, audience: 'SIGNED_IN' };
    const guestRes = evaluateCoupon(signedInCoupon, { ...defaultCtx, customerId: null });
    expect(guestRes.valid).toBe(false);
    expect(guestRes.reason).toContain('Please sign in');
  });

  it('enforces outlet scoping', () => {
    const outletScopedCoupon: CouponRuleData = {
      ...baseCoupon,
      outlets: ['outlet-uuid-allowed'],
    };

    const allowed = evaluateCoupon(outletScopedCoupon, {
      ...defaultCtx,
      outletId: 'outlet-uuid-allowed',
    });
    expect(allowed.valid).toBe(true);

    const denied = evaluateCoupon(outletScopedCoupon, {
      ...defaultCtx,
      outletId: 'outlet-uuid-other',
    });
    expect(denied.valid).toBe(false);
    expect(denied.reason).toContain('not valid at this outlet');
  });

  it('enforces total and per-customer usage limits', () => {
    // Total usage limit reached
    const totalLimitCoupon: CouponRuleData = {
      ...baseCoupon,
      usageLimitTotal: 50,
      totalUsageCount: 50,
    };
    const totalLimitRes = evaluateCoupon(totalLimitCoupon, defaultCtx);
    expect(totalLimitRes.valid).toBe(false);
    expect(totalLimitRes.reason).toContain('usage limit has been reached');

    // Per-customer usage limit reached
    const perCustomerCoupon: CouponRuleData = {
      ...baseCoupon,
      usageLimitPerCustomer: 1,
      customerUsageCount: 1,
    };
    const custLimitRes = evaluateCoupon(perCustomerCoupon, defaultCtx);
    expect(custLimitRes.valid).toBe(false);
    expect(custLimitRes.reason).toContain('already used this coupon the maximum allowed times');
  });
});
