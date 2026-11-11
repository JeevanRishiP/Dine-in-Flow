import { describe, it, expect } from 'vitest';
import {
  calculateWalletBalance,
  calculateMaxWalletRedemption,
  calculateOrderLoyaltyPoints,
  calculateRefundWalletReversal,
  type LedgerEntryData,
} from '../loyalty.engine.js';

describe('Loyalty & Wallet Engine (Pure Calculations)', () => {
  describe('calculateWalletBalance', () => {
    it('sums unexpired EARN and REDEEM ledger entries correctly', () => {
      const entries: LedgerEntryData[] = [
        { entryType: 'EARN', amountPaise: 50000n }, // +₹500
        { entryType: 'REDEEM', amountPaise: -10000n }, // -₹100
        { entryType: 'EARN', amountPaise: 20000n }, // +₹200
      ];

      const balance = calculateWalletBalance(entries);
      expect(balance).toBe(60000n); // ₹600 (60000 paise)
    });

    it('ignores expired promotional credit entries', () => {
      const now = new Date('2026-06-01T12:00:00Z');
      const entries: LedgerEntryData[] = [
        {
          entryType: 'EARN',
          amountPaise: 50000n, // expired
          expiresAt: '2026-05-31T23:59:59Z',
        },
        {
          entryType: 'EARN',
          amountPaise: 20000n, // valid
          expiresAt: '2026-07-31T23:59:59Z',
        },
      ];

      const balance = calculateWalletBalance(entries, now);
      expect(balance).toBe(20000n);
    });

    it('never returns negative balance', () => {
      const entries: LedgerEntryData[] = [
        { entryType: 'REDEEM', amountPaise: -50000n },
      ];
      expect(calculateWalletBalance(entries)).toBe(0n);
    });
  });

  describe('calculateMaxWalletRedemption', () => {
    it('caps redemption at configured percentage of subtotal', () => {
      // Subtotal ₹1,000 (100000 paise), cap = 20% -> max allowed by policy = 20000 paise
      // Customer balance = ₹500 (50000 paise) -> can redeem 20000 paise (₹200)
      const allowed = calculateMaxWalletRedemption(100000, 50000n, 20);
      expect(allowed).toBe(20000);

      // Customer balance = ₹100 (10000 paise), policy allows ₹200 -> capped by balance to ₹100
      const balanceCapped = calculateMaxWalletRedemption(100000, 10000n, 20);
      expect(balanceCapped).toBe(10000);
    });

    it('returns 0 when balance is 0 or subtotal is 0', () => {
      expect(calculateMaxWalletRedemption(100000, 0n, 20)).toBe(0);
      expect(calculateMaxWalletRedemption(0, 50000n, 20)).toBe(0);
    });
  });

  describe('calculateOrderLoyaltyPoints', () => {
    it('calculates 5% loyalty points on order subtotal in integer paise', () => {
      // Subtotal ₹500 (50000 paise) * 5% = 2500 paise (₹25)
      expect(calculateOrderLoyaltyPoints(50000, 5)).toBe(2500n);
      expect(calculateOrderLoyaltyPoints(0, 5)).toBe(0n);
    });
  });

  describe('calculateRefundWalletReversal', () => {
    it('reverses full wallet credit on full order refund', () => {
      // Order total = ₹1,000 (100000 paise), wallet redeemed = ₹200 (20000 paise)
      // Refund amount = ₹1,000
      const reversal = calculateRefundWalletReversal(100000n, 100000n, 20000n);
      expect(reversal).toBe(20000n);
    });

    it('reverses proportional wallet credit on partial order refund', () => {
      // Order total = ₹1,000, wallet redeemed = ₹200, partial refund = ₹500 (50%)
      const reversal = calculateRefundWalletReversal(100000n, 50000n, 20000n);
      expect(reversal).toBe(10000n); // 50% of ₹200 = ₹100
    });
  });
});
