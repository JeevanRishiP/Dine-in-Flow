/**
 * Smart Kitchen Scheduler & Priority Engine (Pure Logic)
 *
 * Implements:
 * 1. Course Hold Assignment on payment confirmation
 * 2. Target Fire Time Calculation with staging buffer
 * 3. Deterministic Priority Sorting for KDS Item Queue
 * 4. Serve-Later Prompt Criteria Evaluation
 *
 * Reference: ARCH §7, AGENTS §4 (pure functions, side-effect-free, unit-tested)
 */

export type HoldStatus = 'ACTIVE' | 'SCHEDULED_WAIT' | 'SERVE_LATER_HOLD' | 'RELEASED';
export type OrderType = 'DINE_IN' | 'PRE_BOOK_DINE_IN' | 'TAKEAWAY';

export interface SchedulerItemInput {
  id: string;
  courseSequence: number; // 1=Starters, 2=Mains, 3=Desserts, 4=Beverages
  prepTimeMinutes: number;
  notes?: string | null;
  holdStatus?: HoldStatus;
  status?: string;
}

export interface SchedulerOrderInput {
  orderType: OrderType;
  scheduledFor?: Date | string | null;
  paidAt: Date | string;
  items: SchedulerItemInput[];
}

export interface ScheduledItemOutput {
  id: string;
  targetFireAt: Date;
  holdStatus: HoldStatus;
  targetServeAt: Date;
}

export interface KdsItemTicket {
  id?: string;
  itemId: string;
  orderId: string;
  displayId?: string;
  orderDisplayId: string;
  dinerId?: string | null;
  dinerLabel?: string | null;
  orderNumber?: number | null;
  orderType: string;
  tableNumber: string;
  scheduledFor: string | null;
  dishName: string;
  quantity: number;
  modifiers: unknown[];
  spiceLevel: number | null;
  notes: string | null;
  isComboItem: boolean;
  comboName: string | null;
  courseSequence: number;
  prepTimeMinutes: number;
  targetFireAt: string | null;
  holdStatus: HoldStatus;
  itemStatus: string;
  status?: string;
  paidAt: string | null;
  claimedByStaffId?: string | null;
  claimedAt?: string | null;
}

const STAGING_BUFFER_MINUTES = 2; // 2m plating/buffer before target serve
const SCHEDULED_WAIT_THRESHOLD_MINUTES = 5; // > 5m future target_fire_at means SCHEDULED_WAIT

/**
 * Pure calculation: computes target_fire_at, target_serve_at, and hold_status for order items.
 */
export function scheduleOrderItems(
  order: SchedulerOrderInput,
  referenceNow: Date | string = new Date(),
): ScheduledItemOutput[] {
  const nowMs = new Date(referenceNow).getTime();
  const paidAtMs = new Date(order.paidAt).getTime();
  const scheduledForMs = order.scheduledFor ? new Date(order.scheduledFor).getTime() : null;

  const isDineIn = order.orderType === 'DINE_IN' || order.orderType === 'PRE_BOOK_DINE_IN';

  // Check if order has Course 1 or 2 alongside Course 3 or 4
  const hasCourse1Or2 = order.items.some((i) => i.courseSequence === 1 || i.courseSequence === 2);
  const hasCourse3Or4 = order.items.some((i) => i.courseSequence === 3 || i.courseSequence === 4);
  const shouldHoldDesserts = isDineIn && hasCourse1Or2 && hasCourse3Or4;

  // Active items being prepped now (Course 1 & 2 for DINE_IN with desserts; all items for TAKEAWAY or dessert-only)
  const activeBatch = shouldHoldDesserts
    ? order.items.filter((i) => i.courseSequence === 1 || i.courseSequence === 2)
    : order.items;

  // Max prep time of the current active cooking batch
  const maxPrepMinutes = activeBatch.length > 0
    ? Math.max(...activeBatch.map((i) => i.prepTimeMinutes || 15))
    : 15;

  const results: ScheduledItemOutput[] = [];

  for (const item of order.items) {
    const isDessertOrDrink = item.courseSequence === 3 || item.courseSequence === 4;

    if (shouldHoldDesserts && isDessertOrDrink) {
      // DINE_IN: Hold Course 3 and 4 (Desserts/Beverages) for "Serve Later"
      const targetServeAtMs = scheduledForMs ?? (paidAtMs + (maxPrepMinutes + item.prepTimeMinutes) * 60_000);
      const targetFireAtMs = targetServeAtMs - (item.prepTimeMinutes * 60_000) - (STAGING_BUFFER_MINUTES * 60_000);

      results.push({
        id: item.id,
        targetFireAt: new Date(targetFireAtMs),
        holdStatus: 'SERVE_LATER_HOLD',
        targetServeAt: new Date(targetServeAtMs),
      });
      continue;
    }

    // For TAKEAWAY or immediate course items:
    const targetServeAtMs = scheduledForMs ?? (paidAtMs + maxPrepMinutes * 60_000);
    const targetFireAtMs = targetServeAtMs - (item.prepTimeMinutes * 60_000) - (STAGING_BUFFER_MINUTES * 60_000);

    const isFutureSchedule = targetFireAtMs > (nowMs + SCHEDULED_WAIT_THRESHOLD_MINUTES * 60_000);
    const holdStatus: HoldStatus = isFutureSchedule ? 'SCHEDULED_WAIT' : 'ACTIVE';

    results.push({
      id: item.id,
      targetFireAt: new Date(targetFireAtMs),
      holdStatus,
      targetServeAt: new Date(targetServeAtMs),
    });
  }

  return results;
}

/**
 * Deterministic sort comparator for Flattened KDS Priority Queue:
 * 1. targetFireAt ASC (items needed sooner fire first; nulls last)
 * 2. courseSequence ASC (Starters -> Mains -> Desserts -> Beverages)
 * 3. prepTimeMinutes DESC (Dishes taking longer to cook fire earlier)
 * 4. paidAt ASC (Earlier paid orders take priority)
 */
export function sortKdsItemTickets(tickets: KdsItemTicket[]): KdsItemTicket[] {
  return [...tickets].sort((a, b) => {
    // 1. targetFireAt ASC
    const aFire = a.targetFireAt ? new Date(a.targetFireAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bFire = b.targetFireAt ? new Date(b.targetFireAt).getTime() : Number.MAX_SAFE_INTEGER;
    if (aFire !== bFire) {
      return aFire - bFire;
    }

    // 2. courseSequence ASC
    if (a.courseSequence !== b.courseSequence) {
      return a.courseSequence - b.courseSequence;
    }

    // 3. prepTimeMinutes DESC
    if (a.prepTimeMinutes !== b.prepTimeMinutes) {
      return b.prepTimeMinutes - a.prepTimeMinutes;
    }

    // 4. paidAt ASC
    const aPaid = a.paidAt ? new Date(a.paidAt).getTime() : 0;
    const bPaid = b.paidAt ? new Date(b.paidAt).getTime() : 0;
    return aPaid - bPaid;
  });
}

/**
 * Checks whether an order qualifies for a "Serve Later" auto-prompt:
 * - All Course 1 and 2 items are SERVED
 * - Main course was served at least `delayMinutes` (default 15) ago
 * - Has unreleased Course 3/4 items in SERVE_LATER_HOLD
 * - Prompt has not yet been sent
 */
export function shouldSendServeLaterPrompt(params: {
  mainCourseServedAt: Date | string | null;
  serveLaterPromptSentAt: Date | string | null;
  items: Array<{ courseSequence: number; holdStatus: HoldStatus; status: string }>;
  delayMinutes?: number;
  referenceNow?: Date | string;
}): boolean {
  if (params.serveLaterPromptSentAt) {
    return false; // Already sent
  }

  if (!params.mainCourseServedAt) {
    return false;
  }

  const delayMs = (params.delayMinutes ?? 15) * 60_000;
  const nowMs = params.referenceNow ? new Date(params.referenceNow).getTime() : Date.now();
  const servedAtMs = new Date(params.mainCourseServedAt).getTime();

  if (nowMs - servedAtMs < delayMs) {
    return false; // Not enough time has passed
  }

  // Must have unreleased items in SERVE_LATER_HOLD
  const hasUnreleasedHold = params.items.some(
    (i) => i.holdStatus === 'SERVE_LATER_HOLD' && i.status !== 'CANCELLED' && i.status !== 'SERVED',
  );

  return hasUnreleasedHold;
}
