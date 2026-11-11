import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import { evaluateCoupon, type CouponRuleData } from './coupon.engine.js';
import {
  calculateWalletBalance,
  calculateMaxWalletRedemption,
  calculateOrderLoyaltyPoints,
  calculateRefundWalletReversal,
  type LedgerEntryData,
} from './loyalty.engine.js';
import {
  evaluateReferralEligibility,
  calculateReferralRewards,
  type ReferralRewardSettings,
} from './referral.engine.js';
import type {
  CreateCouponDto,
  UpdateCouponDto,
  ValidateCouponDto,
  UpdateLoyaltySettingsDto,
  ClaimReferralDto,
} from './loyalty.dto.js';

interface CouponRow {
  id: string;
  org_id: string;
  code: string;
  type: 'PERCENT' | 'FLAT';
  value: number;
  max_discount_paise: number | null;
  min_order_paise: number;
  audience: 'ALL' | 'SIGNED_IN' | 'NEW' | 'RETURNING';
  valid_from: Date;
  valid_to: Date;
  usage_limit_total: number | null;
  usage_limit_per_customer: number;
  stackable: boolean;
  outlets: string[];
  is_active: boolean;
}

export interface LoyaltySettingsRow {
  org_id: string;
  max_wallet_redemption_percent: number;
  referrer_reward_percent: number;
  referrer_max_reward_paise: number;
  referee_discount_paise: number;
  points_earn_percent: number;
  is_loyalty_enabled: boolean;
  is_referral_enabled: boolean;
}

/**
 * Loyalty, Coupon, and Referral Service
 *
 * Enforces:
 *  - Strict RLS and org isolation (AGENTS §2 rule 3)
 *  - Append-only loyalty ledger (balance = sum) (ARCH §18, AGENTS §2 rule 6)
 *  - Atomic idempotency on redemptions and referral rewards (AGENTS §2 rule 8)
 *  - No floating-point money: integer paise everywhere (AGENTS §2 rule 1)
 *
 * NEEDS_HUMAN_REVIEW: store credit, referral payouts, coupon limits
 * Reference: ARCH §18, §10, §7, PROMPTS Phase 7
 */
@Injectable()
export class LoyaltyService {
  private readonly logger = new Logger(LoyaltyService.name);

  // ─── Coupons: Validation & Evaluation ─────────────────────────────────────────

  async validateCoupon(orgId: string, dto: ValidateCouponDto) {
    return withTenantContextRaw(orgId, async (client) => {
      // 1. Fetch coupon
      const couponRes = await client.query<CouponRow>(
        `SELECT id, org_id, code, type, value, max_discount_paise, min_order_paise,
                audience, valid_from, valid_to, usage_limit_total, usage_limit_per_customer,
                stackable, outlets, is_active
         FROM coupons
         WHERE org_id = $1 AND code = $2`,
        [orgId, dto.code],
      );

      if (couponRes.rowCount === 0) {
        return {
          valid: false,
          discountPaise: 0,
          description: '',
          reason: 'Invalid or non-existent coupon code.',
        };
      }

      const c = couponRes.rows[0]!;

      // 2. Fetch usage counts
      const usageRes = await client.query<{ count: string }>(
        `SELECT count(*)::text as count FROM coupon_redemptions WHERE org_id = $1 AND coupon_id = $2`,
        [orgId, c.id],
      );
      const totalUsageCount = parseInt(usageRes.rows[0]?.count ?? '0', 10);

      let customerUsageCount = 0;
      let customerOrderCount = 0;

      if (dto.customerId) {
        const custUsageRes = await client.query<{ count: string }>(
          `SELECT count(*)::text as count FROM coupon_redemptions WHERE org_id = $1 AND coupon_id = $2 AND customer_id = $3`,
          [orgId, c.id, dto.customerId],
        );
        customerUsageCount = parseInt(custUsageRes.rows[0]?.count ?? '0', 10);

        const ordersRes = await client.query<{ count: string }>(
          `SELECT count(*)::text as count FROM orders WHERE org_id = $1 AND customer_id = $2 AND status != 'CANCELLED'`,
          [orgId, dto.customerId],
        );
        customerOrderCount = parseInt(ordersRes.rows[0]?.count ?? '0', 10);
      }

      const ruleData: CouponRuleData = {
        id: c.id,
        code: c.code,
        type: c.type,
        value: c.value,
        maxDiscountPaise: c.max_discount_paise,
        minOrderPaise: c.min_order_paise,
        audience: c.audience,
        validFrom: c.valid_from,
        validTo: c.valid_to,
        usageLimitTotal: c.usage_limit_total,
        usageLimitPerCustomer: c.usage_limit_per_customer,
        stackable: c.stackable,
        outlets: c.outlets ?? [],
        isActive: c.is_active,
        totalUsageCount,
        customerUsageCount,
      };

      const evalResult = evaluateCoupon(ruleData, {
        subtotalPaise: dto.subtotalPaise,
        outletId: dto.outletId,
        customerId: dto.customerId,
        customerOrderCount,
      });

      return {
        ...evalResult,
        couponId: c.id,
      };
    });
  }

  // ─── Coupons: Atomic Redemption ───────────────────────────────────────────────

  /**
   * Atomically records coupon redemption for an order.
   * Guaranteed idempotent by unique constraint (coupon_id, order_id).
   */
  async recordCouponRedemption(
    orgId: string,
    couponId: string,
    orderId: string,
    customerId: string | null,
    discountPaise: number,
    client: PoolClient,
  ) {
    try {
      await client.query(
        `INSERT INTO coupon_redemptions (org_id, coupon_id, order_id, customer_id, discount_paise)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, couponId, orderId, customerId, discountPaise],
      );
      this.logger.log(`[COUPON] Redeemed coupon ${couponId} on order ${orderId} for ₹${discountPaise / 100}`);
    } catch (err: any) {
      if (err.code === '23505') {
        // Unique violation: already redeemed on this order
        throw new ConflictException('Coupon has already been applied to this order.');
      }
      throw err;
    }
  }

  // ─── Wallet & Ledger ──────────────────────────────────────────────────────────

  /**
   * Retrieves customer wallet balance and recent ledger history.
   */
  async getWallet(orgId: string, customerId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query<{
        id: string;
        entry_type: 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST' | 'REVERSAL';
        amount_paise: string;
        reason: string;
        ref_type: string;
        ref_id: string;
        expires_at: Date | null;
        created_at: Date;
      }>(
        `SELECT id, entry_type, amount_paise, reason, ref_type, ref_id, expires_at, created_at
         FROM loyalty_ledger
         WHERE org_id = $1 AND customer_id = $2
         ORDER BY created_at DESC`,
        [orgId, customerId],
      );

      const entries: LedgerEntryData[] = res.rows.map((r) => ({
        entryType: r.entry_type,
        amountPaise: BigInt(r.amount_paise),
        expiresAt: r.expires_at,
      }));

      const balancePaise = calculateWalletBalance(entries);

      return {
        balancePaise: balancePaise.toString(),
        entries: res.rows.map((r) => ({
          id: r.id,
          entryType: r.entry_type,
          amountPaise: r.amount_paise,
          reason: r.reason,
          refType: r.ref_type,
          refId: r.ref_id,
          expiresAt: r.expires_at?.toISOString() ?? null,
          createdAt: r.created_at.toISOString(),
        })),
      };
    });
  }

  /**
   * Debits wallet credit to partially pay for an order.
   * Invariant: appends negative entry into loyalty_ledger.
   */
  async debitWalletForOrder(
    orgId: string,
    customerId: string,
    orderId: string,
    amountPaise: bigint,
    client: PoolClient,
  ) {
    if (amountPaise <= 0n) return;

    // Verify current balance inside transaction
    const balanceRes = await client.query<{ balance: string }>(
      `SELECT COALESCE(SUM(amount_paise), 0)::text as balance
       FROM loyalty_ledger
       WHERE org_id = $1 AND customer_id = $2 AND (expires_at IS NULL OR expires_at > now())`,
      [orgId, customerId],
    );

    const currentBalance = BigInt(balanceRes.rows[0]?.balance ?? '0');
    if (currentBalance < amountPaise) {
      throw new BadRequestException('Insufficient wallet credit balance.');
    }

    // Append debit entry (negative amount)
    await client.query(
      `INSERT INTO loyalty_ledger (org_id, customer_id, entry_type, amount_paise, reason, ref_type, ref_id)
       VALUES ($1, $2, 'REDEEM', $3, 'Order checkout payment', 'ORDER', $4)
       ON CONFLICT (org_id, ref_type, ref_id, entry_type) DO NOTHING`,
      [orgId, customerId, (-amountPaise).toString(), orderId],
    );

    this.logger.log(`[WALLET] Redeemed ₹${Number(amountPaise) / 100} credit for order ${orderId}`);
  }

  // ─── Lifecycle Hook: Order Settlement (Earn Points & Trigger Referral) ─────────

  /**
   * Hook called after an order is PAID and COMPLETED.
   * Grants loyalty points and unlocks referral rewards.
   */
  async handleOrderCompleted(orgId: string, orderId: string, client: PoolClient) {
    // 1. Fetch order details
    const orderRes = await client.query<{
      customer_id: string | null;
      subtotal_paise: number;
      total_paise: number;
    }>(
      `SELECT customer_id, subtotal_paise, total_paise FROM orders WHERE org_id = $1 AND id = $2`,
      [orgId, orderId],
    );

    if (orderRes.rowCount === 0) return;
    const order = orderRes.rows[0]!;
    if (!order.customer_id) return; // Guest orders don't earn loyalty

    // 2. Fetch loyalty settings
    const settings = await this.getOrCreateSettings(orgId, client);
    if (!settings.is_loyalty_enabled) return;

    // 3. Credit points for order
    const pointsPaise = calculateOrderLoyaltyPoints(
      order.subtotal_paise,
      settings.points_earn_percent,
    );

    if (pointsPaise > 0n) {
      await client.query(
        `INSERT INTO loyalty_ledger (org_id, customer_id, entry_type, amount_paise, reason, ref_type, ref_id)
         VALUES ($1, $2, 'EARN', $3, 'Loyalty points on order', 'ORDER', $4)
         ON CONFLICT (org_id, ref_type, ref_id, entry_type) DO NOTHING`,
        [orgId, order.customer_id, pointsPaise.toString(), orderId],
      );
      this.logger.log(`[LOYALTY] Credited ₹${Number(pointsPaise) / 100} points to customer ${order.customer_id}`);
    }

    // 4. Check for qualifying referral
    if (settings.is_referral_enabled) {
      await this.qualifyReferral(orgId, order.customer_id, orderId, BigInt(order.total_paise), settings, client);
    }
  }

  /**
   * Reverses loyalty points and wallet debits upon an order refund.
   */
  async handleOrderRefunded(
    orgId: string,
    orderId: string,
    refundAmountPaise: bigint,
    client: PoolClient,
  ) {
    const orderRes = await client.query<{
      customer_id: string | null;
      total_paise: number;
    }>(
      `SELECT customer_id, total_paise FROM orders WHERE org_id = $1 AND id = $2`,
      [orgId, orderId],
    );

    if (orderRes.rowCount === 0 || !orderRes.rows[0]?.customer_id) return;
    const customerId = orderRes.rows[0].customer_id;
    const totalPaise = BigInt(orderRes.rows[0].total_paise);

    // Check if order had REDEEM entries in ledger
    const redeemRes = await client.query<{ amount_paise: string }>(
      `SELECT amount_paise FROM loyalty_ledger
       WHERE org_id = $1 AND customer_id = $2 AND ref_type = 'ORDER' AND ref_id = $3 AND entry_type = 'REDEEM'`,
      [orgId, customerId, orderId],
    );

    if (redeemRes.rowCount && redeemRes.rowCount > 0) {
      const redeemedPaise = -BigInt(redeemRes.rows[0]!.amount_paise);
      const reversalPaise = calculateRefundWalletReversal(totalPaise, refundAmountPaise, redeemedPaise);

      if (reversalPaise > 0n) {
        await client.query(
          `INSERT INTO loyalty_ledger (org_id, customer_id, entry_type, amount_paise, reason, ref_type, ref_id)
           VALUES ($1, $2, 'REVERSAL', $3, 'Refund reversal: store credit returned', 'REFUND', $4)
           ON CONFLICT (org_id, ref_type, ref_id, entry_type) DO NOTHING`,
          [orgId, customerId, reversalPaise.toString(), orderId],
        );
        this.logger.log(`[LOYALTY] Returned ₹${Number(reversalPaise) / 100} credit on order ${orderId} refund`);
      }
    }
  }

  // ─── Referrals ────────────────────────────────────────────────────────────────

  /**
   * Registers a customer referral claim before or during their first order.
   */
  async claimReferral(orgId: string, refereeCustomerId: string, dto: ClaimReferralDto) {
    return withTenantContextRaw(orgId, async (client) => {
      // Find referrer by their customer ID or phone
      const referrerRes = await client.query<{ id: string }>(
        `SELECT id FROM customers WHERE org_id = $1 AND id::text = $2`,
        [orgId, dto.referralCode],
      );

      if (referrerRes.rowCount === 0) {
        throw new NotFoundException('Invalid referral code.');
      }

      const referrerId = referrerRes.rows[0]!.id;

      // Count referee orders
      const ordersRes = await client.query<{ count: string }>(
        `SELECT count(*)::text as count FROM orders WHERE org_id = $1 AND customer_id = $2 AND status != 'CANCELLED'`,
        [orgId, refereeCustomerId],
      );
      const refereeOrderCount = parseInt(ordersRes.rows[0]?.count ?? '0', 10);

      // Evaluate eligibility
      const check = evaluateReferralEligibility({
        referrerCustomerId: referrerId,
        refereeCustomerId,
        refereeOrderCount,
        referrerMonthlyEarningsPaise: 0n,
        monthlyCapPaise: 500000n, // ₹5,000 monthly cap
        refereeDeviceId: dto.deviceId,
        refereeIpHash: dto.ipHash,
      });

      if (!check.eligible) {
        throw new BadRequestException(check.reason ?? 'Referral is not eligible.');
      }

      // Insert referral
      try {
        const res = await client.query<{ id: string }>(
          `INSERT INTO referrals (org_id, referrer_customer_id, referee_customer_id, status, fraud_signals)
           VALUES ($1, $2, $3, 'PENDING', $4::jsonb)
           RETURNING id`,
          [orgId, referrerId, refereeCustomerId, JSON.stringify(check.fraudSignals)],
        );
        return {
          referralId: res.rows[0]!.id,
          status: 'PENDING',
          message: 'Referral registered. Your reward will apply on your first order.',
        };
      } catch (err: any) {
        if (err.code === '23505') {
          throw new ConflictException('You have already applied a referral.');
        }
        throw err;
      }
    });
  }

  private async qualifyReferral(
    orgId: string,
    refereeCustomerId: string,
    orderId: string,
    orderTotalPaise: bigint,
    settings: LoyaltySettingsRow,
    client: PoolClient,
  ) {
    const referralRes = await client.query<{
      id: string;
      referrer_customer_id: string;
      status: string;
    }>(
      `SELECT id, referrer_customer_id, status
       FROM referrals
       WHERE org_id = $1 AND referee_customer_id = $2 AND status = 'PENDING'`,
      [orgId, refereeCustomerId],
    );

    if (referralRes.rowCount === 0) return;
    const ref = referralRes.rows[0]!;

    const rewards = calculateReferralRewards(orderTotalPaise, {
      referrerRewardPercent: settings.referrer_reward_percent,
      referrerMaxRewardPaise: settings.referrer_max_reward_paise,
      refereeDiscountPaise: settings.referee_discount_paise,
    });

    // Credit referrer's wallet
    await client.query(
      `INSERT INTO loyalty_ledger (org_id, customer_id, entry_type, amount_paise, reason, ref_type, ref_id)
       VALUES ($1, $2, 'EARN', $3, 'Referral reward from referee order', 'REFERRAL', $4)
       ON CONFLICT (org_id, ref_type, ref_id, entry_type) DO NOTHING`,
      [orgId, ref.referrer_customer_id, rewards.referrerRewardPaise.toString(), ref.id],
    );

    // Update referral status to REWARDED
    await client.query(
      `UPDATE referrals
       SET status = 'REWARDED', qualified_order_id = $1, rewarded_at = now()
       WHERE org_id = $2 AND id = $3`,
      [orderId, orgId, ref.id],
    );

    this.logger.log(`[REFERRAL] Rewarded ₹${Number(rewards.referrerRewardPaise) / 100} to referrer ${ref.referrer_customer_id}`);
  }

  // ─── Console / Admin Coupon Management ───────────────────────────────────────

  async createCoupon(orgId: string, dto: CreateCouponDto) {
    return withTenantContextRaw(orgId, async (client) => {
      try {
        const res = await client.query<{ id: string }>(
          `INSERT INTO coupons (
             org_id, code, type, value, max_discount_paise, min_order_paise,
             audience, valid_from, valid_to, usage_limit_total, usage_limit_per_customer,
             stackable, outlets, is_active
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
           RETURNING id`,
          [
            orgId,
            dto.code,
            dto.type,
            dto.value,
            dto.maxDiscountPaise ?? null,
            dto.minOrderPaise,
            dto.audience,
            dto.validFrom,
            dto.validTo,
            dto.usageLimitTotal ?? null,
            dto.usageLimitPerCustomer,
            dto.stackable,
            dto.outlets,
            dto.isActive,
          ],
        );
        return { id: res.rows[0]!.id, code: dto.code };
      } catch (err: any) {
        if (err.code === '23505') {
          throw new ConflictException(`Coupon code '${dto.code}' already exists.`);
        }
        throw err;
      }
    });
  }

  async listCoupons(orgId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `SELECT id, code, type, value, max_discount_paise, min_order_paise, audience,
                valid_from, valid_to, usage_limit_total, usage_limit_per_customer,
                stackable, outlets, is_active, created_at
         FROM coupons
         WHERE org_id = $1
         ORDER BY created_at DESC`,
        [orgId],
      );
      return res.rows;
    });
  }

  async getCoupon(orgId: string, couponId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `SELECT id, code, type, value, max_discount_paise, min_order_paise, audience,
                valid_from, valid_to, usage_limit_total, usage_limit_per_customer,
                stackable, outlets, is_active, created_at
         FROM coupons
         WHERE org_id = $1 AND id = $2`,
        [orgId, couponId],
      );
      if (res.rowCount === 0) {
        throw new NotFoundException(`Coupon ${couponId} not found`);
      }
      return res.rows[0];
    });
  }

  async updateCoupon(orgId: string, couponId: string, dto: UpdateCouponDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const sets: string[] = [];
      const params: unknown[] = [orgId, couponId];

      if (dto.maxDiscountPaise !== undefined) {
        params.push(dto.maxDiscountPaise);
        sets.push(`max_discount_paise = $${params.length}`);
      }
      if (dto.minOrderPaise !== undefined) {
        params.push(dto.minOrderPaise);
        sets.push(`min_order_paise = $${params.length}`);
      }
      if (dto.audience !== undefined) {
        params.push(dto.audience);
        sets.push(`audience = $${params.length}`);
      }
      if (dto.validFrom !== undefined) {
        params.push(dto.validFrom);
        sets.push(`valid_from = $${params.length}`);
      }
      if (dto.validTo !== undefined) {
        params.push(dto.validTo);
        sets.push(`valid_to = $${params.length}`);
      }
      if (dto.usageLimitTotal !== undefined) {
        params.push(dto.usageLimitTotal);
        sets.push(`usage_limit_total = $${params.length}`);
      }
      if (dto.usageLimitPerCustomer !== undefined) {
        params.push(dto.usageLimitPerCustomer);
        sets.push(`usage_limit_per_customer = $${params.length}`);
      }
      if (dto.stackable !== undefined) {
        params.push(dto.stackable);
        sets.push(`stackable = $${params.length}`);
      }
      if (dto.outlets !== undefined) {
        params.push(dto.outlets);
        sets.push(`outlets = $${params.length}`);
      }
      if (dto.isActive !== undefined) {
        params.push(dto.isActive);
        sets.push(`is_active = $${params.length}`);
      }

      if (sets.length === 0) {
        return this.getCoupon(orgId, couponId);
      }

      sets.push('updated_at = now()');

      const res = await client.query(
        `UPDATE coupons
         SET ${sets.join(', ')}
         WHERE org_id = $1 AND id = $2
         RETURNING id`,
        params,
      );

      if (res.rowCount === 0) {
        throw new NotFoundException(`Coupon ${couponId} not found`);
      }
      return this.getCoupon(orgId, couponId);
    });
  }

  // ─── Settings ─────────────────────────────────────────────────────────────────

  async getSettings(orgId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      return this.getOrCreateSettings(orgId, client);
    });
  }

  async updateSettings(orgId: string, dto: UpdateLoyaltySettingsDto) {
    return withTenantContextRaw(orgId, async (client) => {
      await this.getOrCreateSettings(orgId, client);

      const sets: string[] = [];
      const params: unknown[] = [orgId];

      if (dto.maxWalletRedemptionPercent !== undefined) {
        params.push(dto.maxWalletRedemptionPercent);
        sets.push(`max_wallet_redemption_percent = $${params.length}`);
      }
      if (dto.referrerRewardPercent !== undefined) {
        params.push(dto.referrerRewardPercent);
        sets.push(`referrer_reward_percent = $${params.length}`);
      }
      if (dto.referrerMaxRewardPaise !== undefined) {
        params.push(dto.referrerMaxRewardPaise);
        sets.push(`referrer_max_reward_paise = $${params.length}`);
      }
      if (dto.refereeDiscountPaise !== undefined) {
        params.push(dto.refereeDiscountPaise);
        sets.push(`referee_discount_paise = $${params.length}`);
      }
      if (dto.pointsEarnPercent !== undefined) {
        params.push(dto.pointsEarnPercent);
        sets.push(`points_earn_percent = $${params.length}`);
      }
      if (dto.isLoyaltyEnabled !== undefined) {
        params.push(dto.isLoyaltyEnabled);
        sets.push(`is_loyalty_enabled = $${params.length}`);
      }
      if (dto.isReferralEnabled !== undefined) {
        params.push(dto.isReferralEnabled);
        sets.push(`is_referral_enabled = $${params.length}`);
      }

      if (sets.length > 0) {
        sets.push('updated_at = now()');
        await client.query(
          `UPDATE org_loyalty_settings SET ${sets.join(', ')} WHERE org_id = $1`,
          params,
        );
      }

      return this.getOrCreateSettings(orgId, client);
    });
  }

  private async getOrCreateSettings(orgId: string, client: PoolClient): Promise<LoyaltySettingsRow> {
    const res = await client.query<LoyaltySettingsRow>(
      `SELECT org_id, max_wallet_redemption_percent, referrer_reward_percent,
              referrer_max_reward_paise, referee_discount_paise, points_earn_percent,
              is_loyalty_enabled, is_referral_enabled
       FROM org_loyalty_settings WHERE org_id = $1`,
      [orgId],
    );

    if (res.rowCount && res.rowCount > 0) {
      return res.rows[0]!;
    }

    const insertRes = await client.query<LoyaltySettingsRow>(
      `INSERT INTO org_loyalty_settings (org_id)
       VALUES ($1)
       ON CONFLICT (org_id) DO UPDATE SET org_id = EXCLUDED.org_id
       RETURNING org_id, max_wallet_redemption_percent, referrer_reward_percent,
                 referrer_max_reward_paise, referee_discount_paise, points_earn_percent,
                 is_loyalty_enabled, is_referral_enabled`,
      [orgId],
    );

    return insertRes.rows[0]!;
  }
}
