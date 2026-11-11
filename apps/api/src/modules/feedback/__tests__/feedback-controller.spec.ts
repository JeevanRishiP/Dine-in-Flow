import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ConsoleFeedbackController,
  CustomerFeedbackController,
} from '../feedback.controller.js';
import type { FeedbackService } from '../feedback.service.js';
import type { StaffJwtPayload } from '../../../common/decorators/auth.decorators.js';
import type { CustomerJwtPayload, GuestSessionJwtPayload } from '../../auth/token.service.js';

describe('Feedback Controllers Dispatching & RBAC', () => {
  let consoleController: ConsoleFeedbackController;
  let customerController: CustomerFeedbackController;
  let mockFeedbackService: Partial<FeedbackService>;

  const mockStaffUser: StaffJwtPayload = {
    sub: 'staff-uuid-1',
    org: 'org-uuid-1',
    role: 'MANAGER',
    type: 'staff_access',
  };

  const mockCustomerUser: CustomerJwtPayload = {
    sub: 'customer-uuid-1',
    org: 'org-uuid-1',
    phone: '+919876543210',
    type: 'customer_access',
  };

  beforeEach(() => {
    mockFeedbackService = {
      submitFeedback: vi.fn().mockResolvedValue({
        feedbackId: 'fb-1',
        rating: 5,
        pointsRewardedPaise: 1000,
        googleReviewUrl: 'https://search.google.com/local/writereview?placeid=123',
      }),
      listFeedback: vi.fn().mockResolvedValue({ total: 1, items: [] }),
      getRatingTrend: vi.fn().mockResolvedValue({ feedback: {}, googleReviews: {} }),
      listReviews: vi.fn().mockResolvedValue({ total: 0, items: [] }),
      connectGbp: vi.fn().mockResolvedValue({ id: 'gbp-1', status: 'CONNECTED' }),
      syncReviewSnapshots: vi.fn().mockResolvedValue({ syncedCount: 1 }),
      replyToReview: vi.fn().mockResolvedValue({ id: 'rev-1', replyText: 'Thanks!' }),
    };

    consoleController = new ConsoleFeedbackController(mockFeedbackService as FeedbackService);
    customerController = new CustomerFeedbackController(mockFeedbackService as FeedbackService);
  });

  describe('Console Controller', () => {
    it('dispatches listFeedback with user org and query filters', async () => {
      await consoleController.listFeedback(mockStaffUser, { limit: 10, offset: 0 });
      expect(mockFeedbackService.listFeedback).toHaveBeenCalledWith(
        mockStaffUser.org,
        { limit: 10, offset: 0 },
      );
    });

    it('dispatches getRatingTrend with user org and outletId', async () => {
      await consoleController.getRatingTrend(mockStaffUser, 'outlet-1');
      expect(mockFeedbackService.getRatingTrend).toHaveBeenCalledWith(
        mockStaffUser.org,
        'outlet-1',
      );
    });

    it('dispatches connectGbp with user org and DTO', async () => {
      const dto = {
        outletId: '11111111-1111-1111-1111-111111111111',
        googleAccountRef: 'acc-1',
        locationRef: 'loc-1',
        refreshToken: 'token-1',
      };
      await consoleController.connectGbp(mockStaffUser, dto);
      expect(mockFeedbackService.connectGbp).toHaveBeenCalledWith(mockStaffUser.org, dto);
    });

    it('dispatches replyToReview with org, staff userId, and reviewId', async () => {
      await consoleController.replyToReview(mockStaffUser, 'rev-1', {
        replyText: 'Thanks for coming!',
      });
      expect(mockFeedbackService.replyToReview).toHaveBeenCalledWith(
        mockStaffUser.org,
        mockStaffUser.sub,
        'rev-1',
        { replyText: 'Thanks for coming!' },
      );
    });
  });

  describe('Customer Controller', () => {
    it('submits feedback for authenticated customer with customer id', async () => {
      const dto = {
        orderId: '11111111-1111-1111-1111-111111111111',
        rating: 5,
        tags: ['great'],
      };

      const result = await customerController.submitFeedbackAuth(mockCustomerUser, dto);
      expect(mockFeedbackService.submitFeedback).toHaveBeenCalledWith(
        mockCustomerUser.org,
        mockCustomerUser.sub,
        dto,
        { scope: { customerId: mockCustomerUser.sub } },
      );
      expect(result.googleReviewUrl).toBeDefined();
    });

    it('submits feedback for guest session with null customer id and session scope', async () => {
      const dto = {
        orderId: '11111111-1111-1111-1111-111111111111',
        rating: 4,
        tags: [],
      };
      const mockGuestSession: GuestSessionJwtPayload = {
        sub: 'session-uuid-1',
        org: 'org-uuid-1',
        outlet: 'outlet-uuid-1',
        table: 'table-uuid-1',
        sessionId: 'session-uuid-1',
        type: 'guest_session',
      };

      await customerController.submitFeedbackGuest(mockGuestSession, dto);
      expect(mockFeedbackService.submitFeedback).toHaveBeenCalledWith(
        'org-uuid-1',
        null,
        dto,
        { scope: { sessionId: 'session-uuid-1', customerId: undefined } },
      );
    });
  });
});
