import type { Order, KdsItemTicket } from '../../../app/lib/restaurant-db';

/**
 * Checks if a dish is a post-meal sweet, dessert, or requires customer release signal.
 */
export function isDessertOrPostMealDish(name?: string, notes?: string | null): boolean {
  const str = `${name || ''} ${notes || ''}`.toLowerCase();
  return (
    str.includes('ice cream') ||
    str.includes('kulfi') ||
    str.includes('gulab jamun') ||
    str.includes('halwa') ||
    str.includes('rasmalai') ||
    str.includes('dessert') ||
    str.includes('sweet') ||
    str.includes('serve later') ||
    str.includes('[serve_later]')
  );
}

/**
 * Maps Course Sequence integer to readable label
 * 1 = Starter / Soup
 * 2 = Main Course / Biryani / Breads
 * 3 = Dessert
 * 4 = Beverage
 */
export function getCourseSequenceLabel(seq?: number): string {
  switch (seq) {
    case 1:
      return 'Starter (C1)';
    case 2:
      return 'Main Course (C2)';
    case 3:
      return 'Dessert (C3)';
    case 4:
      return 'Beverage (C4)';
    default:
      return 'Course 2';
  }
}

/**
 * Course sequence styling configuration
 */
export function getCourseSequenceBadge(seq?: number): {
  label: string;
  emoji: string;
  bg: string;
  border: string;
  color: string;
} {
  switch (seq) {
    case 1:
      return {
        label: 'Starter (C1)',
        emoji: '🥗',
        bg: 'rgba(16, 185, 129, 0.15)',
        border: 'rgba(16, 185, 129, 0.4)',
        color: '#10b981',
      };
    case 2:
      return {
        label: 'Main (C2)',
        emoji: '🍛',
        bg: 'rgba(245, 158, 11, 0.15)',
        border: 'rgba(245, 158, 11, 0.4)',
        color: '#f59e0b',
      };
    case 3:
      return {
        label: 'Dessert (C3)',
        emoji: '🍨',
        bg: 'rgba(192, 132, 252, 0.15)',
        border: 'rgba(192, 132, 252, 0.4)',
        color: '#c084fc',
      };
    case 4:
      return {
        label: 'Beverage (C4)',
        emoji: '☕',
        bg: 'rgba(56, 189, 248, 0.15)',
        border: 'rgba(56, 189, 248, 0.4)',
        color: '#38bdf8',
      };
    default:
      return {
        label: 'Main (C2)',
        emoji: '🍛',
        bg: 'rgba(245, 158, 11, 0.15)',
        border: 'rgba(245, 158, 11, 0.4)',
        color: '#f59e0b',
      };
  }
}

export interface FireUrgencyInfo {
  label: string;
  isFireNow: boolean;
  isOverdue: boolean;
  minutesUntil: number;
  bg: string;
  border: string;
  color: string;
  pulse: boolean;
}

/**
 * Computes kitchen fire urgency and countdown relative to target_fire_at and hold_status
 */
export function getFireUrgency(
  targetFireAt: string | null | undefined,
  holdStatus?: string,
  nowMs = Date.now(),
): FireUrgencyInfo {
  if (holdStatus === 'SERVE_LATER_HOLD') {
    return {
      label: '⏳ ON HOLD (Serve Later)',
      isFireNow: false,
      isOverdue: false,
      minutesUntil: 999,
      bg: 'rgba(168, 85, 247, 0.15)',
      border: 'rgba(168, 85, 247, 0.4)',
      color: '#c084fc',
      pulse: false,
    };
  }

  if (!targetFireAt) {
    return {
      label: '🔥 FIRE NOW',
      isFireNow: true,
      isOverdue: false,
      minutesUntil: 0,
      bg: 'rgba(239, 68, 68, 0.2)',
      border: 'rgba(239, 68, 68, 0.5)',
      color: '#f87171',
      pulse: true,
    };
  }

  const fireMs = new Date(targetFireAt).getTime();
  const diffMs = fireMs - nowMs;
  const diffMin = Math.round(diffMs / 60_000);

  if (diffMs <= 0) {
    const overdueMin = Math.abs(diffMin);
    return {
      label: overdueMin > 0 ? `🔥 OVERDUE +${overdueMin}m` : '🔥 FIRE NOW!',
      isFireNow: true,
      isOverdue: overdueMin > 0,
      minutesUntil: diffMin,
      bg: 'rgba(239, 68, 68, 0.25)',
      border: 'rgba(239, 68, 68, 0.6)',
      color: '#ef4444',
      pulse: true,
    };
  }

  if (diffMin <= 5) {
    return {
      label: `⚡ Fire in ${diffMin}m`,
      isFireNow: false,
      isOverdue: false,
      minutesUntil: diffMin,
      bg: 'rgba(245, 158, 11, 0.2)',
      border: 'rgba(245, 158, 11, 0.5)',
      color: '#fbbf24',
      pulse: false,
    };
  }

  return {
    label: `⏱️ Scheduled in ${diffMin}m`,
    isFireNow: false,
    isOverdue: false,
    minutesUntil: diffMin,
    bg: 'rgba(148, 163, 184, 0.15)',
    border: 'rgba(148, 163, 184, 0.3)',
    color: '#94a3b8',
    pulse: false,
  };
}

/**
 * Filter flattened KDS tickets by course
 */
export function filterKdsItemsByCourse(
  items: KdsItemTicket[],
  course: 'ALL' | 1 | 2 | 3 | 4,
): KdsItemTicket[] {
  if (course === 'ALL') return items;
  return items.filter((it) => it.courseSequence === course);
}

/**
 * Filter flattened KDS tickets by operational status
 */
export function filterKdsItemsByStatus(
  items: KdsItemTicket[],
  status: 'ALL' | 'ACTIVE' | 'PREPARING' | 'READY' | 'HOLD',
): KdsItemTicket[] {
  if (status === 'ALL') return items;
  if (status === 'HOLD') {
    return items.filter((it) => it.holdStatus === 'SERVE_LATER_HOLD' || it.holdStatus === 'SCHEDULED_WAIT');
  }
  if (status === 'ACTIVE') {
    return items.filter(
      (it) =>
        (it.holdStatus === 'ACTIVE' || it.holdStatus === 'RELEASED') &&
        it.itemStatus !== 'READY' &&
        it.itemStatus !== 'SERVED',
    );
  }
  if (status === 'PREPARING') {
    return items.filter((it) => it.itemStatus === 'PREPARING');
  }
  if (status === 'READY') {
    return items.filter((it) => it.itemStatus === 'READY');
  }
  return items;
}

/**
 * Filters orders for Column 1: NEW / CONFIRMED
 */
export function filterConfirmedOrders(orders: Order[]): Order[] {
  return orders.filter(
    (o) => o.status === 'CONFIRMED' || o.status === 'PENDING_APPROVAL',
  );
}

/**
 * Filters orders for Column 2: PREPARING IN KITCHEN
 */
export function filterPreparingOrders(orders: Order[]): Order[] {
  return orders.filter((o) =>
    o.items.some(
      (it) =>
        !it.status ||
        it.status === 'PREPARING' ||
        it.status === 'PENDING' ||
        it.status === 'CONFIRMED',
    ),
  );
}

/**
 * Filters orders for Column 3: READY ON PASS
 */
export function filterReadyOrders(orders: Order[]): Order[] {
  return orders.filter(
    (o) => o.items.some((it) => it.status === 'READY') || o.status === 'READY',
  );
}

export interface BatchCookDishSummary {
  dishName: string;
  totalQty: number;
}

/**
 * Deterministically sorts KDS items:
 * 1. targetFireAt ASC (nulls sort last)
 * 2. courseSequence ASC
 * 3. prepTimeMinutes DESC
 * 4. paidAt ASC
 */
export function sortKdsItems(tickets: KdsItemTicket[]): KdsItemTicket[] {
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
 * Groups identical active dishes across tickets for the batch summary strip
 */
export function buildBatchSummary(items: KdsItemTicket[]): BatchCookDishSummary[] {
  const map = new Map<string, number>();
  for (const item of items) {
    if (
      item.itemStatus === 'READY' ||
      item.itemStatus === 'SERVED' ||
      item.itemStatus === 'CANCELLED' ||
      item.holdStatus === 'SERVE_LATER_HOLD'
    ) {
      continue;
    }
    const name = item.dishName;
    const current = map.get(name) || 0;
    map.set(name, current + (item.quantity || 1));
  }

  const result: BatchCookDishSummary[] = [];
  for (const [dishName, totalQty] of map.entries()) {
    result.push({ dishName, totalQty });
  }

  return result.sort((a, b) => b.totalQty - a.totalQty || a.dishName.localeCompare(b.dishName));
}

/**
 * Formats origin badges (Dine-in Table, Pre-book Table with time, Takeaway with time)
 */
export function formatOriginBadge(ticket: KdsItemTicket): {
  text: string;
  bg: string;
  color: string;
  border: string;
} {
  if (ticket.orderType === 'PRE_BOOK_DINE_IN') {
    const timeStr = ticket.scheduledFor
      ? new Date(ticket.scheduledFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
    return {
      text: `📅 PRE-BOOK ${ticket.tableNumber || 'Table'} ${timeStr ? `· ${timeStr}` : ''}`.trim(),
      bg: 'rgba(59, 130, 246, 0.15)',
      color: '#60a5fa',
      border: 'rgba(59, 130, 246, 0.35)',
    };
  }
  if (ticket.orderType === 'TAKEAWAY') {
    const timeStr = ticket.scheduledFor
      ? new Date(ticket.scheduledFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
    return {
      text: `🛍️ TAKEAWAY ${timeStr ? `· ${timeStr}` : ''}`.trim(),
      bg: 'rgba(234, 88, 12, 0.15)',
      color: '#fb923c',
      border: 'rgba(234, 88, 12, 0.35)',
    };
  }
  return {
    text: `🪑 Table ${ticket.tableNumber || '--'}`,
    bg: 'rgba(255, 255, 255, 0.08)',
    color: '#f3f4f6',
    border: 'rgba(255, 255, 255, 0.15)',
  };
}

/**
 * Counts total plated dishes ready on pass across all orders
 */
export function countReadyItems(orders: Order[]): number {
  return orders.reduce(
    (sum, o) => sum + o.items.filter((it) => it.status === 'READY').length,
    0,
  );
}
