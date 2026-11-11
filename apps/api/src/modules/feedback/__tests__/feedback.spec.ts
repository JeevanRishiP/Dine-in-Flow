import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FeedbackService, DEFAULT_FEEDBACK_REWARD_PAISE } from '../feedback.service.js';
import * as dbClient from '../../../db/client.js';

describe('Feedback & Reputation Service (Phase 8)', () => {
  let service: FeedbackService;
  let mockClient: any;

  const orgId = 'org-uuid-1';
  const outletId = 'outlet-uuid-1';
  const orderId = 'order-uuid-1';
  const customerId = 'customer-uuid-1';

  beforeEach(() => {
    service = new FeedbackService();

    mockClient = {
      query: vi.fn(),
    };

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async (_orgId: string, fn: (client: any) => Promise<any>) => {
        return fn(mockClient);
      },
    );
  });

  describe('Rating-Independent Feedback Rewards (ARCH §19, AGENTS §2 rule 10)', () => {
    it('awards the exact same points for a 1-star rating and a 5-star rating', async () => {
      // Setup mock queries for 1-star feedback
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: orderId, outlet_id: outletId, customer_id: customerId }] }) // order check
        .mockResolvedValueOnce({ rows: [] }) // existing feedback check
        .mockResolvedValueOnce({ rows: [] }) // loyalty_ledger insert
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-1',
              org_id: orgId,
              outlet_id: outletId,
              order_id: orderId,
              customer_id: customerId,
              rating: 1,
              tags: ['cold_food'],
              comment: 'Food was cold',
              points_rewarded_paise: DEFAULT_FEEDBACK_REWARD_PAISE.toString(),
              created_at: new Date(),
            },
          ],
        }) // feedback insert
        .mockResolvedValueOnce({ rows: [] }) // outbox low rating alert
        .mockResolvedValueOnce({ rows: [{ location_ref: 'place-ref-123' }] }); // gbp connection

      const result1Star = await service.submitFeedback(orgId, customerId, {
        orderId,
        rating: 1,
        tags: ['cold_food'],
        comment: 'Food was cold',
      });

      // Setup mock queries for 5-star feedback
      const orderId2 = 'order-uuid-2';
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: orderId2, outlet_id: outletId, customer_id: customerId }] }) // order check
        .mockResolvedValueOnce({ rows: [] }) // existing feedback check
        .mockResolvedValueOnce({ rows: [] }) // loyalty_ledger insert
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-2',
              org_id: orgId,
              outlet_id: outletId,
              order_id: orderId2,
              customer_id: customerId,
              rating: 5,
              tags: ['fast_service', 'delicious'],
              comment: 'Outstanding food!',
              points_rewarded_paise: DEFAULT_FEEDBACK_REWARD_PAISE.toString(),
              created_at: new Date(),
            },
          ],
        }) // feedback insert
        // No outbox low rating query for 5-star
        .mockResolvedValueOnce({ rows: [{ location_ref: 'place-ref-123' }] }); // gbp connection

      const result5Star = await service.submitFeedback(orgId, customerId, {
        orderId: orderId2,
        rating: 5,
        tags: ['fast_service', 'delicious'],
        comment: 'Outstanding food!',
      });

      // INVARIANT: Exactly identical points rewarded (1000 paise = ₹10) regardless of rating
      expect(result1Star.pointsRewardedPaise).toBe(1000);
      expect(result5Star.pointsRewardedPaise).toBe(1000);
      expect(result1Star.pointsRewardedPaise).toBe(result5Star.pointsRewardedPaise);
    });

    it('shows the Google review link to ALL customers equally (no rating gating)', async () => {
      // 1-star customer receives Google review link
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: orderId, outlet_id: outletId, customer_id: customerId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-1',
              rating: 1,
              points_rewarded_paise: '1000',
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // outbox low rating alert
        .mockResolvedValueOnce({ rows: [{ location_ref: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }] });

      const res1 = await service.submitFeedback(orgId, customerId, {
        orderId,
        rating: 1,
        tags: [],
      });

      expect(res1.googleReviewUrl).toBeDefined();
      expect(res1.googleReviewUrl).toContain('search.google.com/local/writereview');

      // 5-star customer receives identical Google review link pattern
      const orderId2 = 'order-uuid-2';
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: orderId2, outlet_id: outletId, customer_id: customerId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-2',
              rating: 5,
              points_rewarded_paise: '1000',
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ location_ref: 'ChIJN1t_tDeuEmsRUsoyG83frY4' }] });

      const res5 = await service.submitFeedback(orgId, customerId, {
        orderId: orderId2,
        rating: 5,
        tags: [],
      });

      expect(res5.googleReviewUrl).toBe(res1.googleReviewUrl);
    });

    it('rejects duplicate feedback submission for the same order (1 feedback per order)', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: orderId, outlet_id: outletId, customer_id: customerId }] })
        .mockResolvedValueOnce({ rows: [{ id: 'existing-feedback-id' }] }); // already exists

      await expect(
        service.submitFeedback(orgId, customerId, {
          orderId,
          rating: 4,
          tags: [],
        }),
      ).rejects.toThrow('Feedback has already been submitted for order');
    });

    it('triggers a low-rating alert in outbox_events for rating <= 3', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: orderId, outlet_id: outletId, customer_id: customerId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-low',
              org_id: orgId,
              outlet_id: outletId,
              order_id: orderId,
              customer_id: customerId,
              rating: 2,
              tags: ['slow_service'],
              comment: 'Wait was 45 mins',
              points_rewarded_paise: '1000',
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // outbox insert
        .mockResolvedValueOnce({ rows: [] }); // gbp connection

      await service.submitFeedback(orgId, customerId, {
        orderId,
        rating: 2,
        tags: ['slow_service'],
        comment: 'Wait was 45 mins',
      });

      // Verify outbox event insertion
      const outboxCall = mockClient.query.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('outbox_events'),
      );
      expect(outboxCall).toBeDefined();
      expect(outboxCall[0]).toContain('FEEDBACK_LOW_RATING');

      const payload = JSON.parse(outboxCall[1][2]);
      expect(payload.rating).toBe(2);
      expect(payload.order_id).toBe(orderId);
      expect(payload.comment).toBe('Wait was 45 mins');
    });

    it('does NOT trigger a low-rating alert for rating > 3', async () => {
      mockClient.query
        .mockResolvedValueOnce({ rows: [{ id: orderId, outlet_id: outletId, customer_id: customerId }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'fb-high',
              org_id: orgId,
              outlet_id: outletId,
              order_id: orderId,
              customer_id: customerId,
              rating: 4,
              tags: ['good_vibe'],
              comment: null,
              points_rewarded_paise: '1000',
              created_at: new Date(),
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // gbp connection

      await service.submitFeedback(orgId, customerId, {
        orderId,
        rating: 4,
        tags: ['good_vibe'],
      });

      const outboxCall = mockClient.query.mock.calls.find(
        (call: any[]) => typeof call[0] === 'string' && call[0].includes('outbox_events'),
      );
      expect(outboxCall).toBeUndefined();
    });
  });

  describe('Google Review Snapshots & Privacy Invariants', () => {
    it('syncs review snapshots with strictly NO customer or order linkage', async () => {
      mockClient.query.mockResolvedValue({ rows: [] });

      const syncDto = {
        outletId,
        reviews: [
          {
            reviewRef: 'accounts/123/locations/456/reviews/rev1',
            starRating: 5,
            comment: 'Great ambience and dosa!',
            reviewerDisplayName: 'Priya S.',
            createTime: new Date().toISOString(),
          },
        ],
      };

      const result = await service.syncReviewSnapshots(orgId, syncDto);
      expect(result.syncedCount).toBe(1);

      // Verify the SQL query does not touch customer_id or order_id
      const insertCall = mockClient.query.mock.calls[0];
      const sql = insertCall[0];
      expect(sql).toContain('review_snapshots');
      expect(sql).not.toContain('customer_id');
      expect(sql).not.toContain('order_id');
    });

    it('allows replying to a review and stores replied_by staff reference', async () => {
      const reviewId = 'rev-uuid-1';
      const staffUserId = 'staff-uuid-1';

      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: reviewId,
            outlet_id: outletId,
            review_ref: 'rev1',
            star_rating: 5,
            reply_text: 'Thank you for your visit!',
            replied_at: new Date(),
            replied_by: staffUserId,
          },
        ],
      });

      const reply = await service.replyToReview(orgId, staffUserId, reviewId, {
        replyText: 'Thank you for your visit!',
      });

      expect(reply.replyText).toBe('Thank you for your visit!');
      expect(reply.repliedBy).toBe(staffUserId);
    });
  });

  describe('GBP Connection & OAuth Token Security', () => {
    it('encrypts the refresh token before storing in gbp_connections', async () => {
      const plainRefreshToken = '1//0gM7SampleSecretRefreshToken';

      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'gbp-conn-1',
            org_id: orgId,
            outlet_id: outletId,
            google_account_ref: 'accounts/12345',
            location_ref: 'locations/67890',
            status: 'CONNECTED',
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      });

      const result = await service.connectGbp(orgId, {
        outletId,
        googleAccountRef: 'accounts/12345',
        locationRef: 'locations/67890',
        refreshToken: plainRefreshToken,
      });

      expect(result.status).toBe('CONNECTED');
      // Secret token must NEVER be returned to the client
      expect((result as any).refreshToken).toBeUndefined();
      expect((result as any).refresh_token_enc).toBeUndefined();

      // Verify that the query received an encrypted token, not the plaintext
      const insertCall = mockClient.query.mock.calls[0];
      const storedToken = insertCall[1][4];
      expect(storedToken).not.toEqual(plainRefreshToken);
      expect(storedToken).toContain(':'); // iv:authTag:cipher format
    });
  });
});
