import type { TableOrderRecord, FlattenedPlateItem } from '../../types';

// ============================================================================
// Pure Utility Functions for Orders & Plates Tracking
// ============================================================================

/**
 * Formats ISO timestamp into user-friendly localized dining time.
 */
export function formatOrderDateTime(iso?: string | null): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Detects whether an item is a dessert, hot/cold beverage, or post-meal delicacy
 * that defaults to "Serve Later" (ON_HOLD) until the customer signals the kitchen.
 */
export function isDessertOrPostMealItem(name?: string, notes?: string | null): boolean {
  const str = `${name || ''} ${notes || ''}`.toLowerCase();
  return (
    str.includes('ice cream') ||
    str.includes('kulfi') ||
    str.includes('gulab jamun') ||
    str.includes('halwa') ||
    str.includes('dessert') ||
    str.includes('sweet') ||
    str.includes('rasgulla') ||
    str.includes('filter coffee') ||
    str.includes('masala chai') ||
    str.includes('coffee') ||
    str.includes('tea') ||
    str.includes('warm gulab jamun')
  );
}

export interface ParsedOrderItemNotes {
  plateName: string | null;
  portion: 'FULL' | 'HALF';
  spiceLevel: string | null;
  kitchenNote: string | null;
}

/**
 * Parses item notes string for portion brackets, custom plate names, spice level,
 * and clean kitchen cooking instructions.
 */
export function parseOrderItemNotes(notes?: string, itemName?: string): ParsedOrderItemNotes {
  let plateName: string | null = null;
  let portion: 'FULL' | 'HALF' = 'FULL';
  let spiceLevel: string | null = null;
  let kitchenNote: string | null = null;

  const raw = (notes || '').trim();

  // Detect portion
  if (
    /\[HALF\s*PLATE\]/i.test(raw) ||
    /\[HALF\]/i.test(raw) ||
    /\(Half\)/i.test(raw) ||
    (itemName && /\(Half\)/i.test(itemName))
  ) {
    portion = 'HALF';
  }

  // Detect custom plate name in brackets, e.g. [Rahul's Plate] or [Priya] or [Plate 1]
  const bracketMatches = Array.from(raw.matchAll(/\[([^\]]+)\]/g));
  for (const m of bracketMatches) {
    const rawContent = m[1];
    if (!rawContent) continue;
    const content = rawContent.trim();
    if (!/^(HALF\s*PLATE|HALF|FULL|FULL\s*PLATE|RELEASED_TO_KITCHEN)$/i.test(content)) {
      plateName = content;
      break;
    }
  }

  // Detect spice level
  const spiceMatch = raw.match(/Spice:\s*([A-Za-z]+)/i);
  if (spiceMatch && spiceMatch[1]) {
    spiceLevel = spiceMatch[1].toUpperCase();
  }

  // Clean note to the kitchen (taste preferences, cooking instructions)
  let cleaned = raw
    .replace(/\[[^\]]+\]/g, '')
    .replace(/Spice:\s*[A-Za-z]+/gi, '')
    .replace(/Add-ons:\s*[^·]+/gi, '')
    .replace(/[·]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.replace(/^[,.\s]+|[,.\s]+$/g, '');

  if (cleaned.length > 0) {
    kitchenNote = cleaned;
  }

  return { plateName, portion, spiceLevel, kitchenNote };
}

/**
 * Returns human-readable label for course sequence numbers (ARCH Smart Kitchen).
 */
export function getCourseSequenceLabel(seq?: number): string {
  switch (seq) {
    case 1:
      return 'Starters & Appetizers';
    case 2:
      return 'Main Course';
    case 3:
      return 'Desserts';
    case 4:
      return 'Beverages';
    default:
      return 'Main Course';
  }
}

/**
 * Returns UI badge metadata (emoji, code, colors) for course sequence numbers.
 */
export function getCourseBadge(seq?: number): {
  emoji: string;
  label: string;
  code: string;
  bg: string;
  color: string;
  border: string;
} {
  switch (seq) {
    case 1:
      return {
        emoji: '🥗',
        label: 'Starter',
        code: 'C1',
        bg: 'rgba(34, 197, 94, 0.15)',
        color: '#4ade80',
        border: 'rgba(34, 197, 94, 0.3)',
      };
    case 2:
      return {
        emoji: '🍛',
        label: 'Main Course',
        code: 'C2',
        bg: 'rgba(245, 158, 11, 0.15)',
        color: '#fbbf24',
        border: 'rgba(245, 158, 11, 0.3)',
      };
    case 3:
      return {
        emoji: '🍨',
        label: 'Dessert',
        code: 'C3',
        bg: 'rgba(168, 85, 247, 0.15)',
        color: '#c084fc',
        border: 'rgba(168, 85, 247, 0.3)',
      };
    case 4:
      return {
        emoji: '☕',
        label: 'Beverage',
        code: 'C4',
        bg: 'rgba(59, 130, 246, 0.15)',
        color: '#60a5fa',
        border: 'rgba(59, 130, 246, 0.3)',
      };
    default:
      return {
        emoji: '🍛',
        label: 'Main Course',
        code: 'C2',
        bg: 'rgba(245, 158, 11, 0.15)',
        color: '#fbbf24',
        border: 'rgba(245, 158, 11, 0.3)',
      };
  }
}

/**
 * Flattens multi-quantity session orders into individual granular plates with
 * per-plate modifiers, minor-unit (paise) pricing, and on-hold states.
 * Rule: Only PAID / Confirmed orders are tracked.
 */
export function flattenPlates(
  sessionOrders: TableOrderRecord[],
  selectedTable: string = '--',
  releasedHoldPlateKeys: Record<string, boolean> = {}
): FlattenedPlateItem[] {
  const list: FlattenedPlateItem[] = [];

  sessionOrders.forEach((ord) => {
    // Strict rule (Zero-Leak Payment Gate): Only orders with payment_status === 'PAID' or approved cash are tracked
    const isPaid = ord.payment_status === 'PAID' || ord.payment_method === 'CASH_APPROVED';

    // Strict rule: Only paid orders are visible in this section.
    if (!isPaid) return;

    const canonicalDisplayId =
      ord.displayId ||
      ord.display_id ||
      (ord.id ? `ORD-${ord.id.slice(0, 4).toUpperCase()}` : 'ORD-0001');
    const orderNumber = ord.id.slice(0, 6).toUpperCase();

    (ord.items || []).forEach((it) => {
      const qty = Math.max(1, it.quantity || 1);
      const parsed = parseOrderItemNotes(it.notes, it.name_snapshot);
      const itemModifiers = Array.isArray(it.modifiers) ? it.modifiers : [];
      const modsTotalPaise = itemModifiers.reduce(
        (sum, m) => sum + (Number(m.price_paise) || 0),
        0
      );
      const isPostMeal = isDessertOrPostMealItem(it.name_snapshot, it.notes);

      // Course sequence & prep times
      const courseSequence =
        typeof it.course_sequence === 'number'
          ? it.course_sequence
          : isPostMeal
          ? 3
          : 2;
      const prepTimeMinutes = it.prep_time_minutes ?? 15;
      const targetFireAt = it.target_fire_at || null;
      const rawHoldStatus = it.hold_status;

      // Calculate minor unit base price per plate (paise)
      const basePricePaise =
        it.unit_price_paise || (it.line_total_paise ? Math.round(it.line_total_paise / qty) : 0);
      const plateTotalPaise = basePricePaise + modsTotalPaise;

      const dinerId = it.dinerId ?? it.diner_id ?? ord.dinerId ?? ord.diner_id ?? null;
      const dinerLabel = it.dinerLabel ?? it.diner_label ?? ord.dinerLabel ?? ord.diner_label ?? null;

      for (let pIdx = 1; pIdx <= qty; pIdx++) {
        let resolvedPlateName: string;
        if (parsed.plateName) {
          resolvedPlateName =
            qty > 1 && !parsed.plateName.includes(`${pIdx}`)
              ? `${parsed.plateName} (Plate ${pIdx})`
              : parsed.plateName;
        } else {
          resolvedPlateName = `Plate ${pIdx}`;
        }

        const plateKey = `${ord.id}-${it.id}-${pIdx}`;
        const isReleased =
          Boolean(releasedHoldPlateKeys[plateKey]) ||
          Boolean(it.notes && it.notes.includes('[RELEASED_TO_KITCHEN]')) ||
          rawHoldStatus === 'RELEASED';

        // Categorize strictly by individual item status
        const individualItemStatus =
          it.status || (ord.status === 'CANCELLED' ? 'CANCELLED' : ord.status === 'SERVED' ? 'SERVED' : 'CONFIRMED');

        const isPlateServed = individualItemStatus === 'SERVED';
        const isPlateCancelled = individualItemStatus === 'CANCELLED';

        const isScheduledWait = rawHoldStatus === 'SCHEDULED_WAIT';
        const isOnHold =
          !isPlateServed &&
          !isPlateCancelled &&
          !isReleased &&
          (rawHoldStatus === 'SERVE_LATER_HOLD' ||
            (!rawHoldStatus && isPostMeal));

        const resolvedHoldStatus: 'ACTIVE' | 'SCHEDULED_WAIT' | 'SERVE_LATER_HOLD' | 'RELEASED' =
          isReleased
            ? 'RELEASED'
            : isOnHold
            ? 'SERVE_LATER_HOLD'
            : isScheduledWait
            ? 'SCHEDULED_WAIT'
            : (rawHoldStatus || 'ACTIVE');

        list.push({
          plateKey,
          orderId: ord.id,
          orderNumber,
          displayId: canonicalDisplayId,
          dinerId,
          dinerLabel,
          tableId: it.target_table_id || null,
          tableNumber: it.target_table_number || ord.table_number || selectedTable || '--',
          orderCreatedAt: ord.created_at,
          itemCreatedAt: it.created_at || ord.created_at,
          orderStatus: isPlateServed ? 'SERVED' : isPlateCancelled ? 'CANCELLED' : ord.status,
          isPaid,
          paymentMethod: ord.payment_method || (isPaid ? 'UPI' : null),
          paymentSettledAt: ord.payment_settled_at || (isPaid ? ord.created_at : null),
          itemId: it.id,
          itemName: it.name_snapshot,
          plateName: resolvedPlateName,
          portion: parsed.portion,
          plateIndex: pIdx,
          totalPlatesForLine: qty,
          basePricePaise,
          modifiers: itemModifiers,
          modifiersTotalPaise: modsTotalPaise,
          plateTotalPaise,
          spiceLevel: parsed.spiceLevel,
          kitchenNote: parsed.kitchenNote,
          rawNotes: it.notes,
          isOnHold,
          itemStatus: individualItemStatus,
          courseSequence,
          prepTimeMinutes,
          targetFireAt,
          holdStatus: resolvedHoldStatus,
          isScheduledWait,
          isComboItem: Boolean(it.is_combo_item),
          comboName: it.combo_name || null,
          orderType: ord.order_type || 'DINE_IN',
          scheduledFor: ord.scheduled_for || null,
        });
      }
    });
  });

  return list;
}

export type OrdersFilterTab = 'PREPARING' | 'ON_HOLD' | 'SERVED' | 'CANCELLED';

/**
 * Filters plates by active tab.
 * Invariant:
 * - SERVED: appears ONLY in Served (never in Preparing or Queued)
 * - CANCELLED: appears ONLY in Cancelled
 * - ON_HOLD: appears ONLY in Serve Later (On Hold)
 * - PREPARING: active cooking, ready on pass, or queued (waiting for chef), NEVER served or held items.
 */
export function filterPlatesByTab(
  plates: FlattenedPlateItem[],
  tab: OrdersFilterTab
): FlattenedPlateItem[] {
  switch (tab) {
    case 'SERVED':
      return plates.filter((p) => p.itemStatus === 'SERVED');
    case 'CANCELLED':
      return plates.filter((p) => p.itemStatus === 'CANCELLED');
    case 'ON_HOLD':
      return plates.filter(
        (p) =>
          p.itemStatus !== 'SERVED' &&
          p.itemStatus !== 'CANCELLED' &&
          p.holdStatus === 'SERVE_LATER_HOLD'
      );
    case 'PREPARING':
      return plates.filter(
        (p) =>
          p.itemStatus !== 'SERVED' &&
          p.itemStatus !== 'CANCELLED' &&
          p.holdStatus !== 'SERVE_LATER_HOLD' &&
          (p.itemStatus === 'PREPARING' ||
            p.itemStatus === 'READY' ||
            p.itemStatus === 'CONFIRMED' ||
            p.itemStatus === 'PENDING')
      );
    default:
      return plates;
  }
}

export interface DishStatusBadge {
  label: string;
  bg: string;
  color: string;
  border: string;
  code: 'SERVED' | 'READY' | 'COOKING' | 'QUEUED' | 'SCHEDULED' | 'ON_HOLD' | 'CANCELLED';
}

/**
 * Derives accurate dish status pill styling and text for individual plates.
 * Never labels PENDING/CONFIRMED dishes as "Cooking".
 */
export function getDishStatusBadge(
  itemStatus?: string,
  holdStatus?: string
): DishStatusBadge {
  if (itemStatus === 'CANCELLED') {
    return {
      label: 'CANCELLED ✕',
      bg: 'rgba(239, 68, 68, 0.15)',
      color: '#f87171',
      border: 'rgba(239, 68, 68, 0.3)',
      code: 'CANCELLED',
    };
  }
  if (itemStatus === 'SERVED') {
    return {
      label: '✓ Served',
      bg: 'rgba(16, 185, 129, 0.15)',
      color: '#10b981',
      border: 'rgba(16, 185, 129, 0.3)',
      code: 'SERVED',
    };
  }
  if (itemStatus === 'READY') {
    return {
      label: '🍽️ Ready on Pass',
      bg: 'rgba(16, 185, 129, 0.2)',
      color: '#34d399',
      border: 'rgba(16, 185, 129, 0.4)',
      code: 'READY',
    };
  }
  if (itemStatus === 'PREPARING') {
    return {
      label: '🔥 Cooking',
      bg: 'rgba(245, 158, 11, 0.2)',
      color: '#fbbf24',
      border: 'rgba(245, 158, 11, 0.4)',
      code: 'COOKING',
    };
  }
  if (holdStatus === 'SERVE_LATER_HOLD') {
    return {
      label: '⏳ On Hold (Serve Later)',
      bg: 'rgba(168, 85, 247, 0.18)',
      color: '#c084fc',
      border: 'rgba(168, 85, 247, 0.35)',
      code: 'ON_HOLD',
    };
  }
  if (holdStatus === 'SCHEDULED_WAIT') {
    return {
      label: '⏰ Scheduled',
      bg: 'rgba(56, 189, 248, 0.18)',
      color: '#38bdf8',
      border: 'rgba(56, 189, 248, 0.35)',
      code: 'SCHEDULED',
    };
  }
  return {
    label: '📋 Queued (Waiting for Chef)',
    bg: 'rgba(255, 255, 255, 0.08)',
    color: '#94a3b8',
    border: 'rgba(255, 255, 255, 0.15)',
    code: 'QUEUED',
  };
}

/**
 * Strict deduplication of orders and their order items by immutable DB ids.
 * Prevents phantom duplication during polling or optimistic state merges.
 */
export function deduplicateOrders(orders: TableOrderRecord[]): TableOrderRecord[] {
  const orderMap = new Map<string, TableOrderRecord>();
  for (const order of orders) {
    if (!order || !order.id) continue;
    const existing = orderMap.get(order.id);
    if (!existing) {
      const itemMap = new Map<string, (typeof order.items)[0]>();
      for (const item of order.items || []) {
        if (!item || !item.id) continue;
        if (!itemMap.has(item.id)) {
          itemMap.set(item.id, item);
        }
      }
      orderMap.set(order.id, {
        ...order,
        items: Array.from(itemMap.values()),
      });
    } else {
      const itemMap = new Map<string, (typeof order.items)[0]>();
      for (const item of existing.items || []) {
        if (item?.id) itemMap.set(item.id, item);
      }
      for (const item of order.items || []) {
        if (item?.id && !itemMap.has(item.id)) {
          itemMap.set(item.id, item);
        }
      }
      orderMap.set(order.id, {
        ...existing,
        ...order,
        items: Array.from(itemMap.values()),
      });
    }
  }
  return Array.from(orderMap.values());
}
