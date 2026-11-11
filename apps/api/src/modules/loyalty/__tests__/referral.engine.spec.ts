import { describe, it, expect } from 'vitest';
import {
  evaluateReferralEligibility,
  calculateReferralRewards,
} from '../referral.engine.js';

describe('Referral Engine & Fraud Detection (Pure Calculations)', () => {
  const baseContext = {
    referrerCustomerId: 'referrer-cust-1',
    refereeCustomerId: 'referee-cust-2',
    refereeOrderCount: 0,
    referrerMonthlyEarningsPaise: 100000n, // ₹1,000 earned this month
    monthlyCapPaise: 500000n,              // ₹5,000 monthly cap
    referrerDeviceId: 'device-abc-123',
    refereeDeviceId: 'device-xyz-789',
    referrerIpHash: 'hash-ip-1',
    refereeIpHash: 'hash-ip-2',
  };

  it('approves clean referral between distinct customers', () => {
    const res = evaluateReferralEligibility(baseContext);
    expect(res.eligible).toBe(true);
    expect(res.fraudSignals).toHaveLength(0);
  });

  it('rejects self-referrals immediately', () => {
    const selfRes = evaluateReferralEligibility({
      ...baseContext,
      refereeCustomerId: 'referrer-cust-1', // same customer
    });
    expect(selfRes.eligible).toBe(false);
    expect(selfRes.fraudSignals).toContain('SELF_REFERRAL_ID_MATCH');
  });

  it('rejects referral if referee has already placed prior orders', () => {
    const returningRes = evaluateReferralEligibility({
      ...baseContext,
      refereeOrderCount: 1,
    });
    expect(returningRes.eligible).toBe(false);
    expect(returningRes.fraudSignals).toContain('REFEREE_ALREADY_ORDERED');
  });

  it('rejects referral if same device ID is detected (fraud check)', () => {
    const deviceMatchRes = evaluateReferralEligibility({
      ...baseContext,
      refereeDeviceId: 'device-abc-123', // same device as referrer
    });
    expect(deviceMatchRes.eligible).toBe(false);
    expect(deviceMatchRes.fraudSignals).toContain('DEVICE_ID_MATCH');
  });

  it('rejects referral when referrer has reached monthly earnings cap', () => {
    const capRes = evaluateReferralEligibility({
      ...baseContext,
      referrerMonthlyEarningsPaise: 500000n, // at cap
    });
    expect(capRes.eligible).toBe(false);
    expect(capRes.fraudSignals).toContain('MONTHLY_CAP_REACHED');
  });

  it('computes 10% referral reward capped at ₹500 accurately', () => {
    const settings = {
      referrerRewardPercent: 10,
      referrerMaxRewardPaise: 50000, // ₹500
      refereeDiscountPaise: 10000,   // ₹100
    };

    // Referee order: ₹2,000 (200000 paise) -> 10% = ₹200 (20000 paise), under cap
    const rewards = calculateReferralRewards(200000n, settings);
    expect(rewards.referrerRewardPaise).toBe(20000n);
    expect(rewards.refereeDiscountPaise).toBe(10000);

    // Referee order: ₹8,000 (800000 paise) -> 10% = ₹800, capped at ₹500 (50000 paise)
    const capped = calculateReferralRewards(800000n, settings);
    expect(capped.referrerRewardPaise).toBe(50000n);
  });
});
