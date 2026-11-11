import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ─── Submit Feedback (Private order feedback) ────────────────────────────────

export const SubmitFeedbackSchema = z
  .object({
    orderId: z.string().uuid(),
    rating: z.number().int().min(1).max(5),
    tags: z.array(z.string().min(1).max(50)).default([]),
    comment: z.string().max(1000).optional(),
  })
  .strict();

export class SubmitFeedbackDto extends createZodDto(SubmitFeedbackSchema) {}

// ─── Query Feedback ──────────────────────────────────────────────────────────

export const FeedbackQuerySchema = z
  .object({
    outletId: z.string().uuid().optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export class FeedbackQueryDto extends createZodDto(FeedbackQuerySchema) {}

// ─── Connect GBP (Google Business Profile) ───────────────────────────────────

export const ConnectGbpSchema = z
  .object({
    outletId: z.string().uuid(),
    googleAccountRef: z.string().min(1).max(255),
    locationRef: z.string().min(1).max(255),
    refreshToken: z.string().min(1).max(4096),
  })
  .strict();

export class ConnectGbpDto extends createZodDto(ConnectGbpSchema) {}

// ─── Sync Reviews (Google Review Snapshots) ───────────────────────────────────

export const SyncReviewItemSchema = z
  .object({
    reviewRef: z.string().min(1).max(255),
    starRating: z.number().int().min(1).max(5),
    comment: z.string().max(4000).nullable().optional(),
    reviewerDisplayName: z.string().max(255).nullable().optional(),
    createTime: z.string().datetime(),
    updateTime: z.string().datetime().optional(),
  })
  .strict();

export const SyncReviewsSchema = z
  .object({
    outletId: z.string().uuid(),
    reviews: z.array(SyncReviewItemSchema).min(1).max(200),
  })
  .strict();

export class SyncReviewsDto extends createZodDto(SyncReviewsSchema) {}

// ─── Query Reviews ───────────────────────────────────────────────────────────

export const ReviewListQuerySchema = z
  .object({
    outletId: z.string().uuid().optional(),
    rating: z.coerce.number().int().min(1).max(5).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export class ReviewListQueryDto extends createZodDto(ReviewListQuerySchema) {}

// ─── Reply to Review ─────────────────────────────────────────────────────────

export const ReplyReviewSchema = z
  .object({
    replyText: z.string().min(1).max(2000),
  })
  .strict();

export class ReplyReviewDto extends createZodDto(ReplyReviewSchema) {}
