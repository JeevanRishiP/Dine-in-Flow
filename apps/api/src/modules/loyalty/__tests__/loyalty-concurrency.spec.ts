import { describe, it, expect, vi } from 'vitest';
import { LoyaltyService } from '../loyalty.service.js';
import {
  calculateWalletBalance,
  calculateMaxWalletRedemption,
  type LedgerEntryData,
} from '../loyalty.engine.js';
import type { PoolClient } from 'pg';

describe('Loyalty Concurrency & Property Invariant Tests (Phase 7)', () => {
  describe('Concurrent Coupon Redemptions (At-Most-Once Guarantee)', () => {
    it('prevents parallel redemption of the same coupon on the same order', async () => {
      const service = new LoyaltyService();
      const orgId = 'org-uuid-1';
      const couponId = 'coupon-uuid-1';
      const orderId = 'order-uuid-1';

      // Simulates Postgres unique constraint uq_coupon_redemption_order
      const redemptionsTable = new Set<string>();

      const mockClient = {
        query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
          if (sql.includes('INSERT INTO coupon_redemptions')) {
            const key = `${params[1]}:${params[2]}`; // couponId:orderId
            if (redemptionsTable.has(key)) {
              const err: any = new Error('duplicate key value violates unique constraint');
              err.code = '23505';
              throw err;
            }
            redemptionsTable.add(key);
            return { rowCount: 1 };
          }
          return { rowCount: 1 };
        }),
      } as unknown as PoolClient;

      // 10 concurrent requests to redeem the same coupon on the same order simultaneously
      const attempts = Array.from({ length: 10 }, () =>
        service.recordCouponRedemption(orgId, couponId, orderId, 'cust-1', 5000, mockClient),
      );

      const results = await Promise.allSettled(attempts);

      const successes = results.filter((r) => r.status === 'fulfilled');
      const failures = results.filter((r) => r.status === 'rejected');

      // Invariant: Exactly 1 succeeds, all 9 concurrent duplicates are rejected
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(9);
      for (const f of failures) {
        expect((f as PromiseRejectedResult).reason.message).toContain('Coupon has already been applied to this order');
      }
    });
  });

  describe('Double-Credit Impossibility (Idempotency Invariant)', () => {
    it('prevents double-crediting referral reward under concurrent load', async () => {
      const service = new LoyaltyService();
      const orgId = 'org-uuid-1';
      const referralId = 'referral-uuid-1';

      // Simulates Postgres unique constraint uq_loyalty_ledger_ref
      const ledgerUniqueIndex = new Set<string>();

      const mockClient = {
        query: vi.fn().mockImplementation(async (sql: string, params: unknown[]) => {
          if (sql.includes('SELECT id, referrer_customer_id')) {
            return {
              rowCount: 1,
              rows: [{ id: referralId, referrer_customer_id: 'referrer-1', status: 'PENDING' }],
            };
          }
          if (sql.includes('INSERT INTO loyalty_ledger')) {
            // ON CONFLICT (org_id, ref_type, ref_id, entry_type) DO NOTHING
            const key = `${params[0]}:REFERRAL:${params[3]}:EARN`;
            if (ledgerUniqueIndex.has(key)) {
              return { rowCount: 0 }; // DO NOTHING
            }
            ledgerUniqueIndex.add(key);
            return { rowCount: 1 };
          }
          return { rowCount: 1, rows: [] };
        }),
      } as unknown as PoolClient;

      const settings = {
        org_id: orgId,
        max_wallet_redemption_percent: 20,
        referrer_reward_percent: 10,
        referrer_max_reward_paise: 50000,
        referee_discount_paise: 10000,
        points_earn_percent: 5,
        is_loyalty_enabled: true,
        is_referral_enabled: true,
      };

      // 5 concurrent attempts to qualify and credit the same referral
      const attempts = Array.from({ length: 5 }, () =>
        (service as any).qualifyReferral(orgId, 'referee-1', 'order-1', 200000n, settings, mockClient),
      );

      await Promise.all(attempts);

      // Invariant: Exactly 1 credit entry was added to the unique ledger
      expect(ledgerUniqueIndex.size).toBe(1);
    });
  });

  describe('Property Invariants (Randomized Simulations)', () => {
    it('guarantees that wallet balance is never negative under arbitrary ledger sequences', () => {
      // Run 100 randomized sequences of operations
      for (let run = 0; run < 100; run++) {
        const entries: LedgerEntryData[] = [];
        const entryCount = 10 + Math.floor(Math.random() * 20);

        for (let i = 0; i < entryCount; i++) {
          const isCredit = Math.random() > 0.4;
          const amount = BigInt(Math.floor(Math.random() * 50000));
          if (isCredit) {
            entries.push({
              entryType: 'EARN',
              amountPaise: amount,
            });
          } else {
            entries.push({
              entryType: 'REDEEM',
              amountPaise: -amount,
            });
          }
        }

        const balance = calculateWalletBalance(entries);
        expect(balance >= 0n).toBe(true);
      }
    });

    it('guarantees that wallet redemption never exceeds subtotal percentage cap', () => {
      // Test across arbitrary subtotal and balance values
      for (let run = 0; run < 100; run++) {
        const subtotalPaise = Math.floor(Math.random() * 1000000); // up to ₹10,000
        const balancePaise = BigInt(Math.floor(Math.random() * 500000)); // up to ₹5,000
        const capPercent = 10 + Math.floor(Math.random() * 30); // 10% to 40%

        const maxRedemption = calculateMaxWalletRedemption(subtotalPaise, balancePaise, capPercent);

        // Invariant 1: never exceeds balance
        expect(BigInt(maxRedemption) <= balancePaise).toBe(true);

        // Invariant 2: never exceeds subtotal * capPercent / 100
        const maxPolicyPaise = Math.floor((subtotalPaise * capPercent) / 100);
        expect(maxRedemption <= maxPolicyPaise).toBe(true);

        // Invariant 3: never negative
        expect(maxRedemption >= 0).toBe(true);
      }
    });
  });
});
