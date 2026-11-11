import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Anti-Review Incentive Static Guard (ARCH §18, §19, AGENTS §2 rule 10)', () => {
  it('enforces that loyalty, coupon, and referral code never references Google review entities or conditional review rewards', () => {
    const loyaltyDir = path.resolve(__dirname, '..');
    const files = fs.readdirSync(loyaltyDir).filter((f) => f.endsWith('.ts') && !f.includes('.spec.') && !f.includes('.test.'));

    expect(files.length).toBeGreaterThan(0);

    const forbiddenPatterns = [
      /\bgoogle_review\b/i,
      /\breview_snapshot\b/i,
      /\bgbp_connection\b/i,
      /\bposted.*google.*review\b/i,
      /\breward.*for.*review\b/i,
    ];

    for (const file of files) {
      const content = fs.readFileSync(path.join(loyaltyDir, file), 'utf-8');
      for (const pattern of forbiddenPatterns) {
        const match = pattern.test(content);
        expect(
          match,
          `VIOLATION OF AGENTS §2 RULE 10: File '${file}' matches prohibited review reward pattern '${pattern}'. Rewards must never be conditional on a public Google review.`,
        ).toBe(false);
      }
    }
  });
});
