import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('Anti-Review Incentive Static Guard (ARCH §19, AGENTS §2 rule 10)', () => {
  const loyaltyServicePath = path.resolve(__dirname, '../../loyalty/loyalty.service.ts');
  const couponEnginePath = path.resolve(__dirname, '../../loyalty/coupon.engine.ts');
  const feedbackServicePath = path.resolve(__dirname, '../feedback.service.ts');
  const migrationsDir = path.resolve(__dirname, '../../../db/migrations');

  it('ensures loyalty/coupon code NEVER references Google reviews or review_snapshots', () => {
    const loyaltyContent = fs.readFileSync(loyaltyServicePath, 'utf8');
    const couponContent = fs.readFileSync(couponEnginePath, 'utf8');

    // Must never query or reference review_snapshots
    expect(loyaltyContent).not.toContain('review_snapshots');
    expect(couponContent).not.toContain('review_snapshots');

    // Must never create ledger entries with review ref_type
    expect(loyaltyContent).not.toContain("'REVIEW'");
    expect(loyaltyContent).not.toContain("'GOOGLE_REVIEW'");
  });

  it('ensures no code attempts to verify if a customer posted a Google review', () => {
    const feedbackContent = fs.readFileSync(feedbackServicePath, 'utf8');
    const loyaltyContent = fs.readFileSync(loyaltyServicePath, 'utf8');

    const prohibitedPhrases = [
      'verifyGoogleReview',
      'verifyReviewPosted',
      'verifyCustomerReview',
      'claimGoogleReviewReward',
      'googleReviewReward',
    ];

    for (const phrase of prohibitedPhrases) {
      expect(feedbackContent).not.toContain(phrase);
      expect(loyaltyContent).not.toContain(phrase);
    }
  });

  it('ensures review_snapshots table in migrations has NO customer_id or order_id column', () => {
    const migrationFiles = fs.readdirSync(migrationsDir);
    const feedbackMigration = migrationFiles.find((f) => f.includes('feedback_and_reviews'));
    expect(feedbackMigration).toBeDefined();

    const sqlContent = fs.readFileSync(path.join(migrationsDir, feedbackMigration!), 'utf8');

    // Find review_snapshots table definition
    const reviewSnapshotsDdl = sqlContent.match(/CREATE TABLE IF NOT EXISTS review_snapshots \(([\s\S]*?)\);/);
    expect(reviewSnapshotsDdl).toBeDefined();

    const ddl = reviewSnapshotsDdl![1]!;
    expect(ddl).not.toContain('customer_id');
    expect(ddl).not.toContain('order_id');
  });

  it('ensures feedback reward is NOT conditional on star rating in feedback.service.ts', () => {
    const feedbackContent = fs.readFileSync(feedbackServicePath, 'utf8');

    // Must not contain conditional checks awarding points only for high ratings
    expect(feedbackContent).not.toMatch(/if\s*\(\s*(dto\.)?rating\s*>=?\s*[45]\s*\)\s*\{[^}]*pointsRewarded/);
    expect(feedbackContent).not.toMatch(/pointsRewardedPaise\s*=\s*(dto\.)?rating/);
  });
});
