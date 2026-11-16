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
    const isPaid =
      ord.payment_status === 'PAID' ||
      ord.status === 'CONFIRMED' ||
      ord.status === 'PREPARING' ||
      ord.status === 'READY' ||
      ord.status === 'SERVED' ||
      ord.status === 'BILLED';

    // Strict rule: Only paid orders are visible in this section.
    if (!isPaid) return;

    const orderNumber = ord.id.slice(0, 6).toUpperCase();

    ord.items.forEach((it) => {
      const qty = Math.max(1, it.quantity || 1);
      const parsed = parseOrderItemNotes(it.notes, it.name_snapshot);
      const itemModifiers = Array.isArray(it.modifiers) ? it.modifiers : [];
      const modsTotalPaise = itemModifiers.reduce(
        (sum, m) => sum + (Number(m.price_paise) || 0),
        0
      );
      const isPostMeal = isDessertOrPostMealItem(it.name_snapshot, it.notes);

      // Calculate minor unit base price per plate (paise)
      const basePricePaise =
        it.unit_price_paise || (it.line_total_paise ? Math.round(it.line_total_paise / qty) : 0);
      const plateTotalPaise = basePricePaise + modsTotalPaise;

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
          Boolean(it.notes && it.notes.includes('[RELEASED_TO_KITCHEN]'));
        const plateItemStatus = it.status || ord.status;
        const isPlateServed =
          plateItemStatus === 'SERVED' || ord.status === 'SERVED' || ord.status === 'BILLED';
        const isPlateCancelled = plateItemStatus === 'CANCELLED' || ord.status === 'CANCELLED';
        const isOnHold =
          isPaid &&
          isPostMeal &&
          !isReleased &&
          !isPlateServed &&
          !isPlateCancelled &&
          (plateItemStatus === 'PENDING' ||
            plateItemStatus === 'CONFIRMED' ||
            ord.status === 'CONFIRMED' ||
            ord.status === 'PREPARING');

        list.push({
          plateKey,
          orderId: ord.id,
          orderNumber,
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
          itemStatus: plateItemStatus,
        });
      }
    });
  });

  return list;
}

export type OrdersFilterTab = 'PREPARING' | 'ON_HOLD' | 'SERVED' | 'CANCELLED';

/**
 * Filters plates by active tab.
 */
export function filterPlatesByTab(
  plates: FlattenedPlateItem[],
  tab: OrdersFilterTab
): FlattenedPlateItem[] {
  switch (tab) {
    case 'ON_HOLD':
      return plates.filter((p) => p.isOnHold);
    case 'PREPARING':
      return plates.filter(
        (p) =>
          !p.isOnHold &&
          (p.orderStatus === 'PREPARING' ||
            p.orderStatus === 'CONFIRMED' ||
            p.orderStatus === 'READY' ||
            p.orderStatus === 'PENDING')
      );
    case 'SERVED':
      return plates.filter((p) => p.orderStatus === 'SERVED' || p.orderStatus === 'BILLED');
    case 'CANCELLED':
      return plates.filter((p) => p.orderStatus === 'CANCELLED');
    default:
      return plates;
  }
}
