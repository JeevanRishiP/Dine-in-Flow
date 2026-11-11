import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ErrorCode } from '@dineflow/contracts';
import { withTenantContextRaw } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import {
  assertCustomerAccessScope,
  type CustomerAccessScope,
} from '../../common/utils/ownership.utils.js';
import { encryptToken, decryptToken } from './token-cipher.js';
import type {
  SubmitFeedbackDto,
  FeedbackQueryDto,
  ConnectGbpDto,
  SyncReviewsDto,
  ReplyReviewDto,
} from './feedback.dto.js';

export const DEFAULT_FEEDBACK_REWARD_PAISE = 1000n; // ₹10 store credit

function resolveGbpEncryptionKey(overrideKey?: string): string {
  const key = overrideKey ?? process.env['GBP_TOKEN_ENCRYPTION_KEY'];
  if (key && key.length >= 16) {
    return key;
  }
  if (process.env['NODE_ENV'] === 'production') {
    throw domainError(
      ErrorCode.INTERNAL_ERROR,
      'GBP_TOKEN_ENCRYPTION_KEY must be configured in production.',
      500,
    );
  }
  // Test/dev fallback only when NODE_ENV !== 'production'
  return 'dineflow-dev-gbp-oauth-secret-key-32b';
}

export interface FeedbackRow {
  id: string;
  org_id: string;
  outlet_id: string;
  order_id: string;
  customer_id: string | null;
  rating: number;
  tags: string[];
  comment: string | null;
  points_rewarded_paise: string;
  created_at: Date;
}

export interface ReviewSnapshotRow {
  id: string;
  org_id: string;
  outlet_id: string;
  review_ref: string;
  star_rating: number;
  comment: string | null;
  reviewer_display_name: string | null;
  create_time: Date;
  update_time: Date | null;
  reply_text: string | null;
  replied_at: Date | null;
  replied_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Feedback & Google Reviews Service
 *
 * Invariants (AGENTS §2, ARCH §19):
 *  - Rating-independent reward: reward points are given for the act of providing
 *    feedback regardless of rating (1 star = 5 stars).
 *  - Show Google review link to ALL customers equally (no rating-gating).
 *  - Review snapshots have NO linkage to customer_id or order_id.
 *  - Rating <= 3 generates outbox_events alert for private service recovery.
 *  - GBP OAuth refresh tokens are encrypted at rest with AES-256-GCM.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  // ─── Customer: Submit Feedback ──────────────────────────────────────────────

  async submitFeedback(
    orgId: string,
    customerId: string | null,
    dto: SubmitFeedbackDto,
    options?: { scope?: CustomerAccessScope },
  ) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }

    return withTenantContextRaw(orgId, async (client) => {
      // 1. Verify order exists in this tenant (plus session/customer ownership)
      const orderRes = await client.query<{
        id: string;
        outlet_id: string;
        customer_id: string | null;
        session_id?: string | null;
        session_customer_id?: string | null;
      }>(
        `SELECT o.id, o.outlet_id, o.customer_id, o.session_id,
                ts.customer_id AS session_customer_id
         FROM orders o
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         WHERE o.org_id = $1 AND o.id = $2`,
        [orgId, dto.orderId],
      );
      const order = orderRes.rows[0];
      if (!order) {
        throw new NotFoundException(`Order ${dto.orderId} not found`);
      }
      if (options?.scope) {
        assertCustomerAccessScope(options.scope, order);
      }
      const effectiveCustomerId = customerId || order.customer_id;

      // 2. Check if feedback already submitted for this order
      const existing = await client.query(
        `SELECT id FROM feedback WHERE org_id = $1 AND order_id = $2`,
        [orgId, dto.orderId],
      );
      if (existing.rows.length > 0) {
        throw new ConflictException(`Feedback has already been submitted for order ${dto.orderId}`);
      }

      // 3. Reward points: AWARDED REGARDLESS OF RATING (ARCH §19)
      // Exactly one reward per order. 1-star and 5-star ratings receive the exact same reward.
      let pointsRewardedPaise = 0n;
      if (effectiveCustomerId) {
        pointsRewardedPaise = DEFAULT_FEEDBACK_REWARD_PAISE;

        // Credit to loyalty_ledger idempotently
        await client.query(
          `INSERT INTO loyalty_ledger (org_id, customer_id, entry_type, amount_paise, reason, ref_type, ref_id)
           VALUES ($1, $2, 'EARN', $3, 'Feedback reward', 'FEEDBACK', $4)
           ON CONFLICT (org_id, ref_type, ref_id, entry_type) DO NOTHING`,
          [orgId, effectiveCustomerId, pointsRewardedPaise.toString(), dto.orderId],
        );
      }

      // 4. Insert feedback
      const insertRes = await client.query<FeedbackRow>(
        `INSERT INTO feedback (org_id, outlet_id, order_id, customer_id, rating, tags, comment, points_rewarded_paise)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          orgId,
          order.outlet_id,
          dto.orderId,
          effectiveCustomerId,
          dto.rating,
          dto.tags,
          dto.comment || null,
          pointsRewardedPaise.toString(),
        ],
      );
      const feedback = insertRes.rows[0];
      if (!feedback) {
        throw new Error('Failed to record feedback');
      }

      // 5. Rating <= 3 triggers immediate manager notification event in outbox (ARCH §19)
      if (dto.rating <= 3) {
        await client.query(
          `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
           VALUES ($1, 'feedback', $2, 'FEEDBACK_LOW_RATING', $3)`,
          [
            orgId,
            feedback.id,
            JSON.stringify({
              feedback_id: feedback.id,
              order_id: dto.orderId,
              outlet_id: order.outlet_id,
              rating: dto.rating,
              tags: dto.tags,
              comment: dto.comment || null,
              created_at: feedback.created_at,
            }),
          ],
        );
        this.logger.warn(
          `[FEEDBACK] Low rating alert triggered for order ${dto.orderId} (Rating: ${dto.rating})`,
        );
      }

      // 6. Look up GBP connection or default link
      // CRITICAL: Google review link is shown to ALL customers equally after feedback
      // (no gating by rating, no reward wording attached).
      const gbpRes = await client.query<{ location_ref: string }>(
        `SELECT location_ref FROM gbp_connections WHERE org_id = $1 AND outlet_id = $2`,
        [orgId, order.outlet_id],
      );
      const placeId = gbpRes.rows[0]?.location_ref || 'ChIJN1t_tDeuEmsRUsoyG83frY4';
      const googleReviewUrl = `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;

      return {
        feedbackId: feedback.id,
        rating: feedback.rating,
        pointsRewardedPaise: Number(feedback.points_rewarded_paise),
        googleReviewUrl,
        message:
          'Thank you for your feedback! If you have a moment, please consider sharing your experience on Google as well.',
      };
    });
  }

  // ─── Console: List Feedback ─────────────────────────────────────────────────

  async listFeedback(orgId: string, query: FeedbackQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const conditions: string[] = ['org_id = $1'];
      const values: any[] = [orgId];
      let pIdx = 2;

      if (query.outletId) {
        conditions.push(`outlet_id = $${pIdx++}`);
        values.push(query.outletId);
      }
      if (query.rating) {
        conditions.push(`rating = $${pIdx++}`);
        values.push(query.rating);
      }
      if (query.from) {
        conditions.push(`created_at >= $${pIdx++}`);
        values.push(new Date(query.from));
      }
      if (query.to) {
        conditions.push(`created_at <= $${pIdx++}`);
        values.push(new Date(query.to));
      }

      const whereClause = conditions.join(' AND ');

      const countRes = await client.query<{ count: string; avg_rating: string | null }>(
        `SELECT COUNT(*) as count, AVG(rating) as avg_rating FROM feedback WHERE ${whereClause}`,
        values,
      );

      const itemsRes = await client.query<FeedbackRow>(
        `SELECT * FROM feedback WHERE ${whereClause} ORDER BY created_at DESC LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...values, query.limit, query.offset],
      );

      const summary = countRes.rows[0];

      return {
        total: Number(summary?.count || 0),
        averageRating: summary?.avg_rating
          ? Math.round(Number(summary.avg_rating) * 10) / 10
          : null,
        items: itemsRes.rows.map((r) => ({
          id: r.id,
          outletId: r.outlet_id,
          orderId: r.order_id,
          customerId: r.customer_id,
          rating: r.rating,
          tags: r.tags,
          comment: r.comment,
          pointsRewardedPaise: Number(r.points_rewarded_paise),
          createdAt: r.created_at,
        })),
      };
    });
  }

  // ─── GBP Connection (Google Business Profile OAuth) ─────────────────────────

  async connectGbp(
    orgId: string,
    dto: ConnectGbpDto,
    encryptionKey?: string,
  ) {
    const encryptedToken = encryptToken(dto.refreshToken, resolveGbpEncryptionKey(encryptionKey));

    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `INSERT INTO gbp_connections (org_id, outlet_id, google_account_ref, location_ref, refresh_token_enc, status, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'CONNECTED', now())
         ON CONFLICT (org_id, outlet_id) DO UPDATE SET
           google_account_ref = EXCLUDED.google_account_ref,
           location_ref = EXCLUDED.location_ref,
           refresh_token_enc = EXCLUDED.refresh_token_enc,
           status = 'CONNECTED',
           updated_at = now()
         RETURNING id, org_id, outlet_id, google_account_ref, location_ref, status, created_at, updated_at`,
        [orgId, dto.outletId, dto.googleAccountRef, dto.locationRef, encryptedToken],
      );

      const row = res.rows[0];
      if (!row) {
        throw new Error('Failed to record GBP connection');
      }

      return {
        id: row.id,
        outletId: row.outlet_id,
        googleAccountRef: row.google_account_ref,
        locationRef: row.location_ref,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    });
  }

  async getGbpConnection(orgId: string, outletId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `SELECT id, outlet_id, google_account_ref, location_ref, status, created_at, updated_at
         FROM gbp_connections WHERE org_id = $1 AND outlet_id = $2`,
        [orgId, outletId],
      );
      if (res.rows.length === 0) {
        return null;
      }
      return res.rows[0];
    });
  }

  // ─── Google Review Snapshots (NO linkage to customers/orders) ───────────────

  async syncReviewSnapshots(orgId: string, dto: SyncReviewsDto) {
    return withTenantContextRaw(orgId, async (client) => {
      let upsertedCount = 0;
      for (const rev of dto.reviews) {
        await client.query(
          `INSERT INTO review_snapshots (
             org_id, outlet_id, review_ref, star_rating, comment,
             reviewer_display_name, create_time, update_time, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (org_id, review_ref) DO UPDATE SET
             star_rating = EXCLUDED.star_rating,
             comment = EXCLUDED.comment,
             reviewer_display_name = EXCLUDED.reviewer_display_name,
             update_time = EXCLUDED.update_time,
             updated_at = now()`,
          [
            orgId,
            dto.outletId,
            rev.reviewRef,
            rev.starRating,
            rev.comment || null,
            rev.reviewerDisplayName || null,
            new Date(rev.createTime),
            rev.updateTime ? new Date(rev.updateTime) : null,
          ],
        );
        upsertedCount++;
      }
      return { syncedCount: upsertedCount };
    });
  }

  async listReviews(
    orgId: string,
    query: { outletId?: string; rating?: number; limit?: number; offset?: number },
  ) {
    return withTenantContextRaw(orgId, async (client) => {
      const conditions: string[] = ['org_id = $1'];
      const values: any[] = [orgId];
      let pIdx = 2;

      if (query.outletId) {
        conditions.push(`outlet_id = $${pIdx++}`);
        values.push(query.outletId);
      }
      if (query.rating) {
        conditions.push(`star_rating = $${pIdx++}`);
        values.push(query.rating);
      }

      const whereClause = conditions.join(' AND ');
      const limit = query.limit || 50;
      const offset = query.offset || 0;

      const countRes = await client.query<{ count: string; avg_rating: string | null }>(
        `SELECT COUNT(*) as count, AVG(star_rating) as avg_rating FROM review_snapshots WHERE ${whereClause}`,
        values,
      );

      const itemsRes = await client.query<ReviewSnapshotRow>(
        `SELECT * FROM review_snapshots WHERE ${whereClause} ORDER BY create_time DESC LIMIT $${pIdx++} OFFSET $${pIdx++}`,
        [...values, limit, offset],
      );

      const summary = countRes.rows[0];

      return {
        total: Number(summary?.count || 0),
        averageRating: summary?.avg_rating
          ? Math.round(Number(summary.avg_rating) * 10) / 10
          : null,
        items: itemsRes.rows.map((r) => ({
          id: r.id,
          outletId: r.outlet_id,
          reviewRef: r.review_ref,
          starRating: r.star_rating,
          comment: r.comment,
          reviewerDisplayName: r.reviewer_display_name,
          createTime: r.create_time,
          replyText: r.reply_text,
          repliedAt: r.replied_at,
          repliedBy: r.replied_by,
        })),
      };
    });
  }

  async replyToReview(
    orgId: string,
    staffUserId: string,
    reviewId: string,
    dto: ReplyReviewDto,
  ) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query<ReviewSnapshotRow>(
        `UPDATE review_snapshots
         SET reply_text = $1, replied_at = now(), replied_by = $2, updated_at = now()
         WHERE org_id = $3 AND id = $4
         RETURNING *`,
        [dto.replyText, staffUserId, orgId, reviewId],
      );

      const r = res.rows[0];
      if (!r) {
        throw new NotFoundException(`Review ${reviewId} not found`);
      }

      return {
        id: r.id,
        outletId: r.outlet_id,
        reviewRef: r.review_ref,
        starRating: r.star_rating,
        replyText: r.reply_text,
        repliedAt: r.replied_at,
        repliedBy: r.replied_by,
      };
    });
  }

  // ─── Rating Trend & Dashboard Metrics ───────────────────────────────────────

  async getRatingTrend(orgId: string, outletId?: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const params = outletId ? [orgId, outletId] : [orgId];
      const outletFilterFeedback = outletId ? 'AND outlet_id = $2' : '';
      const outletFilterReviews = outletId ? 'AND outlet_id = $2' : '';

      // Feedback stats
      const fbStatsRes = await client.query<{
        total_feedback: string;
        avg_rating: string | null;
        c1: string;
        c2: string;
        c3: string;
        c4: string;
        c5: string;
      }>(
        `SELECT
           COUNT(*) as total_feedback,
           AVG(rating) as avg_rating,
           COUNT(*) FILTER (WHERE rating = 1) as c1,
           COUNT(*) FILTER (WHERE rating = 2) as c2,
           COUNT(*) FILTER (WHERE rating = 3) as c3,
           COUNT(*) FILTER (WHERE rating = 4) as c4,
           COUNT(*) FILTER (WHERE rating = 5) as c5
         FROM feedback
         WHERE org_id = $1 ${outletFilterFeedback}`,
        params,
      );

      // Google review snapshots stats
      const revStatsRes = await client.query<{
        total_reviews: string;
        avg_rating: string | null;
        c1: string;
        c2: string;
        c3: string;
        c4: string;
        c5: string;
        replied_count: string;
      }>(
        `SELECT
           COUNT(*) as total_reviews,
           AVG(star_rating) as avg_rating,
           COUNT(*) FILTER (WHERE star_rating = 1) as c1,
           COUNT(*) FILTER (WHERE star_rating = 2) as c2,
           COUNT(*) FILTER (WHERE star_rating = 3) as c3,
           COUNT(*) FILTER (WHERE star_rating = 4) as c4,
           COUNT(*) FILTER (WHERE star_rating = 5) as c5,
           COUNT(*) FILTER (WHERE reply_text IS NOT NULL) as replied_count
         FROM review_snapshots
         WHERE org_id = $1 ${outletFilterReviews}`,
        params,
      );

      const fb = fbStatsRes.rows[0];
      const rev = revStatsRes.rows[0];

      return {
        feedback: {
          total: Number(fb?.total_feedback || 0),
          averageRating: fb?.avg_rating ? Math.round(Number(fb.avg_rating) * 10) / 10 : 0,
          distribution: {
            1: Number(fb?.c1 || 0),
            2: Number(fb?.c2 || 0),
            3: Number(fb?.c3 || 0),
            4: Number(fb?.c4 || 0),
            5: Number(fb?.c5 || 0),
          },
        },
        googleReviews: {
          total: Number(rev?.total_reviews || 0),
          averageRating: rev?.avg_rating ? Math.round(Number(rev.avg_rating) * 10) / 10 : 0,
          repliedCount: Number(rev?.replied_count || 0),
          pendingReplyCount: Math.max(0, Number(rev?.total_reviews || 0) - Number(rev?.replied_count || 0)),
          distribution: {
            1: Number(rev?.c1 || 0),
            2: Number(rev?.c2 || 0),
            3: Number(rev?.c3 || 0),
            4: Number(rev?.c4 || 0),
            5: Number(rev?.c5 || 0),
          },
        },
      };
    });
  }
}
