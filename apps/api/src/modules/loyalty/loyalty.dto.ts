import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ─── Create Coupon ────────────────────────────────────────────────────────────

export const CreateCouponSchema = z
  .object({
    code: z
      .string()
      .min(3)
      .max(30)
      .regex(/^[A-Z0-9_-]+$/i, { message: 'Coupon code must be alphanumeric' })
      .transform((c) => c.toUpperCase()),
    type: z.enum(['PERCENT', 'FLAT']),
    value: z.number().int().min(1),
    maxDiscountPaise: z.number().int().min(1).optional(),
    minOrderPaise: z.number().int().min(0).default(0),
    audience: z.enum(['ALL', 'SIGNED_IN', 'NEW', 'RETURNING']).default('ALL'),
    validFrom: z.string().datetime(),
    validTo: z.string().datetime(),
    usageLimitTotal: z.number().int().min(1).optional(),
    usageLimitPerCustomer: z.number().int().min(1).default(1),
    stackable: z.boolean().default(false),
    outlets: z.array(z.string().uuid()).default([]),
    isActive: z.boolean().default(true),
  })
  .strict()
  .refine((d) => new Date(d.validFrom) <= new Date(d.validTo), {
    message: 'validFrom must be before or equal to validTo',
    path: ['validFrom'],
  });

export class CreateCouponDto extends createZodDto(CreateCouponSchema) {}

// ─── Update Coupon ────────────────────────────────────────────────────────────

export const UpdateCouponSchema = z
  .object({
    maxDiscountPaise: z.number().int().min(1).optional(),
    minOrderPaise: z.number().int().min(0).optional(),
    audience: z.enum(['ALL', 'SIGNED_IN', 'NEW', 'RETURNING']).optional(),
    validFrom: z.string().datetime().optional(),
    validTo: z.string().datetime().optional(),
    usageLimitTotal: z.number().int().min(1).optional(),
    usageLimitPerCustomer: z.number().int().min(1).optional(),
    stackable: z.boolean().optional(),
    outlets: z.array(z.string().uuid()).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export class UpdateCouponDto extends createZodDto(UpdateCouponSchema) {}

// ─── Validate Coupon ──────────────────────────────────────────────────────────

export const ValidateCouponSchema = z
  .object({
    code: z.string().min(1).transform((c) => c.toUpperCase()),
    subtotalPaise: z.number().int().min(1),
    outletId: z.string().uuid(),
    customerId: z.string().uuid().optional(),
  })
  .strict();

export class ValidateCouponDto extends createZodDto(ValidateCouponSchema) {}

// ─── Update Loyalty Settings ──────────────────────────────────────────────────

export const UpdateLoyaltySettingsSchema = z
  .object({
    maxWalletRedemptionPercent: z.number().int().min(0).max(100).optional(),
    referrerRewardPercent: z.number().int().min(0).max(100).optional(),
    referrerMaxRewardPaise: z.number().int().min(0).optional(),
    refereeDiscountPaise: z.number().int().min(0).optional(),
    pointsEarnPercent: z.number().int().min(0).max(50).optional(),
    isLoyaltyEnabled: z.boolean().optional(),
    isReferralEnabled: z.boolean().optional(),
  })
  .strict();

export class UpdateLoyaltySettingsDto extends createZodDto(UpdateLoyaltySettingsSchema) {}

// ─── Claim Referral ───────────────────────────────────────────────────────────

export const ClaimReferralSchema = z
  .object({
    referralCode: z.string().min(3),
    deviceId: z.string().optional(),
    ipHash: z.string().optional(),
  })
  .strict();

export class ClaimReferralDto extends createZodDto(ClaimReferralSchema) {}
