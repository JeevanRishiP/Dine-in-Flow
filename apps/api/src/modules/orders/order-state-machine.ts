/**
 * Order State Machine — pure, side-effect-free.
 *
 * This file MUST remain a pure module with no imports from NestJS, DB, or HTTP.
 * All business logic for status transitions lives here and is covered by tests.
 *
 * Reference: ARCH §7, AGENTS §4 "state machine must be pure and heavily tested"
 */

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'BILLED'
  | 'CANCELLED';

export type ItemStatus =
  | 'PENDING'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';

/**
 * Valid order-level transitions.
 * Keys are current states; values are allowed next states.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING:   ['CONFIRMED', 'PREPARING', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY'],
  READY:     ['SERVED'],
  SERVED:    ['BILLED'],
  BILLED:    [],
  CANCELLED: [],
} as const;

/**
 * Valid item-level transitions (KDS).
 */
export const ITEM_TRANSITIONS: Readonly<Record<ItemStatus, readonly ItemStatus[]>> = {
  PENDING:   ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY:     ['SERVED'],
  SERVED:    [],
  CANCELLED: [],
} as const;

export type TransitionResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Check if a transition from `from` to `to` is legal.
 * Returns a result object — never throws (pure function).
 */
export function canTransitionOrder(from: OrderStatus, to: OrderStatus): TransitionResult {
  const allowed = ORDER_TRANSITIONS[from];
  if ((allowed as readonly string[]).includes(to)) return { ok: true };
  return {
    ok: false,
    reason: `Cannot transition order from '${from}' to '${to}'. Allowed: [${allowed.join(', ')}]`,
  };
}

export function canTransitionItem(from: ItemStatus, to: ItemStatus): TransitionResult {
  const allowed = ITEM_TRANSITIONS[from];
  if ((allowed as readonly string[]).includes(to)) return { ok: true };
  return {
    ok: false,
    reason: `Cannot transition item from '${from}' to '${to}'. Allowed: [${allowed.join(', ')}]`,
  };
}

/** Terminal states — order cannot be further modified */
export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return status === 'BILLED' || status === 'CANCELLED';
}

/** Terminal states for items */
export function isTerminalItemStatus(status: ItemStatus): boolean {
  return status === 'SERVED' || status === 'CANCELLED';
}

/**
 * Derive order-level status from item statuses.
 * Used after KDS item updates to auto-advance the parent order.
 *
 * Rules (ARCH §7):
 *  - Any item CANCELLED → others still determine state
 *  - All non-cancelled items READY → order = READY
 *  - Any non-cancelled item PREPARING → order = PREPARING
 *  - All non-cancelled items SERVED → order = SERVED
 */
export function deriveOrderStatus(itemStatuses: ItemStatus[]): OrderStatus | null {
  const active = itemStatuses.filter((s) => s !== 'CANCELLED');
  if (active.length === 0) return 'CANCELLED';

  if (active.every((s) => s === 'SERVED'))  return 'SERVED';
  if (active.every((s) => s === 'READY' || s === 'SERVED')) return 'READY';
  if (active.some((s) => s === 'PREPARING')) return 'PREPARING';
  return null; // no auto-transition needed
}
