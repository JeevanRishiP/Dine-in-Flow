import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const SendMessageSchema = z
  .object({
    phone: z
      .string()
      .min(10)
      .max(20)
      .regex(/^\+?[1-9]\d{6,14}$/, {
        message: 'Phone must be a valid E.164 phone number',
      }),
    templateName: z.string().min(1).max(100),
    language: z.string().min(2).max(10).default('en'),
    params: z.record(z.string()),
    customerId: z.string().uuid().optional(),
    idempotencyKey: z.string().max(100).optional(),
  })
  .strict();

export class SendMessageDto extends createZodDto(SendMessageSchema) {}

export const RecordConsentSchema = z
  .object({
    phone: z
      .string()
      .min(10)
      .max(20)
      .regex(/^\+?[1-9]\d{6,14}$/, {
        message: 'Phone must be a valid E.164 phone number',
      }),
    purpose: z.enum(['ORDERING', 'LOYALTY', 'MARKETING_WHATSAPP', 'ANALYTICS']),
    granted: z.boolean(),
    source: z.enum(['WEB_CHECKOUT', 'QR_SCAN', 'WA_INBOUND', 'ADMIN']).default('WEB_CHECKOUT'),
    noticeVersion: z.string().default('v1.0'),
  })
  .strict();

export class RecordConsentDto extends createZodDto(RecordConsentSchema) {}

export const UpdateMessagingSettingsSchema = z
  .object({
    monthlyBudgetPaise: z.number().int().min(0).optional(),
    dailyBudgetPaise: z.number().int().min(0).optional(),
    isMarketingEnabled: z.boolean().optional(),
    quietHoursStartUtc: z.number().int().min(0).max(23).optional(),
    quietHoursEndUtc: z.number().int().min(0).max(23).optional(),
    smsFallbackEnabled: z.boolean().optional(),
  })
  .strict();

export class UpdateMessagingSettingsDto extends createZodDto(UpdateMessagingSettingsSchema) {}

export const MessageQuerySchema = z
  .object({
    phone: z.string().optional(),
    category: z.enum(['AUTHENTICATION', 'UTILITY', 'MARKETING']).optional(),
    status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED']).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export class MessageQueryDto extends createZodDto(MessageQuerySchema) {}
