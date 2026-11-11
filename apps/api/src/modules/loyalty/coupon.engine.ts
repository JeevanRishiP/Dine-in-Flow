/**
 * Pure Coupon Engine
 *
 * Implements rule evaluation for coupon redemption.
 * Rules are pure functions without side-effects (AGENTS §4, §5).
 * All monetary amounts are integer paise.
 *
 * Reference: ARCH §18, §10, AGENTS §2 rule 1+2
 */

export interface CouponRuleData {
  id: string;
  code: string;
  type: 'PERCENT' | 'FLAT';
  value: number; // bps (e.g. 2000 = 20%) or paise
  maxDiscountPaise?: number | null;
  minOrderPaise: number;
  audience: 'ALL' | 'SIGNED_IN' | 'NEW' | 'RETURNING';
  validFrom: Date | string;
  validTo: Date | string;
  usageLimitTotal?: number | null;
  usageLimitPerCustomer: number;
  stackable: boolean;
  outlets: string[]; // empty means all
  isActive: boolean;
  totalUsageCount?: number;
  customerUsageCount?: number;
}

export interface CouponEvaluationContext {
  subtotalPaise: number;
  outletId: string;
  customerId?: string | null;
  customerOrderCount?: number; // 0 = new customer, >0 = returning
  now?: Date;
}

export interface CouponEvaluationResult {
  valid: boolean;
  discountPaise: number;
  description: string;
  reason?: string;
}

/**
 * Evaluates whether a coupon can be applied to the current cart/order,
 * and computes the discount in integer paise.
 */
export function evaluateCoupon(
  coupon: CouponRuleData,
  ctx: CouponEvaluationContext,
): CouponEvaluationResult {
  const now = ctx.now ?? new Date();
  const validFrom = new Date(coupon.validFrom);
  const validTo = new Date(coupon.validTo);

  // 1. Active check
  if (!coupon.isActive) {
    return { valid: false, discountPaise: 0, description: '', reason: 'Coupon is not active.' };
  }

  // 2. Validity window
  if (now < validFrom || now > validTo) {
    return { valid: false, discountPaise: 0, description: '', reason: 'Coupon is expired or not yet valid.' };
  }

  // 3. Outlet restriction
  if (coupon.outlets.length > 0 && !coupon.outlets.includes(ctx.outletId)) {
    return { valid: false, discountPaise: 0, description: '', reason: 'Coupon is not valid at this outlet.' };
  }

  // 4. Minimum order subtotal
  if (ctx.subtotalPaise < coupon.minOrderPaise) {
    const minRs = Math.ceil(coupon.minOrderPaise / 100);
    return {
      valid: false,
      discountPaise: 0,
      description: '',
      reason: `Minimum order amount of ₹${minRs} required to apply this coupon.`,
    };
  }

  // 5. Total usage limit
  if (
    coupon.usageLimitTotal !== undefined &&
    coupon.usageLimitTotal !== null &&
    (coupon.totalUsageCount ?? 0) >= coupon.usageLimitTotal
  ) {
    return { valid: false, discountPaise: 0, description: '', reason: 'Coupon usage limit has been reached.' };
  }

  // 6. Audience & per-customer limits
  if (coupon.audience !== 'ALL') {
    if (!ctx.customerId) {
      return {
        valid: false,
        discountPaise: 0,
        description: '',
        reason: 'Please sign in to use this coupon.',
      };
    }

    const orderCount = ctx.customerOrderCount ?? 0;
    if (coupon.audience === 'NEW' && orderCount > 0) {
      return {
        valid: false,
        discountPaise: 0,
        description: '',
        reason: 'This coupon is only valid for your first order.',
      };
    }

    if (coupon.audience === 'RETURNING' && orderCount === 0) {
      return {
        valid: false,
        discountPaise: 0,
        description: '',
        reason: 'This coupon is valid for returning customers only.',
      };
    }
  }

  if (ctx.customerId && coupon.usageLimitPerCustomer > 0) {
    const customerUses = coupon.customerUsageCount ?? 0;
    if (customerUses >= coupon.usageLimitPerCustomer) {
      return {
        valid: false,
        discountPaise: 0,
        description: '',
        reason: 'You have already used this coupon the maximum allowed times.',
      };
    }
  }

  // 7. Calculate discount
  let discountPaise = 0;
  if (coupon.type === 'PERCENT') {
    // value is in basis points, e.g. 2000 = 20%
    const rawDiscount = (ctx.subtotalPaise * coupon.value) / 10_000;
    discountPaise = Math.round(rawDiscount);

    if (coupon.maxDiscountPaise && discountPaise > coupon.maxDiscountPaise) {
      discountPaise = coupon.maxDiscountPaise;
    }
  } else {
    // FLAT discount in paise
    discountPaise = Math.min(coupon.value, ctx.subtotalPaise);
  }

  // Cap at subtotal
  discountPaise = Math.min(discountPaise, ctx.subtotalPaise);

  const percentLabel = coupon.type === 'PERCENT' ? `${coupon.value / 100}% off` : `₹${coupon.value / 100} off`;
  const description = `${coupon.code} — ${percentLabel}`;

  return {
    valid: true,
    discountPaise,
    description,
  };
}
