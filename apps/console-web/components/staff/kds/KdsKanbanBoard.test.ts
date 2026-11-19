import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDessertOrPostMealDish,
  filterConfirmedOrders,
  filterPreparingOrders,
  filterReadyOrders,
  countReadyItems,
  getCourseSequenceLabel,
  getCourseSequenceBadge,
  getFireUrgency,
  filterKdsItemsByCourse,
  filterKdsItemsByStatus,
  sortKdsItems,
  buildBatchSummary,
  formatOriginBadge,
} from './kds-utils.ts';
import { useStaffStore } from '../../../store/useStaffStore.ts';
import type { Order, KdsItemTicket } from '../../../app/lib/restaurant-db.ts';

describe('KdsKanbanBoard & OrderTicketCard (KdsKanbanBoard.test.ts)', () => {
  beforeEach(() => {
    useStaffStore.setState({
      orders: [],
      currentUser: null,
      currentRole: 'KITCHEN',
    });
  });

  describe('isDessertOrPostMealDish Course Hold Detection', () => {
    it('detects traditional desserts and sweets for delayed course release', () => {
      assert.equal(isDessertOrPostMealDish('Royal Matka Kulfi'), true);
      assert.equal(isDessertOrPostMealDish('Gulab Jamun with Rabri'), true);
      assert.equal(isDessertOrPostMealDish('Vanilla Ice Cream'), true);
      assert.equal(isDessertOrPostMealDish('Moong Dal Halwa'), true);
      assert.equal(isDessertOrPostMealDish('Angoori Rasmalai'), true);
      assert.equal(isDessertOrPostMealDish('Chef Special Dessert Platter'), true);
    });

    it('detects explicit customer serve_later tags in item notes', () => {
      assert.equal(isDessertOrPostMealDish('Masala Chai', 'Please serve later after biryani'), true);
      assert.equal(isDessertOrPostMealDish('Sweet Lassi', '[serve_later] with meal end'), true);
    });

    it('does not tag savory main courses or appetizers', () => {
      assert.equal(isDessertOrPostMealDish('Butter Chicken'), false);
      assert.equal(isDessertOrPostMealDish('Paneer Butter Masala'), false);
      assert.equal(isDessertOrPostMealDish('Garlic Naan', 'Extra crispy'), false);
      assert.equal(isDessertOrPostMealDish('Dum Handi Biryani'), false);
    });
  });

  describe('KDS Kanban Column Order Partitioning', () => {
    const mockConfirmedOrder: Order = {
      id: 'o-new-1',
      displayId: 'ORD-#0001',
      outletId: 'out-1',
      tableNumber: 'T01',
      sessionId: 'sess-1',
      status: 'CONFIRMED',
      subtotalPaise: 40000,
      taxPaise: 2000,
      discountPaise: 0,
      totalPaise: 42000,
      createdAt: '12:00',
      items: [
        {
          id: 'i-1',
          orderId: 'o-new-1',
          itemId: 'm-1',
          name: 'Butter Chicken',
          pricePaise: 40000,
          quantity: 1,
          status: 'CONFIRMED',
        },
      ],
      events: [],
    };

    const mockCookingOrder: Order = {
      id: 'o-cook-1',
      displayId: 'ORD-#0002',
      outletId: 'out-1',
      tableNumber: 'T02',
      sessionId: 'sess-2',
      status: 'PREPARING',
      subtotalPaise: 25000,
      taxPaise: 1250,
      discountPaise: 0,
      totalPaise: 26250,
      createdAt: '12:05',
      items: [
        {
          id: 'i-2',
          orderId: 'o-cook-1',
          itemId: 'm-2',
          name: 'Paneer Tikka',
          pricePaise: 25000,
          quantity: 1,
          status: 'PREPARING',
        },
      ],
      events: [],
    };

    const mockReadyOrder: Order = {
      id: 'o-ready-1',
      displayId: 'ORD-#0003',
      outletId: 'out-1',
      tableNumber: 'T03',
      sessionId: 'sess-3',
      status: 'READY',
      subtotalPaise: 30000,
      taxPaise: 1500,
      discountPaise: 0,
      totalPaise: 31500,
      createdAt: '12:10',
      items: [
        {
          id: 'i-3',
          orderId: 'o-ready-1',
          itemId: 'm-3',
          name: 'Dal Makhani',
          pricePaise: 30000,
          quantity: 1,
          status: 'READY',
        },
      ],
      events: [],
    };

    it('correctly partitions orders across Confirmed, Preparing and Ready on Pass', () => {
      useStaffStore
        .getState()
        .setOrders([mockConfirmedOrder, mockCookingOrder, mockReadyOrder]);

      const orders = useStaffStore.getState().orders;

      const confirmed = filterConfirmedOrders(orders);
      assert.equal(confirmed.length, 1);
      assert.equal(confirmed[0]?.id, 'o-new-1');

      const preparing = filterPreparingOrders(orders);
      assert.equal(preparing.length, 2);

      const ready = filterReadyOrders(orders);
      assert.equal(ready.length, 1);
      assert.equal(ready[0]?.id, 'o-ready-1');

      const readyItemsCount = countReadyItems(orders);
      assert.equal(readyItemsCount, 1);
    });
  });

  describe('Smart Kitchen Course Sequences & Fire Urgency Calculation', () => {
    it('maps course sequence numbers to accurate kitchen labels and badge styling', () => {
      assert.equal(getCourseSequenceLabel(1), 'Starter (C1)');
      assert.equal(getCourseSequenceLabel(2), 'Main Course (C2)');
      assert.equal(getCourseSequenceLabel(3), 'Dessert (C3)');
      assert.equal(getCourseSequenceLabel(4), 'Beverage (C4)');

      const c1Badge = getCourseSequenceBadge(1);
      assert.equal(c1Badge.emoji, '🥗');
      assert.equal(c1Badge.color, '#10b981');

      const c3Badge = getCourseSequenceBadge(3);
      assert.equal(c3Badge.emoji, '🍨');
      assert.equal(c3Badge.color, '#c084fc');
    });

    it('calculates fire urgency countdowns, holds, and overdue states', () => {
      const now = new Date('2026-11-18T12:00:00.000Z').getTime();

      // 1. Hold status SERVE_LATER_HOLD
      const holdUrgency = getFireUrgency(null, 'SERVE_LATER_HOLD', now);
      assert.equal(holdUrgency.isFireNow, false);
      assert.equal(holdUrgency.label, '⏳ ON HOLD (Serve Later)');

      // 2. Overdue fire time (target was 5 minutes ago)
      const pastFire = new Date('2026-11-18T11:55:00.000Z').toISOString();
      const overdueUrgency = getFireUrgency(pastFire, 'ACTIVE', now);
      assert.equal(overdueUrgency.isFireNow, true);
      assert.equal(overdueUrgency.isOverdue, true);
      assert.equal(overdueUrgency.pulse, true);
      assert.match(overdueUrgency.label, /OVERDUE/);

      // 3. Imminent fire time (within 3 minutes)
      const imminentFire = new Date('2026-11-18T12:03:00.000Z').toISOString();
      const imminentUrgency = getFireUrgency(imminentFire, 'ACTIVE', now);
      assert.equal(imminentUrgency.isFireNow, false);
      assert.equal(imminentUrgency.label, '⚡ Fire in 3m');

      // 4. Future scheduled fire time (30 minutes away)
      const futureFire = new Date('2026-11-18T12:30:00.000Z').toISOString();
      const futureUrgency = getFireUrgency(futureFire, 'SCHEDULED_WAIT', now);
      assert.equal(futureUrgency.isFireNow, false);
      assert.equal(futureUrgency.label, '⏱️ Scheduled in 30m');
    });

    it('filters KDS items by course sequence and operational status', () => {
      const mockTickets: KdsItemTicket[] = [
        {
          itemId: 'item-1',
          orderId: 'ord-1',
          orderDisplayId: '#1001',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Paneer Tikka',
          quantity: 1,
          modifiers: [],
          spiceLevel: 'MEDIUM',
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 1,
          prepTimeMinutes: 12,
          targetFireAt: '2026-11-18T12:00:00.000Z',
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T11:50:00.000Z',
        },
        {
          itemId: 'item-2',
          orderId: 'ord-1',
          orderDisplayId: '#1001',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Dum Biryani',
          quantity: 2,
          modifiers: [],
          spiceLevel: 'HOT',
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: '2026-11-18T12:00:00.000Z',
          holdStatus: 'ACTIVE',
          itemStatus: 'PREPARING',
          paidAt: '2026-11-18T11:50:00.000Z',
        },
        {
          itemId: 'item-3',
          orderId: 'ord-1',
          orderDisplayId: '#1001',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Gulab Jamun',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 3,
          prepTimeMinutes: 8,
          targetFireAt: '2026-11-18T12:40:00.000Z',
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T11:50:00.000Z',
        },
      ];

      // Filter by course
      const starters = filterKdsItemsByCourse(mockTickets, 1);
      assert.equal(starters.length, 1);
      assert.equal(starters[0]?.dishName, 'Paneer Tikka');

      const mains = filterKdsItemsByCourse(mockTickets, 2);
      assert.equal(mains.length, 1);
      assert.equal(mains[0]?.dishName, 'Dum Biryani');

      // Filter by operational status
      const preparing = filterKdsItemsByStatus(mockTickets, 'PREPARING');
      assert.equal(preparing.length, 1);
      assert.equal(preparing[0]?.dishName, 'Dum Biryani');

      const onHold = filterKdsItemsByStatus(mockTickets, 'HOLD');
      assert.equal(onHold.length, 1);
      assert.equal(onHold[0]?.dishName, 'Gulab Jamun');
    });
  });

  describe('Flattened Independent Item Priority Queue & Batch Cook Summary', () => {
    it('places all 3 Biryanis (28m prep) from rapid orders T01, T02, T03 at the top while Coffee (4m) and Ice Cream (5m) remain in Serve-Later Hold', () => {
      const tickets: KdsItemTicket[] = [
        // Order 1 (T01): Biryani (28m), Coffee (4m, hold), Ice Cream (5m, hold)
        {
          itemId: 'i-biryani-t01',
          orderId: 'ord-t01',
          orderDisplayId: '#T01A',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Awadhi Mutton Biryani',
          quantity: 1,
          modifiers: [],
          spiceLevel: 'MEDIUM',
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: '2026-11-18T12:00:00.000Z',
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T12:00:00.000Z',
        },
        {
          itemId: 'i-coffee-t01',
          orderId: 'ord-t01',
          orderDisplayId: '#T01A',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Filter Coffee',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 4,
          prepTimeMinutes: 4,
          targetFireAt: '2026-11-18T12:35:00.000Z',
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T12:00:00.000Z',
        },
        {
          itemId: 'i-icecream-t01',
          orderId: 'ord-t01',
          orderDisplayId: '#T01A',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Vanilla Ice Cream',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 3,
          prepTimeMinutes: 5,
          targetFireAt: '2026-11-18T12:35:00.000Z',
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T12:00:00.000Z',
        },

        // Order 2 (T02, 1 minute later): Biryani (28m), Coffee (4m, hold)
        {
          itemId: 'i-biryani-t02',
          orderId: 'ord-t02',
          orderDisplayId: '#T02B',
          orderType: 'DINE_IN',
          tableNumber: 'T02',
          scheduledFor: null,
          dishName: 'Awadhi Mutton Biryani',
          quantity: 1,
          modifiers: [],
          spiceLevel: 'HOT',
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: '2026-11-18T12:01:00.000Z',
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T12:01:00.000Z',
        },
        {
          itemId: 'i-coffee-t02',
          orderId: 'ord-t02',
          orderDisplayId: '#T02B',
          orderType: 'DINE_IN',
          tableNumber: 'T02',
          scheduledFor: null,
          dishName: 'Filter Coffee',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 4,
          prepTimeMinutes: 4,
          targetFireAt: '2026-11-18T12:36:00.000Z',
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T12:01:00.000Z',
        },

        // Order 3 (T03, 2 minutes later): Biryani (28m), Ice Cream (5m, hold)
        {
          itemId: 'i-biryani-t03',
          orderId: 'ord-t03',
          orderDisplayId: '#T03C',
          orderType: 'DINE_IN',
          tableNumber: 'T03',
          scheduledFor: null,
          dishName: 'Awadhi Mutton Biryani',
          quantity: 1,
          modifiers: [],
          spiceLevel: 'MILD',
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: '2026-11-18T12:02:00.000Z',
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T12:02:00.000Z',
        },
        {
          itemId: 'i-icecream-t03',
          orderId: 'ord-t03',
          orderDisplayId: '#T03C',
          orderType: 'DINE_IN',
          tableNumber: 'T03',
          scheduledFor: null,
          dishName: 'Vanilla Ice Cream',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 3,
          prepTimeMinutes: 5,
          targetFireAt: '2026-11-18T12:37:00.000Z',
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T12:02:00.000Z',
        },
      ];

      // Active Queue items (fire now / active dishes)
      const activeQueue = tickets.filter(
        (it) => it.holdStatus === 'ACTIVE' || it.holdStatus === 'RELEASED',
      );
      const sortedActive = sortKdsItems(activeQueue);

      // Verify that all 3 Biryanis are at the top, ordered chronologically by targetFireAt / paidAt
      assert.equal(sortedActive.length, 3);
      assert.equal(sortedActive[0]?.itemId, 'i-biryani-t01');
      assert.equal(sortedActive[0]?.dishName, 'Awadhi Mutton Biryani');
      assert.equal(sortedActive[1]?.itemId, 'i-biryani-t02');
      assert.equal(sortedActive[1]?.dishName, 'Awadhi Mutton Biryani');
      assert.equal(sortedActive[2]?.itemId, 'i-biryani-t03');
      assert.equal(sortedActive[2]?.dishName, 'Awadhi Mutton Biryani');

      // Verify Serve-Later Hold tab items
      const heldQueue = tickets.filter((it) => it.holdStatus === 'SERVE_LATER_HOLD');
      assert.equal(heldQueue.length, 4);
      assert.ok(heldQueue.every((it) => it.dishName === 'Filter Coffee' || it.dishName === 'Vanilla Ice Cream'));
    });

    it('accurately aggregates identical active dishes across tables in buildBatchSummary', () => {
      const activeTickets: KdsItemTicket[] = [
        {
          itemId: 'b1',
          orderId: 'o1',
          orderDisplayId: '#01',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Awadhi Mutton Biryani',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: null,
          holdStatus: 'ACTIVE',
          itemStatus: 'PREPARING',
          paidAt: null,
        },
        {
          itemId: 'b2',
          orderId: 'o2',
          orderDisplayId: '#02',
          orderType: 'DINE_IN',
          tableNumber: 'T02',
          scheduledFor: null,
          dishName: 'Awadhi Mutton Biryani',
          quantity: 2,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: null,
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: null,
        },
        {
          itemId: 'b3',
          orderId: 'o3',
          orderDisplayId: '#03',
          orderType: 'DINE_IN',
          tableNumber: 'T03',
          scheduledFor: null,
          dishName: 'Awadhi Mutton Biryani',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: null,
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: null,
        },
        {
          itemId: 'n1',
          orderId: 'o1',
          orderDisplayId: '#01',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Butter Naan',
          quantity: 3,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 6,
          targetFireAt: null,
          holdStatus: 'ACTIVE',
          itemStatus: 'PREPARING',
          paidAt: null,
        },
        {
          itemId: 'n2',
          orderId: 'o2',
          orderDisplayId: '#02',
          orderType: 'DINE_IN',
          tableNumber: 'T02',
          scheduledFor: null,
          dishName: 'Butter Naan',
          quantity: 2,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 6,
          targetFireAt: null,
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: null,
        },
        // Excluded items: READY on pass and SERVE_LATER_HOLD
        {
          itemId: 'd1',
          orderId: 'o1',
          orderDisplayId: '#01',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Gulab Jamun',
          quantity: 2,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 3,
          prepTimeMinutes: 5,
          targetFireAt: null,
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'PENDING',
          paidAt: null,
        },
        {
          itemId: 'r1',
          orderId: 'o4',
          orderDisplayId: '#04',
          orderType: 'DINE_IN',
          tableNumber: 'T04',
          scheduledFor: null,
          dishName: 'Paneer Tikka',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 1,
          prepTimeMinutes: 12,
          targetFireAt: null,
          holdStatus: 'ACTIVE',
          itemStatus: 'READY',
          paidAt: null,
        },
      ];

      const batch = buildBatchSummary(activeTickets);

      // Butter Naan: 3 + 2 = 5
      // Awadhi Mutton Biryani: 1 + 2 + 1 = 4
      assert.equal(batch.length, 2);
      assert.equal(batch[0]?.dishName, 'Butter Naan');
      assert.equal(batch[0]?.totalQty, 5);
      assert.equal(batch[1]?.dishName, 'Awadhi Mutton Biryani');
      assert.equal(batch[1]?.totalQty, 4);
    });

    it('properly formats combo tags, table origins, order references, and takeaway/pre-book badges', () => {
      // 1. Dine-In Ticket
      const dineInTicket: KdsItemTicket = {
        itemId: 'ti-1',
        orderId: 'ord-dinein-1234',
        orderDisplayId: '#D123',
        orderType: 'DINE_IN',
        tableNumber: 'T01',
        scheduledFor: null,
        dishName: 'Awadhi Mutton Biryani',
        quantity: 2,
        modifiers: ['Extra Raita'],
        spiceLevel: 'HOT',
        notes: 'Extra spicy',
        isComboItem: false,
        comboName: null,
        courseSequence: 2,
        prepTimeMinutes: 28,
        targetFireAt: '2026-11-18T12:00:00.000Z',
        holdStatus: 'ACTIVE',
        itemStatus: 'PENDING',
        paidAt: '2026-11-18T11:50:00.000Z',
      };

      const dineInBadge = formatOriginBadge(dineInTicket);
      assert.equal(dineInBadge.text, '🪑 Table T01');

      // 2. Pre-Book Dine-In Ticket
      const preBookTicket: KdsItemTicket = {
        ...dineInTicket,
        itemId: 'ti-2',
        orderType: 'PRE_BOOK_DINE_IN',
        tableNumber: 'T04',
        scheduledFor: '2026-11-18T14:30:00.000Z',
      };

      const preBookBadge = formatOriginBadge(preBookTicket);
      assert.match(preBookBadge.text, /📅 PRE-BOOK T04/);

      // 3. Takeaway Ticket
      const takeawayTicket: KdsItemTicket = {
        ...dineInTicket,
        itemId: 'ti-3',
        orderType: 'TAKEAWAY',
        tableNumber: '',
        scheduledFor: '2026-11-18T15:00:00.000Z',
      };

      const takeawayBadge = formatOriginBadge(takeawayTicket);
      assert.match(takeawayBadge.text, /🛍️ TAKEAWAY/);

      // 4. Combo Item
      const comboTicket: KdsItemTicket = {
        ...dineInTicket,
        itemId: 'ti-4',
        isComboItem: true,
        comboName: 'Solo Executive Biryani Box',
      };

      assert.equal(comboTicket.isComboItem, true);
      assert.equal(comboTicket.comboName, 'Solo Executive Biryani Box');
    });
  });
});
