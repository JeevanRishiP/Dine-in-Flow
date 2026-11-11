import type { TemplateCategory } from './template.registry.js';

// Standard estimated per-message costs in India minor units (paise)
export const ESTIMATED_MESSAGE_COST_PAISE: Record<TemplateCategory, bigint> = {
  AUTHENTICATION: 15n, // ₹0.15
  UTILITY: 15n,        // ₹0.15
  MARKETING: 85n,      // ₹0.85
};

export interface BudgetEvaluationInput {
  dailySpendPaise: bigint;
  dailyBudgetPaise: bigint;
  monthlySpendPaise: bigint;
  monthlyBudgetPaise: bigint;
  category: TemplateCategory;
}

export interface BudgetEvaluationResult {
  allowed: boolean;
  costMinorPaise: bigint;
  remainingDailyPaise: bigint;
  remainingMonthlyPaise: bigint;
  reason?: string;
}

/**
 * Pure function to evaluate if an organization has sufficient budget for a message.
 *
 * Invariant (AGENTS §2 rule 1): all money in integer paise.
 * Reference: ARCH §20 (Per-org budgets and cost control)
 */
export function evaluateMessagingBudget(
  input: BudgetEvaluationInput,
): BudgetEvaluationResult {
  const cost = ESTIMATED_MESSAGE_COST_PAISE[input.category] ?? 15n;

  const newDaily = input.dailySpendPaise + cost;
  if (newDaily > input.dailyBudgetPaise) {
    return {
      allowed: false,
      costMinorPaise: cost,
      remainingDailyPaise: input.dailyBudgetPaise > input.dailySpendPaise
        ? input.dailyBudgetPaise - input.dailySpendPaise
        : 0n,
      remainingMonthlyPaise: input.monthlyBudgetPaise > input.monthlySpendPaise
        ? input.monthlyBudgetPaise - input.monthlySpendPaise
        : 0n,
      reason: `Daily messaging budget exceeded (limit: ₹${Number(input.dailyBudgetPaise) / 100}, spent: ₹${Number(input.dailySpendPaise) / 100})`,
    };
  }

  const newMonthly = input.monthlySpendPaise + cost;
  if (newMonthly > input.monthlyBudgetPaise) {
    return {
      allowed: false,
      costMinorPaise: cost,
      remainingDailyPaise: input.dailyBudgetPaise - newDaily,
      remainingMonthlyPaise: input.monthlyBudgetPaise > input.monthlySpendPaise
        ? input.monthlyBudgetPaise - input.monthlySpendPaise
        : 0n,
      reason: `Monthly messaging budget exceeded (limit: ₹${Number(input.monthlyBudgetPaise) / 100}, spent: ₹${Number(input.monthlySpendPaise) / 100})`,
    };
  }

  return {
    allowed: true,
    costMinorPaise: cost,
    remainingDailyPaise: input.dailyBudgetPaise - newDaily,
    remainingMonthlyPaise: input.monthlyBudgetPaise - newMonthly,
  };
}
