import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Permission } from '@dineflow/contracts';
import {
  Require,
  CurrentUser,
  type StaffJwtPayload,
  type CustomerJwtPayload,
  type GuestSessionJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { toCustomerAccessScope } from '../../common/utils/ownership.utils.js';
import { FeedbackService } from './feedback.service.js';
import {
  SubmitFeedbackDto,
  FeedbackQueryDto,
  ReviewListQueryDto,
  ConnectGbpDto,
  SyncReviewsDto,
  ReplyReviewDto,
} from './feedback.dto.js';

/**
 * Console (Staff / Owner / Manager) Controller for Feedback & Reputation.
 */
@Controller('console')
export class ConsoleFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /**
   * List customer private feedback with optional filters.
   */
  @Get('feedback')
  @Require(Permission.FEEDBACK_READ)
  listFeedback(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: FeedbackQueryDto,
  ) {
    return this.feedbackService.listFeedback(user.org, query);
  }

  /**
   * Get ratings trend and aggregated metrics across feedback and Google reviews.
   */
  @Get('reviews/trends')
  @Require(Permission.REVIEWS_READ)
  getRatingTrend(
    @CurrentUser() user: StaffJwtPayload,
    @Query('outletId') outletId?: string,
  ) {
    return this.feedbackService.getRatingTrend(user.org, outletId);
  }

  /**
   * List synced Google review snapshots.
   * Invariant: snapshots contain NO linkage to customers or orders.
   */
  @Get('reviews')
  @Require(Permission.REVIEWS_READ)
  listReviews(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: ReviewListQueryDto,
  ) {
    return this.feedbackService.listReviews(user.org, query);
  }

  /**
   * Connect Google Business Profile via owner-initiated OAuth.
   * Refresh token is encrypted with AES-256-GCM before database storage.
   */
  @Post('reviews/gbp/connect')
  @Require(Permission.FEEDBACK_MANAGE)
  @HttpCode(HttpStatus.OK)
  connectGbp(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: ConnectGbpDto,
  ) {
    return this.feedbackService.connectGbp(user.org, dto);
  }

  /**
   * Ingest / sync Google review snapshots.
   */
  @Post('reviews/sync')
  @Require(Permission.FEEDBACK_MANAGE)
  @HttpCode(HttpStatus.OK)
  syncReviews(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: SyncReviewsDto,
  ) {
    return this.feedbackService.syncReviewSnapshots(user.org, dto);
  }

  /**
   * Post a reply to a Google review.
   */
  @Post('reviews/:id/reply')
  @Require(Permission.REVIEWS_REPLY)
  @HttpCode(HttpStatus.OK)
  replyToReview(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: ReplyReviewDto,
  ) {
    return this.feedbackService.replyToReview(user.org, user.sub, id, dto);
  }
}

/**
 * Customer & Public Controller for submitting private post-meal feedback.
 */
@Controller()
export class CustomerFeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  /**
   * Signed-in customer submits feedback on their order.
   * Invariant: Reward points are awarded regardless of rating (1 star = 5 stars).
   * Google review link is returned to all customers equally.
   */
  @Post('me/feedback')
  @Require(Permission.CUSTOMER_READ)
  @HttpCode(HttpStatus.CREATED)
  submitFeedbackAuth(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: SubmitFeedbackDto,
  ) {
    return this.feedbackService.submitFeedback(user.org, user.sub, dto, {
      scope: toCustomerAccessScope(user),
    });
  }

  /**
   * Guest table-session diner submits feedback on an order in their session.
   * Invariant: Rating <= 3 triggers service recovery alert. Google review link returned to all.
   */
  @Post('public/feedback')
  @Require(Permission.GUEST_SESSION)
  @HttpCode(HttpStatus.CREATED)
  submitFeedbackGuest(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Body() dto: SubmitFeedbackDto,
  ) {
    const customerId = user.type === 'customer_access' ? user.sub : (user.customerId ?? null);
    return this.feedbackService.submitFeedback(user.org, customerId, dto, {
      scope: toCustomerAccessScope(user),
    });
  }
}
