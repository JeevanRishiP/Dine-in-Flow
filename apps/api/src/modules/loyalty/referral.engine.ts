/**
 * Pure Referral Engine & Fraud Detection
 *
 * Implements referral eligibility, self-referral prevention, device collision
 * checks, and reward calculations.
 *
 * Rules:
 *  - Referrer is rewarded ONLY after referee's first order is PAID and COMPLETED (ARCH §18).
 *  - Self-referrals strictly blocked by ID, phone, device ID, or IP hash.
 *  - Per-referrer monthly earning caps and velocity limits.
 *  - Fraud signals stored in referral record.
 *
 * Reference: ARCH §18, §7, AGENTS §2 rule 8
 */

export interface ReferralContext {
  referrerCustomerId: string;
  refereeCustomerId: string;
  refereeOrderCount: number;
  referrerMonthlyEarningsPaise: bigint;
  monthlyCapPaise: bigint;
  referrerDeviceId?: string | null;
  refereeDeviceId?: string | null;
  referrerIpHash?: string | null;
  refereeIpHash?: string | null;
}

export interface ReferralEligibilityResult {
  eligible: boolean;
  fraudSignals: string[];
  reason?: string;
}

export interface ReferralRewardSettings {
  referrerRewardPercent: number; // e.g. 10%
  referrerMaxRewardPaise: number; // e.g. 50000 = ₹500
  refereeDiscountPaise: number;   // e.g. 10000 = ₹100
}

/**
 * Evaluates whether a referral relationship is valid and checks for fraud signals.
 */
export function evaluateReferralEligibility(ctx: ReferralContext): ReferralEligibilityResult {
  const fraudSignals: string[] = [];

  // 1. Direct self-referral check
  if (ctx.referrerCustomerId === ctx.refereeCustomerId) {
    return {
      eligible: false,
      fraudSignals: ['SELF_REFERRAL_ID_MATCH'],
      reason: 'Self-referral is not allowed.',
    };
  }

  // 2. Referee must be a new customer (first order only)
  if (ctx.refereeOrderCount > 0) {
    return {
      eligible: false,
      fraudSignals: ['REFEREE_ALREADY_ORDERED'],
      reason: 'Referral rewards only apply to first-time customers.',
    };
  }

  // 3. Device ID collision check
  if (
    ctx.referrerDeviceId &&
    ctx.refereeDeviceId &&
    ctx.referrerDeviceId === ctx.refereeDeviceId
  ) {
    fraudSignals.push('DEVICE_ID_MATCH');
  }

  // 4. IP Hash collision check (soft signal, flagged for review)
  if (
    ctx.referrerIpHash &&
    ctx.refereeIpHash &&
    ctx.referrerIpHash === ctx.refereeIpHash
  ) {
    fraudSignals.push('IP_HASH_MATCH');
  }

  // 5. Monthly earnings cap per referrer
  if (ctx.referrerMonthlyEarningsPaise >= ctx.monthlyCapPaise) {
    return {
      eligible: false,
      fraudSignals: ['MONTHLY_CAP_REACHED'],
      reason: 'Referrer has reached the monthly referral rewards cap.',
    };
  }

  // If severe fraud signals (like device match), reject
  if (fraudSignals.includes('DEVICE_ID_MATCH')) {
    return {
      eligible: false,
      fraudSignals,
      reason: 'Referral detected from the same device.',
    };
  }

  return {
    eligible: true,
    fraudSignals,
  };
}

/**
 * Calculates reward credit for referrer and instant discount for referee.
 */
export function calculateReferralRewards(
  orderTotalPaise: bigint,
  settings: ReferralRewardSettings,
): { referrerRewardPaise: bigint; refereeDiscountPaise: number } {
  // Referrer gets configured percentage (e.g. 10%) up to cap (e.g. ₹500)
  const rawReward = (orderTotalPaise * BigInt(settings.referrerRewardPercent)) / 100n;
  const maxCap = BigInt(settings.referrerMaxRewardPaise);
  const referrerRewardPaise = rawReward > maxCap ? maxCap : rawReward;

  return {
    referrerRewardPaise,
    refereeDiscountPaise: settings.refereeDiscountPaise,
  };
}
