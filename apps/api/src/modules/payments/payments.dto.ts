import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const PAYMENT_METHODS = [
  'UPI', 'UPI_INTENT', 'CARD', 'NETBANKING', 'WALLET',
  'CASH', 'DIRECT_UPI_STAFF', 'PAY_AT_COUNTER',
] as const;

// ─── Create Payment ────────────────────────────────────────────────────────────

/**
 * CreatePaymentSchema
 *
 * SECURITY (AGENTS §2 rule 2):
 *   - amount_paise is intentionally NOT in this schema. The server re-derives
 *     the amount from the order's grand_total. Any client-sent amount is ignored.
 *   - order_id must belong to the authenticated org (enforced via RLS + query).
 *   - idempotency_key prevents duplicate payments on retry.
 */
export const CreatePaymentSchema = z.object({
  order_id:         z.string().uuid(),
  idempotency_key:  z.string().uuid(),
  method:           z.enum(PAYMENT_METHODS),
  return_url:       z.string().url().optional(),
  customer_phone:   z.string().optional(),
  customer_name:    z.string().max(100).optional(),
}).strict();

// Use the class as DTO (NestJS needs the class for DI and Swagger)
export class CreatePaymentDto extends createZodDto(CreatePaymentSchema) {}

// ─── Refund ───────────────────────────────────────────────────────────────────

export const CreateRefundSchema = z.object({
  amount_paise:     z.number().int().positive(),   // integer paise (AGENTS §2 rule 1)
  reason:           z.string().min(1).max(500),
  idempotency_key:  z.string().uuid(),
}).strict();

export class CreateRefundDto extends createZodDto(CreateRefundSchema) {}

export const ReconcileReturnQuerySchema = z.object({
  orderId:               z.string().uuid(),
  merchantTransactionId: z.string().trim().min(8).max(128),
}).strict();

export class ReconcileReturnQueryDto extends createZodDto(ReconcileReturnQuerySchema) {}
