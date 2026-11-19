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
  target_table_id: z.string().uuid().optional(),
  diner_id: z.string().optional(),
  diner_label: z.string().max(100).optional(),
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
  order_type: z.enum(['DINE_IN', 'PRE_BOOK_DINE_IN', 'TAKEAWAY']).optional().default('DINE_IN'),
  scheduled_for: z.string().datetime().optional().nullable(),
  guest_count: z.number().int().min(1).max(100).optional().nullable(),
  reservation_id: z.string().uuid().optional().nullable(),
  diner_id: z.string().optional(),
  diner_label: z.string().max(100).optional(),
}).strict();

export class PlaceOrderDto extends createZodDto(PlaceOrderSchema) {}

// ─── Update Order Status (staff) ─────────────────────────────────────────────

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED', 'COMPLETED', 'CANCELLED']),
  reason: z.string().max(500).optional(),  // required for CANCELLED
}).strict().refine(
  (d) => d.status !== 'CANCELLED' || d.reason !== undefined,
  { message: 'reason is required when cancelling an order', path: ['reason'] },
);

export class UpdateOrderStatusDto extends createZodDto(UpdateOrderStatusSchema) {}

// ─── Update Item Status (KDS) ─────────────────────────────────────────────────

export const UpdateItemStatusSchema = z.object({
  status: z.enum(['CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED']),
}).strict();

export class UpdateItemStatusDto extends createZodDto(UpdateItemStatusSchema) {}

// ─── Reassign Per-Plate Table (Customer) ──────────────────────────────────────

export const ReassignItemTableSchema = z
  .object({
    target_table_id: z.string().uuid().optional(),
    target_table_number: z.string().trim().min(1).max(20).regex(/^(?:T)?0*[0-9]{1,4}$/i, {
      message: 'Enter a numeric table number (digits only).',
    }).optional(),
    plate_index: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((d) => Boolean(d.target_table_id || d.target_table_number), {
    message: 'target_table_id or target_table_number is required',
  });

export class ReassignItemTableDto extends createZodDto(ReassignItemTableSchema) {}

// ─── Release Item Hold (Customer Serve Later -> Kitchen Now) ─────────────────

export const ReleaseHoldSchema = z
  .object({
    plate_keys: z.array(z.string().min(1)).optional(),
    item_id: z.string().uuid().optional(),
    itemId: z.string().uuid().optional(),
  })
  .strict();

export class ReleaseHoldDto extends createZodDto(ReleaseHoldSchema) {}

// ─── Query ────────────────────────────────────────────────────────────────────

export const OrderQuerySchema = z.object({
  outlet_id: z.string().uuid().optional(),
  status: z.enum([
    'AWAITING_PAYMENT',
    'PENDING',
    'CONFIRMED',
    'PREPARING',
    'READY',
    'SERVED',
    'BILLED',
    'COMPLETED',
    'CANCELLED',
    'PAYMENT_FAILED',
    'PAYMENT_CANCELLED',
    'PAYMENT_EXPIRED',
  ]).optional(),
  session_id: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();

export class OrderQueryDto extends createZodDto(OrderQuerySchema) {}

// ─── Check Availability (Reservations) ────────────────────────────────────────

export const CheckAvailabilitySchema = z.object({
  outlet_id: z.string().uuid().optional(),
  outletId: z.string().uuid().optional(),
  guest_count: z.coerce.number().int().min(1).max(100).optional(),
  guestCount: z.coerce.number().int().min(1).max(100).optional(),
  reserved_for: z.string().optional(),
  reservedFor: z.string().optional(),
  duration_minutes: z.coerce.number().int().min(15).max(360).optional(),
  durationMinutes: z.coerce.number().int().min(15).max(360).optional(),
}).strict().transform((d) => {
  const outlet_id = d.outlet_id ?? d.outletId;
  const guest_count = d.guest_count ?? d.guestCount;
  const reserved_for = d.reserved_for ?? d.reservedFor;
  const duration_minutes = d.duration_minutes ?? d.durationMinutes ?? 90;

  if (!outlet_id) throw new Error('outlet_id is required');
  if (!guest_count) throw new Error('guest_count is required');
  if (!reserved_for) throw new Error('reserved_for is required');

  return { outlet_id, guest_count, reserved_for, duration_minutes };
});

export class CheckAvailabilityDto extends createZodDto(CheckAvailabilitySchema) {}

// ─── Create Table Reservation ────────────────────────────────────────────────

export const CreateReservationSchema = z.object({
  outlet_id: z.string().uuid().optional(),
  outletId: z.string().uuid().optional(),
  guest_count: z.coerce.number().int().min(1).max(100).optional(),
  guestCount: z.coerce.number().int().min(1).max(100).optional(),
  reserved_for: z.string().optional(),
  reservedFor: z.string().optional(),
  duration_minutes: z.coerce.number().int().min(15).max(360).optional(),
  durationMinutes: z.coerce.number().int().min(15).max(360).optional(),
  table_ids: z.array(z.string().uuid()).optional(),
  customer_name: z.string().max(100).optional(),
  customer_phone: z.string().max(20).optional(),
}).strict().transform((d) => {
  const outlet_id = d.outlet_id ?? d.outletId;
  const guest_count = d.guest_count ?? d.guestCount;
  const reserved_for = d.reserved_for ?? d.reservedFor;
  const duration_minutes = d.duration_minutes ?? d.durationMinutes ?? 90;

  if (!outlet_id) throw new Error('outlet_id is required');
  if (!guest_count) throw new Error('guest_count is required');
  if (!reserved_for) throw new Error('reserved_for is required');

  return {
    outlet_id,
    guest_count,
    reserved_for,
    duration_minutes,
    table_ids: d.table_ids,
    customer_name: d.customer_name,
    customer_phone: d.customer_phone,
  };
});

export class CreateReservationDto extends createZodDto(CreateReservationSchema) {}

// ─── Snooze Serve-Later Prompt ───────────────────────────────────────────────

export const SnoozeServeLaterSchema = z.object({
  minutes: z.coerce.number().int().min(1).max(60).optional().default(10),
}).strict();

export class SnoozeServeLaterDto extends createZodDto(SnoozeServeLaterSchema) {}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const parsePlaceOrderDto = (input: unknown) => PlaceOrderSchema.parse(input);
