import { describe, it, expect } from 'vitest';
import { evaluateMessagingBudget } from '../budget.engine.js';

describe('Messaging Budget Engine (Phase 9)', () => {
  it('allows message send when within daily and monthly budgets', () => {
    const result = evaluateMessagingBudget({
      dailySpendPaise: 1000n,    // ₹10 spent
      dailyBudgetPaise: 10000n,  // ₹100 daily limit
      monthlySpendPaise: 5000n,  // ₹50 spent
      monthlyBudgetPaise: 50000n,// ₹500 monthly limit
      category: 'UTILITY',
    });

    expect(result.allowed).toBe(true);
    expect(result.costMinorPaise).toBe(15n);
    expect(result.remainingDailyPaise).toBe(10000n - 1015n);
    expect(result.remainingMonthlyPaise).toBe(50000n - 5015n);
  });

  it('blocks message send when daily budget is exceeded', () => {
    const result = evaluateMessagingBudget({
      dailySpendPaise: 9990n,    // ₹99.90 spent
      dailyBudgetPaise: 10000n,  // ₹100 limit
      monthlySpendPaise: 10000n,
      monthlyBudgetPaise: 50000n,
      category: 'MARKETING',     // 85 paise cost -> 9990 + 85 = 10075 > 10000
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily messaging budget exceeded');
  });

  it('blocks message send when monthly budget is exceeded', () => {
    const result = evaluateMessagingBudget({
      dailySpendPaise: 100n,
      dailyBudgetPaise: 10000n,
      monthlySpendPaise: 49990n,  // ₹499.90 spent
      monthlyBudgetPaise: 50000n, // ₹500 limit
      category: 'UTILITY',        // 15 paise cost -> 49990 + 15 = 50005 > 50000
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Monthly messaging budget exceeded');
  });
});
