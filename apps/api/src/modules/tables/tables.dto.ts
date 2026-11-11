import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ─── Table DTOs ───────────────────────────────────────────────────────────────

export const CreateTableSchema = z.object({
  outlet_id: z.string().uuid(),
  table_number: z.string().min(1).max(20),
  capacity: z.number().int().min(1).default(4),
  section: z.string().max(100).optional(),
}).strict();

export const UpdateTableSchema = CreateTableSchema.partial().omit({ outlet_id: true }).strict();

export class CreateTableDto extends createZodDto(CreateTableSchema) {}
export class UpdateTableDto extends createZodDto(UpdateTableSchema) {}

// ─── QR Token response (returned on GET table/:id/qr) ────────────────────────

export const QrTokenSchema = z.object({
  table_id: z.string().uuid(),
  token: z.string(),
  scan_url: z.string().url(),
  version: z.number().int(),
});

// ─── Session DTOs ─────────────────────────────────────────────────────────────

/**
 * Sent by customer app after scanning QR.
 * NEEDS_HUMAN_REVIEW: QR token validation flow — ensure replay cannot occur
 * across version bumps.
 */
export const OpenSessionSchema = z.object({
  qr_token: z.string().min(1),
  pax: z.number().int().min(1).max(20).default(1),
}).strict();

export class OpenSessionDto extends createZodDto(OpenSessionSchema) {}

// ─── Parse helpers ────────────────────────────────────────────────────────────

export const parseCreateTableDto = (input: unknown) =>
  CreateTableSchema.parse(input);
