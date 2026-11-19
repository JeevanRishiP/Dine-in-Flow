import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOrderDateTime,
  isDessertOrPostMealItem,
  parseOrderItemNotes,
  flattenPlates,
  filterPlatesByTab,
  getCourseBadge,
  getCourseSequenceLabel,
  getDishStatusBadge,
  deduplicateOrders,
} from './orders-utils.ts';
import type { TableOrderRecord } from '../../types/index.ts';

describe('OrdersHistoryView pure domain & formatting logic', () => {
  test('formats ISO order date times cleanly or returns fallback gracefully', () => {
    assert.equal(formatOrderDateTime(''), '');
    assert.equal(formatOrderDateTime(null), '');
    assert.equal(formatOrderDateTime('invalid-date'), 'invalid-date');

    const iso = '2026-11-16T12:30:00.000Z';
    const formatted = formatOrderDateTime(iso);
    assert.ok(formatted.length > 5, 'Should format date with day and month');
  });

  test('identifies dessert, beverage and post-meal items accurately for Serve Later (ON_HOLD)', () => {
    assert.equal(isDessertOrPostMealItem('Gulab Jamun Handi'), true);
    assert.equal(isDessertOrPostMealItem('Royal Malai Kulfi'), true);
    assert.equal(isDessertOrPostMealItem('South Indian Filter Coffee'), true);
    assert.equal(isDessertOrPostMealItem('Masala Chai'), true);
    assert.equal(isDessertOrPostMealItem('Chicken Dum Biryani', 'Please serve ice cream afterwards'), true);

    assert.equal(isDessertOrPostMealItem('Paneer Butter Masala'), false);
    assert.equal(isDessertOrPostMealItem('Butter Naan'), false);
    assert.equal(isDessertOrPostMealItem('Mutton Galouti Kebab'), false);
  });

  test('parses order item notes for custom plate name, portion, spice, and clean kitchen note', () => {
    const rawNotes = "[Rahul's Plate] [HALF PLATE] Spice: Hot · Extra spicy and crispy with no onion";
    const parsed = parseOrderItemNotes(rawNotes, 'Chicken Dum Biryani');

    assert.equal(parsed.plateName, "Rahul's Plate");
    assert.equal(parsed.portion, 'HALF');
    assert.equal(parsed.spiceLevel, 'HOT');
    assert.ok(parsed.kitchenNote?.includes('Extra spicy and crispy with no onion'));
    assert.ok(!parsed.kitchenNote?.includes('Spice:'));
    assert.ok(!parsed.kitchenNote?.includes('[HALF PLATE]'));
  });

  test('flattens paid session orders into individual plates with integer minor units (paise)', () => {
    const sampleOrders: TableOrderRecord[] = [
      {
        id: 'ord-12345678-aaaa-bbbb-cccc-dddddddddddd',
        table_number: '12',
        status: 'PREPARING',
        payment_status: 'PAID',
        payment_method: 'PHONEPE_UPI',
        payment_settled_at: '2026-11-16T12:00:00Z',
        subtotal_paise: 95000,
        tax_paise: 4750,
        total_paise: 99750,
        created_at: '2026-11-16T12:00:00Z',
        items: [
          {
            id: 'item-11111111-2222-3333-4444-555555555555',
            name_snapshot: 'Butter Chicken',
            unit_price_paise: 42000,
            quantity: 2,
            line_total_paise: 84000,
            notes: "[Dad's Plate] Spice: Mild · Less butter please",
            modifiers: [
              {
                modifier_id: 'mod-1',
                name: 'Extra Gravy',
                price_paise: 5000,
              },
            ],
          },
          {
            id: 'item-66666666-7777-8888-9999-000000000000',
            name_snapshot: 'Royal Malai Kulfi',
            unit_price_paise: 11000,
            quantity: 1,
            line_total_paise: 11000,
            notes: '[Priya] Serve after meal',
          },
        ],
      },
      {
        // Unpaid order — must be excluded by DineFlow rule
        id: 'ord-unpaid-9999',
        table_number: '12',
        status: 'PENDING',
        payment_status: 'PENDING',
        subtotal_paise: 20000,
        tax_paise: 1000,
        total_paise: 21000,
        created_at: '2026-11-16T12:05:00Z',
        items: [
          {
            id: 'item-unpaid-1',
            name_snapshot: 'Garlic Naan',
            unit_price_paise: 10000,
            quantity: 2,
            line_total_paise: 20000,
          },
        ],
      },
    ];

    const plates = flattenPlates(sampleOrders, '12');

    // 2 Butter Chicken plates + 1 Kulfi plate = 3 plates (unpaid excluded)
    assert.equal(plates.length, 3);

    // Plate 1: Butter Chicken (Dad's Plate 1)
    const plate1 = plates[0]!;
    assert.equal(plate1.itemName, 'Butter Chicken');
    assert.equal(plate1.basePricePaise, 42000);
    assert.equal(plate1.modifiersTotalPaise, 5000);
    assert.equal(plate1.plateTotalPaise, 47000);
    assert.equal(plate1.spiceLevel, 'MILD');
    assert.equal(plate1.orderStatus, 'PREPARING');
    assert.equal(plate1.isOnHold, false);

    // Plate 3: Kulfi (Post-meal item -> isOnHold: true)
    const plate3 = plates[2]!;
    assert.equal(plate3.itemName, 'Royal Malai Kulfi');
    assert.equal(plate3.isOnHold, true);
  });

  test('filters plates cleanly into PREPARING, ON_HOLD, SERVED, and CANCELLED tabs', () => {
    const sampleOrders: TableOrderRecord[] = [
      {
        id: 'ord-status-test',
        table_number: '5',
        status: 'PREPARING',
        payment_status: 'PAID',
        subtotal_paise: 100000,
        tax_paise: 5000,
        total_paise: 105000,
        created_at: '2026-11-16T12:00:00Z',
        items: [
          {
            id: 'item-prep',
            name_snapshot: 'Paneer Tikka',
            unit_price_paise: 35000,
            quantity: 1,
            line_total_paise: 35000,
            status: 'PREPARING',
          },
          {
            id: 'item-hold',
            name_snapshot: 'Gulab Jamun',
            unit_price_paise: 15000,
            quantity: 1,
            line_total_paise: 15000,
            status: 'PREPARING',
          },
          {
            id: 'item-served',
            name_snapshot: 'Butter Naan',
            unit_price_paise: 10000,
            quantity: 1,
            line_total_paise: 10000,
            status: 'SERVED',
          },
          {
            id: 'item-cancelled',
            name_snapshot: 'Sweet Lassi',
            unit_price_paise: 12000,
            quantity: 1,
            line_total_paise: 12000,
            status: 'CANCELLED',
          },
        ],
      },
    ];

    const plates = flattenPlates(sampleOrders, '5');

    const prepPlates = filterPlatesByTab(plates, 'PREPARING');
    const holdPlates = filterPlatesByTab(plates, 'ON_HOLD');
    const servedPlates = filterPlatesByTab(plates, 'SERVED');
    const cancelledPlates = filterPlatesByTab(plates, 'CANCELLED');

    assert.equal(prepPlates.length, 1);
    assert.equal(prepPlates[0]?.itemName, 'Paneer Tikka');

    assert.equal(holdPlates.length, 1);
    assert.equal(holdPlates[0]?.itemName, 'Gulab Jamun');

    assert.equal(servedPlates.length, 1);
    assert.equal(servedPlates[0]?.itemName, 'Butter Naan');

    assert.equal(cancelledPlates.length, 1);
    assert.equal(cancelledPlates[0]?.itemName, 'Sweet Lassi');
  });

  test('formats course sequence numbers and badges correctly (C1-C4)', () => {
    assert.equal(getCourseSequenceLabel(1), 'Starters & Appetizers');
    assert.equal(getCourseSequenceLabel(2), 'Main Course');
    assert.equal(getCourseSequenceLabel(3), 'Desserts');
    assert.equal(getCourseSequenceLabel(4), 'Beverages');
    assert.equal(getCourseSequenceLabel(99), 'Main Course');

    const c1 = getCourseBadge(1);
    assert.equal(c1.code, 'C1');
    assert.equal(c1.emoji, '🥗');
    assert.equal(c1.label, 'Starter');

    const c2 = getCourseBadge(2);
    assert.equal(c2.code, 'C2');
    assert.equal(c2.emoji, '🍛');
    assert.equal(c2.label, 'Main Course');

    const c3 = getCourseBadge(3);
    assert.equal(c3.code, 'C3');
    assert.equal(c3.emoji, '🍨');
    assert.equal(c3.label, 'Dessert');

    const c4 = getCourseBadge(4);
    assert.equal(c4.code, 'C4');
    assert.equal(c4.emoji, '☕');
    assert.equal(c4.label, 'Beverage');
  });

  test('strictly excludes unpaid / failed / cancelled orders from flattened plates (Zero-Leak Gate)', () => {
    const orders: TableOrderRecord[] = [
      {
        id: 'ord-unpaid-fake-prep',
        table_number: '1',
        status: 'PREPARING', // In buggy state, kitchen prepared an unpaid order
        payment_status: 'PENDING', // Must be blocked!
        subtotal_paise: 50000,
        tax_paise: 2500,
        total_paise: 52500,
        created_at: '2026-11-16T12:00:00Z',
        items: [
          {
            id: 'it-unpaid',
            name_snapshot: 'Mutton Biryani',
            unit_price_paise: 50000,
            quantity: 1,
            line_total_paise: 50000,
          },
        ],
      },
      {
        id: 'ord-failed',
        table_number: '1',
        status: 'CONFIRMED',
        payment_status: 'FAILED',
        subtotal_paise: 20000,
        tax_paise: 1000,
        total_paise: 21000,
        created_at: '2026-11-16T12:01:00Z',
        items: [
          {
            id: 'it-failed',
            name_snapshot: 'Butter Naan',
            unit_price_paise: 20000,
            quantity: 1,
            line_total_paise: 20000,
          },
        ],
      },
      {
        id: 'ord-paid-valid',
        table_number: '1',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        subtotal_paise: 30000,
        tax_paise: 1500,
        total_paise: 31500,
        created_at: '2026-11-16T12:02:00Z',
        items: [
          {
            id: 'it-paid',
            name_snapshot: 'Paneer Butter Masala',
            unit_price_paise: 30000,
            quantity: 1,
            line_total_paise: 30000,
          },
        ],
      },
    ];

    const plates = flattenPlates(orders, '1');
    assert.equal(plates.length, 1, 'Only the paid order must produce plates');
    assert.equal(plates[0]?.itemName, 'Paneer Butter Masala');
    assert.equal(plates[0]?.isPaid, true);
  });

  test('accurately maps course_sequence, hold_status, scheduled_for and pre-booking metadata', () => {
    const scheduledTime = '2026-11-16T20:00:00.000Z';
    const targetFire = '2026-11-16T19:43:00.000Z';

    const order: TableOrderRecord = {
      id: 'ord-prebook-1',
      table_number: 'T4',
      status: 'CONFIRMED',
      payment_status: 'PAID',
      order_type: 'PRE_BOOK_DINE_IN',
      scheduled_for: scheduledTime,
      guest_count: 4,
      subtotal_paise: 120000,
      tax_paise: 6000,
      total_paise: 126000,
      created_at: '2026-11-16T17:00:00Z',
      items: [
        {
          id: 'it-biryani',
          name_snapshot: 'Hyderabadi Chicken Biryani',
          unit_price_paise: 45000,
          quantity: 2,
          line_total_paise: 90000,
          course_sequence: 2,
          prep_time_minutes: 25,
          target_fire_at: targetFire,
          hold_status: 'SCHEDULED_WAIT',
        },
        {
          id: 'it-dessert',
          name_snapshot: 'Warm Gulab Jamun Handi',
          unit_price_paise: 15000,
          quantity: 2,
          line_total_paise: 30000,
          course_sequence: 3,
          prep_time_minutes: 10,
          hold_status: 'SERVE_LATER_HOLD',
        },
      ],
    };

    const plates = flattenPlates([order], 'T4');
    assert.equal(plates.length, 4, '2 biryanis + 2 gulab jamuns = 4 plates');

    // Biryani plate assertions
    const bPlate = plates[0]!;
    assert.equal(bPlate.courseSequence, 2);
    assert.equal(bPlate.prepTimeMinutes, 25);
    assert.equal(bPlate.targetFireAt, targetFire);
    assert.equal(bPlate.holdStatus, 'SCHEDULED_WAIT');
    assert.equal(bPlate.isScheduledWait, true);
    assert.equal(bPlate.isOnHold, false);
    assert.equal(bPlate.orderType, 'PRE_BOOK_DINE_IN');
    assert.equal(bPlate.scheduledFor, scheduledTime);

    // Dessert plate assertions
    const dPlate = plates[2]!;
    assert.equal(dPlate.courseSequence, 3);
    assert.equal(dPlate.holdStatus, 'SERVE_LATER_HOLD');
    assert.equal(dPlate.isOnHold, true);
    assert.equal(dPlate.isScheduledWait, false);

    // Test releasing hold on dessert plate
    const releasedPlates = flattenPlates([order], 'T4', { [dPlate.plateKey]: true });
    const releasedDPlate = releasedPlates[2]!;
    assert.equal(releasedDPlate.isOnHold, false);
    assert.equal(releasedDPlate.holdStatus, 'RELEASED');
  });

  test('regression: served items appear strictly in SERVED tab and NEVER in PREPARING even if parent order is CONFIRMED', () => {
    const multiDishOrder: TableOrderRecord = {
      id: 'ord-multi-status-sync',
      displayId: 'ORD-0042',
      table_number: '12',
      status: 'CONFIRMED',
      payment_status: 'PAID',
      subtotal_paise: 90000,
      tax_paise: 4500,
      total_paise: 94500,
      created_at: '2026-11-19T12:00:00Z',
      items: [
        {
          id: 'item-served-1',
          name_snapshot: 'Butter Chicken',
          unit_price_paise: 45000,
          quantity: 1,
          line_total_paise: 45000,
          status: 'SERVED',
          hold_status: 'ACTIVE',
        },
        {
          id: 'item-cooking-2',
          name_snapshot: 'Garlic Naan',
          unit_price_paise: 15000,
          quantity: 1,
          line_total_paise: 15000,
          status: 'PREPARING',
          hold_status: 'ACTIVE',
        },
        {
          id: 'item-held-3',
          name_snapshot: 'Kulfi Falooda',
          unit_price_paise: 30000,
          quantity: 1,
          line_total_paise: 30000,
          status: 'CONFIRMED',
          hold_status: 'SERVE_LATER_HOLD',
        },
      ],
    };

    const plates = flattenPlates([multiDishOrder], '12');
    assert.equal(plates.length, 3);

    // Filter by tabs
    const servedTab = filterPlatesByTab(plates, 'SERVED');
    const preparingTab = filterPlatesByTab(plates, 'PREPARING');
    const onHoldTab = filterPlatesByTab(plates, 'ON_HOLD');

    assert.equal(servedTab.length, 1);
    assert.equal(servedTab[0]?.itemName, 'Butter Chicken');
    assert.equal(servedTab[0]?.itemStatus, 'SERVED');

    // Butter chicken MUST NOT appear in preparingTab!
    assert.ok(preparingTab.every((p) => p.itemName !== 'Butter Chicken'));
    assert.equal(preparingTab.length, 1);
    assert.equal(preparingTab[0]?.itemName, 'Garlic Naan');

    assert.equal(onHoldTab.length, 1);
    assert.equal(onHoldTab[0]?.itemName, 'Kulfi Falooda');
  });

  test('regression: releasing one serve-later plate preserves plate count without duplication or corruption', () => {
    const orderWithMultipleLassi: TableOrderRecord = {
      id: 'ord-mango-lassi-qty',
      displayId: 'ORD-0099',
      table_number: '7',
      status: 'CONFIRMED',
      payment_status: 'PAID',
      subtotal_paise: 30000,
      tax_paise: 1500,
      total_paise: 31500,
      created_at: '2026-11-19T12:00:00Z',
      items: [
        {
          id: 'item-lassi-1',
          name_snapshot: 'Mango Lassi',
          unit_price_paise: 15000,
          quantity: 2,
          line_total_paise: 30000,
          status: 'CONFIRMED',
          hold_status: 'SERVE_LATER_HOLD',
        },
      ],
    };

    // Before release: 2 plates on hold
    const initialPlates = flattenPlates([orderWithMultipleLassi], '7');
    assert.equal(initialPlates.length, 2);
    assert.equal(initialPlates[0]?.plateKey, 'ord-mango-lassi-qty-item-lassi-1-1');
    assert.equal(initialPlates[1]?.plateKey, 'ord-mango-lassi-qty-item-lassi-1-2');
    assert.equal(initialPlates[0]?.isOnHold, true);
    assert.equal(initialPlates[1]?.isOnHold, true);

    // Release only plate 1
    const plate1Key = initialPlates[0]!.plateKey;
    const partialReleasePlates = flattenPlates([orderWithMultipleLassi], '7', { [plate1Key]: true });
    assert.equal(partialReleasePlates.length, 2, 'Total plate count must remain strictly 2 (no doubling to 3 or 4)');

    const releasedPlate = partialReleasePlates.find((p) => p.plateKey === plate1Key)!;
    const unreleasedPlate = partialReleasePlates.find((p) => p.plateKey !== plate1Key)!;

    assert.equal(releasedPlate.isOnHold, false);
    assert.equal(releasedPlate.holdStatus, 'RELEASED');
    assert.equal(unreleasedPlate.isOnHold, true);
    assert.equal(unreleasedPlate.holdStatus, 'SERVE_LATER_HOLD');

    // In tabs
    const onHoldTab = filterPlatesByTab(partialReleasePlates, 'ON_HOLD');
    const preparingTab = filterPlatesByTab(partialReleasePlates, 'PREPARING');
    assert.equal(onHoldTab.length, 1);
    assert.equal(preparingTab.length, 1);
  });

  test('regression: deduplicateOrders prevents duplicate orders and items', () => {
    const rawOrders: TableOrderRecord[] = [
      {
        id: 'ord-dup-1',
        displayId: 'ORD-0001',
        table_number: '3',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        subtotal_paise: 20000,
        tax_paise: 1000,
        total_paise: 21000,
        created_at: '2026-11-19T10:00:00Z',
        items: [
          {
            id: 'it-dup-1',
            name_snapshot: 'Samosa',
            unit_price_paise: 10000,
            quantity: 1,
            line_total_paise: 10000,
          },
          {
            id: 'it-dup-1', // Duplicate item id
            name_snapshot: 'Samosa',
            unit_price_paise: 10000,
            quantity: 1,
            line_total_paise: 10000,
          },
        ],
      },
      {
        id: 'ord-dup-1', // Duplicate order id
        displayId: 'ORD-0001',
        table_number: '3',
        status: 'CONFIRMED',
        payment_status: 'PAID',
        subtotal_paise: 20000,
        tax_paise: 1000,
        total_paise: 21000,
        created_at: '2026-11-19T10:00:00Z',
        items: [
          {
            id: 'it-dup-1',
            name_snapshot: 'Samosa',
            unit_price_paise: 10000,
            quantity: 1,
            line_total_paise: 10000,
          },
        ],
      },
    ];

    const deduplicated = deduplicateOrders(rawOrders);
    assert.equal(deduplicated.length, 1);
    assert.equal(deduplicated[0]?.items.length, 1);
  });

  test('regression: getDishStatusBadge labels QUEUED, COOKING, READY, SERVED accurately', () => {
    assert.equal(getDishStatusBadge('CONFIRMED', 'ACTIVE').code, 'QUEUED');
    assert.equal(getDishStatusBadge('PENDING', 'ACTIVE').code, 'QUEUED');
    assert.equal(getDishStatusBadge('PREPARING', 'ACTIVE').code, 'COOKING');
    assert.equal(getDishStatusBadge('READY', 'ACTIVE').code, 'READY');
    assert.equal(getDishStatusBadge('SERVED', 'ACTIVE').code, 'SERVED');
    assert.equal(getDishStatusBadge('CONFIRMED', 'SERVE_LATER_HOLD').code, 'ON_HOLD');
    assert.equal(getDishStatusBadge('CONFIRMED', 'SCHEDULED_WAIT').code, 'SCHEDULED');
  });
});
