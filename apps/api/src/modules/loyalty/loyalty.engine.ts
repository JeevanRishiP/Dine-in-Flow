/**
 * Pure Loyalty & Wallet Engine
 *
 * Implements non-cashable store credit, points ledger aggregation,
 * redemption caps, and refund reversal logic.
 *
 * Rules:
 *  - Store credit / points are non-cashable (ARCH §18).
 *  - Ledger balance = SUM(amount_paise) of unexpired entries.
 *  - Integer paise precision only (AGENTS §2 rule 1).
 *
 * Reference: ARCH §18, §10, AGENTS §2 rule 1+8
 */

export interface LedgerEntryData {
  entryType: 'EARN' | 'REDEEM' | 'EXPIRE' | 'ADJUST' | 'REVERSAL';
  amountPaise: bigint;
  expiresAt?: Date | string | null;
}

/**
 * Calculates current spendable wallet balance from append-only ledger entries.
 * Filters out expired credit.
 */
export function calculateWalletBalance(
  entries: LedgerEntryData[],
  now = new Date(),
): bigint {
  let balance = 0n;

  for (const entry of entries) {
    // If an earning entry has expired, ignore it from spendable balance
    if (entry.expiresAt) {
      const exp = new Date(entry.expiresAt);
      if (exp <= now && entry.amountPaise > 0n) {
        continue;
      }
    }
    balance += entry.amountPaise;
  }

  // Balance cannot be negative (invariance check)
  return balance > 0n ? balance : 0n;
}

/**
 * Calculates maximum wallet credit allowed to be redeemed on a bill.
 * Capped by both the customer's balance and the outlet's configured percentage cap.
 */
export function calculateMaxWalletRedemption(
  subtotalPaise: number,
  walletBalancePaise: bigint,
  maxRedemptionPercent = 20,
): number {
  if (subtotalPaise <= 0 || walletBalancePaise <= 0n) {
    return 0;
  }

  // Cap as configured percentage of order subtotal
  const maxAllowedByPolicy = Math.floor((subtotalPaise * maxRedemptionPercent) / 100);

  // Spendable cannot exceed either the policy cap or available balance
  const balanceInt = Number(walletBalancePaise);
  return Math.min(balanceInt, maxAllowedByPolicy);
}

/**
 * Calculates promotional points earned on a completed order.
 */
export function calculateOrderLoyaltyPoints(
  subtotalPaise: number,
  pointsEarnPercent = 5,
): bigint {
  if (subtotalPaise <= 0 || pointsEarnPercent <= 0) {
    return 0n;
  }
  const earned = Math.floor((subtotalPaise * pointsEarnPercent) / 100);
  return BigInt(earned);
}

/**
 * Calculates wallet debit reversal on order refund.
 * If an order used ₹50 wallet credit and was partially/fully refunded,
 * return proportional wallet credit back to customer.
 */
export function calculateRefundWalletReversal(
  originalTotalPaise: bigint,
  refundAmountPaise: bigint,
  walletRedeemedPaise: bigint,
): bigint {
  if (originalTotalPaise <= 0n || refundAmountPaise <= 0n || walletRedeemedPaise <= 0n) {
    return 0n;
  }

  if (refundAmountPaise >= originalTotalPaise) {
    return walletRedeemedPaise;
  }

  // Proportional return: (refundAmount * walletRedeemed) / originalTotal
  const reversal = (refundAmountPaise * walletRedeemedPaise) / originalTotalPaise;
  return reversal;
}
