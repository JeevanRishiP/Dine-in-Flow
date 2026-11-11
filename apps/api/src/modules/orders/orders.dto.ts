import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// ─── Order Item (line in a cart/order) ───────────────────────────────────────

const OrderModifierSchema = z.object({
  modifier_id: z.string().uuid(),
  // NOTE: name + price are intentionally NOT accepted from the client.
  // The server derives them from the DB. This prevents price tampering (AGENTS §2 rule 2).
}).strict();

const OrderLineSchema = z.object({
  menu_item_id: z.string().uuid(),
  quantity: z.number().int().min(1).max(100),
  modifiers: z.array(OrderModifierSchema).default([]),
  portion: z.enum(['FULL', 'HALF']).optional().default('FULL'),
  notes: z.string().max(500).optional(),
}).strict();

// ─── Quote Order ──────────────────────────────────────────────────────────────

/**
 * QuoteOrderSchema — client requests a server-computed price quote.
 * The server returns an OrderQuote including a `price_fingerprint`.
 * The client must include this fingerprint in the subsequent POST /orders.
 * If prices have changed between quote and order, server returns 409 PRICE_CHANGED
 * with a fresh quote so the customer can confirm before proceeding.
 */
export const QuoteOrderSchema = z.object({
  session_id: z.string().uuid(),
  items: z.array(OrderLineSchema).min(1).max(50),
  tip_paise: z.number().int().min(0).optional().default(0),
}).strict();

export class QuoteOrderDto extends createZodDto(QuoteOrderSchema) {}

// ─── Place Order ──────────────────────────────────────────────────────────────

/**
 * PlaceOrderSchema — customer or waiter submits an order.
 *
 * SECURITY (AGENTS §2 rule 2):
 *   - Prices are NEVER trusted from the client — all pricing is derived
 *     server-side from the database at the time of placement.
 *   - session_id must belong to an OPEN session in the caller's org.
 *   - idempotency_key enforces exactly-once semantics (AGENTS §2 rule 8).
 *   - price_fingerprint: if the server-computed fingerprint differs from the
 *     client-sent one, the server returns HTTP 409 PRICE_CHANGED with a fresh
 *     quote so the customer can confirm before proceeding.
 */
export const PlaceOrderSchema = z.object({
  session_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),    // client generates a v4 UUID
  items: z.array(OrderLineSchema).min(1).max(50),
  /** Fingerprint from the last /quote response — detects stale prices */
  price_fingerprint: z.string().optional(),
  tip_paise: z.number().int().min(0).optional().default(0),
  notes: z.string().max(1000).optional(),
}).strict();

export class PlaceOrderDto extends createZodDto(PlaceOrderSchema) {}

// ─── Update Order Status (staff) ─────────────────────────────────────────────

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED', 'CANCELLED']),
  reason: z.string().max(500).optional(),  // required for CANCELLED
}).strict().refine(
  (d) => d.status !== 'CANCELLED' || d.reason !== undefined,
  { message: 'reason is required when cancelling an order', path: ['reason'] },
);

export class UpdateOrderStatusDto extends createZodDto(UpdateOrderStatusSchema) {}

// ─── Update Item Status (KDS) ─────────────────────────────────────────────────

export const UpdateItemStatusSchema = z.object({
  status: z.enum(['PREPARING', 'READY', 'SERVED', 'CANCELLED']),
}).strict();

export class UpdateItemStatusDto extends createZodDto(UpdateItemStatusSchema) {}

// ─── Query ────────────────────────────────────────────────────────────────────

export const OrderQuerySchema = z.object({
  outlet_id: z.string().uuid().optional(),
  status: z.enum(['PENDING','CONFIRMED','PREPARING','READY','SERVED','BILLED','CANCELLED']).optional(),
  session_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export class OrderQueryDto extends createZodDto(OrderQuerySchema) {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const parsePlaceOrderDto = (input: unknown) => PlaceOrderSchema.parse(input);
