import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOrderDateTime,
  isDessertOrPostMealItem,
  parseOrderItemNotes,
  flattenPlates,
  filterPlatesByTab,
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
});
