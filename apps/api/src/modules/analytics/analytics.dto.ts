import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const ISO_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Standard date range query for analytics dashboards.
 * Matches ARCH §17, AGENTS §2 rule 5 (strict Zod validation).
 */
export const DateRangeQuerySchema = z
  .object({
    from: z.string().regex(ISO_DATE_REGEX, { message: 'from must be YYYY-MM-DD' }),
    to: z.string().regex(ISO_DATE_REGEX, { message: 'to must be YYYY-MM-DD' }),
    outletId: z.string().uuid().optional(),
    comparison: z.enum(['previous_period', 'previous_year', 'none']).optional().default('previous_period'),
  })
  .strict()
  .refine((data) => data.from <= data.to, {
    message: 'from date must be before or equal to to date',
    path: ['from'],
  });

export class DateRangeQueryDto extends createZodDto(DateRangeQuerySchema) {}

/**
 * Query schema for top/bottom menu items.
 */
export const ItemsQuerySchema = z
  .object({
    from: z.string().regex(ISO_DATE_REGEX, { message: 'from must be YYYY-MM-DD' }),
    to: z.string().regex(ISO_DATE_REGEX, { message: 'to must be YYYY-MM-DD' }),
    outletId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),
  })
  .strict()
  .refine((data) => data.from <= data.to, {
    message: 'from date must be before or equal to to date',
    path: ['from'],
  });

export class ItemsQueryDto extends createZodDto(ItemsQuerySchema) {}

/**
 * Schema for triggering an async analytics export.
 */
export const CreateExportSchema = z
  .object({
    exportType: z.enum(['SALES', 'ITEMS', 'PAYMENTS', 'ORDERS']),
    format: z.enum(['CSV', 'JSON']),
    outletId: z.string().uuid().optional(),
    dateFrom: z.string().regex(ISO_DATE_REGEX, { message: 'dateFrom must be YYYY-MM-DD' }),
    dateTo: z.string().regex(ISO_DATE_REGEX, { message: 'dateTo must be YYYY-MM-DD' }),
  })
  .strict()
  .refine((data) => data.dateFrom <= data.dateTo, {
    message: 'dateFrom must be before or equal to dateTo',
    path: ['dateFrom'],
  });

export class CreateExportDto extends createZodDto(CreateExportSchema) {}

/**
 * Manual rollup trigger schema (for background job or admin sync)
 */
export const TriggerRollupSchema = z
  .object({
    outletId: z.string().uuid(),
    date: z.string().regex(ISO_DATE_REGEX, { message: 'date must be YYYY-MM-DD' }),
  })
  .strict();

export class TriggerRollupDto extends createZodDto(TriggerRollupSchema) {}
