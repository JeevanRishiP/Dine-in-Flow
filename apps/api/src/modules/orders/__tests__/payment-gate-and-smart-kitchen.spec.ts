/**
 * payment-gate-and-smart-kitchen.spec.ts
 *
 * Comprehensive test suite verifying the DineFlow Payment Security Gate
 * and Smart Kitchen Orchestration Engine:
 *
 * 1. Zero-Leak Payment Quarantine:
 *    - Unpaid / cancelled orders NEVER appear in KDS flat queue (GET /api/v1/console/kds/items)
 *      or console orders list (GET /api/v1/console/orders).
 *    - PATCH order status or item status to PREPARING/READY/SERVED returns 409 Conflict if unpaid.
 * 2. Smart Kitchen Scheduler:
 *    - Rapid orders of (Biryani 28m, Coffee 4m, Ice Cream 5m) across T01, T02, T03 output
 *      all 3 Biryanis at the top of the flat queue while Coffee & Ice Cream stay in SERVE_LATER_HOLD.
 *    - Scheduled order for 2 hours later stays in SCHEDULED_WAIT until its target_fire_at arrives.
 *    - TAKEAWAY orders do not hold desserts/beverages; they align to pickup time.
 *    - Auto-prompter triggers 15 minutes after main course is served.
 * 3. Table Reservation Availability & Snooze:
 *    - Multi-table combination for larger parties.
 *    - Snooze postpones prompt by 10 minutes.
 * 4. Abandoned Checkout Expiry:
 *    - Orders in AWAITING_PAYMENT older than 15 minutes are expired and reservation released.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  scheduleOrderItems,
  sortKdsItemTickets,
  shouldSendServeLaterPrompt,
  type KdsItemTicket,
} from '../../../services/kitchen-scheduler.js';
import { KitchenSchedulerService } from '../kitchen-scheduler.service.js';
import { OrdersService } from '../orders.service.js';
import { PaymentExpiryCleanupService } from '../payment-expiry-cleanup.service.js';
import * as dbClient from '../../../db/client.js';

describe('Payment Security Gate & Smart Kitchen Orchestrator', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const outletId = '88888888-4444-4444-4444-888888888888';
  const orderId1 = '11111111-1111-1111-1111-111111111111';
  const orderId2 = '22222222-2222-2222-2222-222222222222';
  const orderId3 = '33333333-3333-3333-3333-333333333333';
  const itemId1 = '5d08ad3f-138d-4e81-af94-24b5ff3411ad';

  let queryMock: ReturnType<typeof vi.fn>;
  let poolQueryMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock = vi.fn();
    poolQueryMock = vi.fn();

    const mockClient = { query: queryMock } as unknown as PoolClient;
    const mockPool = { query: poolQueryMock } as unknown as Pool;

    vi.spyOn(dbClient, 'getPool').mockReturnValue(mockPool);
    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_targetOrgId: string, fn: (client: PoolClient) => Promise<T>) => fn(mockClient),
    );
  });

  // ============================================================================
  // 1. Pure Kitchen Scheduler Engine (Pure Logic Tests)
  // ============================================================================

  describe('1. Pure Kitchen Scheduler Engine', () => {
    it('proves 3 rapid orders of Biryani (28m), Coffee (4m), Ice Cream (5m) output Biryanis ACTIVE at top and Coffee/Ice Cream in SERVE_LATER_HOLD', () => {
      const now = new Date('2026-11-18T12:00:00.000Z');

      // T01 Order: Biryani (Course 2, 28m), Coffee (Course 4, 4m), Ice Cream (Course 3, 5m)
      const t01Items = [
        { id: 't01-biryani', courseSequence: 2, prepTimeMinutes: 28, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 't01-coffee', courseSequence: 4, prepTimeMinutes: 4, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 't01-icecream', courseSequence: 3, prepTimeMinutes: 5, status: 'PENDING', holdStatus: 'ACTIVE' as const },
      ];
      const t01Sched = scheduleOrderItems(
        { orderType: 'DINE_IN', scheduledFor: null, paidAt: now, items: t01Items },
        now,
      );

      // T02 Order: placed 30 seconds later
      const t02PaidAt = new Date('2026-11-18T12:00:30.000Z');
      const t02Items = [
        { id: 't02-biryani', courseSequence: 2, prepTimeMinutes: 28, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 't02-coffee', courseSequence: 4, prepTimeMinutes: 4, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 't02-icecream', courseSequence: 3, prepTimeMinutes: 5, status: 'PENDING', holdStatus: 'ACTIVE' as const },
      ];
      const t02Sched = scheduleOrderItems(
        { orderType: 'DINE_IN', scheduledFor: null, paidAt: t02PaidAt, items: t02Items },
        t02PaidAt,
      );

      // T03 Order: placed 60 seconds later
      const t03PaidAt = new Date('2026-11-18T12:01:00.000Z');
      const t03Items = [
        { id: 't03-biryani', courseSequence: 2, prepTimeMinutes: 28, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 't03-coffee', courseSequence: 4, prepTimeMinutes: 4, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 't03-icecream', courseSequence: 3, prepTimeMinutes: 5, status: 'PENDING', holdStatus: 'ACTIVE' as const },
      ];
      const t03Sched = scheduleOrderItems(
        { orderType: 'DINE_IN', scheduledFor: null, paidAt: t03PaidAt, items: t03Items },
        t03PaidAt,
      );

      // Verify course hold assignment:
      // In all 3 dine-in orders, Biryani (Course 2) is ACTIVE, while Coffee (Course 4) and Ice Cream (Course 3) are held in SERVE_LATER_HOLD
      for (const sched of [t01Sched, t02Sched, t03Sched]) {
        const biryani = sched.find((i) => i.id.includes('biryani'))!;
        const coffee = sched.find((i) => i.id.includes('coffee'))!;
        const icecream = sched.find((i) => i.id.includes('icecream'))!;

        expect(biryani.holdStatus).toBe('ACTIVE');
        expect(coffee.holdStatus).toBe('SERVE_LATER_HOLD');
        expect(icecream.holdStatus).toBe('SERVE_LATER_HOLD');
      }

      // Convert to KDS flat tickets
      const allTickets: KdsItemTicket[] = [
        ...t01Sched.map((i) => ({
          itemId: i.id,
          orderId: orderId1,
          orderDisplayId: 'ORD-001',
          orderType: 'DINE_IN' as const,
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: i.id.includes('biryani') ? 'Dum Biryani' : i.id.includes('coffee') ? 'Filter Coffee' : 'Vanilla Ice Cream',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: i.courseSequence,
          prepTimeMinutes: i.prepTimeMinutes,
          targetFireAt: i.targetFireAt,
          holdStatus: i.holdStatus,
          itemStatus: 'PENDING' as const,
          paidAt: now.toISOString(),
        })),
        ...t02Sched.map((i) => ({
          itemId: i.id,
          orderId: orderId2,
          orderDisplayId: 'ORD-002',
          orderType: 'DINE_IN' as const,
          tableNumber: 'T02',
          scheduledFor: null,
          dishName: i.id.includes('biryani') ? 'Dum Biryani' : i.id.includes('coffee') ? 'Filter Coffee' : 'Vanilla Ice Cream',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: i.courseSequence,
          prepTimeMinutes: i.prepTimeMinutes,
          targetFireAt: i.targetFireAt,
          holdStatus: i.holdStatus,
          itemStatus: 'PENDING' as const,
          paidAt: t02PaidAt.toISOString(),
        })),
        ...t03Sched.map((i) => ({
          itemId: i.id,
          orderId: orderId3,
          orderDisplayId: 'ORD-003',
          orderType: 'DINE_IN' as const,
          tableNumber: 'T03',
          scheduledFor: null,
          dishName: i.id.includes('biryani') ? 'Dum Biryani' : i.id.includes('coffee') ? 'Filter Coffee' : 'Vanilla Ice Cream',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: i.courseSequence,
          prepTimeMinutes: i.prepTimeMinutes,
          targetFireAt: i.targetFireAt,
          holdStatus: i.holdStatus,
          itemStatus: 'PENDING' as const,
          paidAt: t03PaidAt.toISOString(),
        })),
      ];

      // Sort deterministically with Smart Kitchen sort algorithm
      const sorted = sortKdsItemTickets(allTickets);

      // Requirement 3: All 3 Biryanis MUST appear at the top of the KDS queue!
      expect(sorted[0].dishName).toBe('Dum Biryani');
      expect(sorted[0].holdStatus).toBe('ACTIVE');
      expect(sorted[1].dishName).toBe('Dum Biryani');
      expect(sorted[1].holdStatus).toBe('ACTIVE');
      expect(sorted[2].dishName).toBe('Dum Biryani');
      expect(sorted[2].holdStatus).toBe('ACTIVE');

      // The subsequent items must be the held items (Coffee and Ice Cream)
      const nonBiryaniItems = sorted.slice(3);
      for (const ticket of nonBiryaniItems) {
        expect(ticket.holdStatus).toBe('SERVE_LATER_HOLD');
      }
    });

    it('proves a scheduled order for 2 hours later stays in SCHEDULED_WAIT until its target_fire_at arrives', () => {
      const now = new Date('2026-11-18T12:00:00.000Z');
      const scheduledFor = new Date('2026-11-18T14:00:00.000Z'); // 2 hours later (120 mins)

      const items = [
        { id: 'sched-biryani', courseSequence: 2, prepTimeMinutes: 28, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 'sched-gulabjamun', courseSequence: 3, prepTimeMinutes: 10, status: 'PENDING', holdStatus: 'ACTIVE' as const },
      ];

      const scheduled = scheduleOrderItems(
        { orderType: 'PRE_BOOK_DINE_IN', scheduledFor, paidAt: now, items },
        now,
      );

      const biryani = scheduled.find((i) => i.id === 'sched-biryani')!;
      // Target serve at = 14:00
      // Target fire at = 14:00 - 28m - 2m = 13:30 (90 mins from now)
      expect(new Date(biryani.targetFireAt).toISOString()).toBe('2026-11-18T13:30:00.000Z');

      // Because target_fire_at (13:30) > now + 5 min (12:05), it must be SCHEDULED_WAIT
      expect(biryani.holdStatus).toBe('SCHEDULED_WAIT');

      // When the clock advances to 13:30 (target_fire_at), recalculating promotes it to ACTIVE
      const futureTime = new Date('2026-11-18T13:30:00.000Z');
      const promoted = scheduleOrderItems(
        {
          orderType: 'PRE_BOOK_DINE_IN',
          scheduledFor,
          paidAt: now,
          items: [{ ...items[0], holdStatus: biryani.holdStatus }],
        },
        futureTime,
      );
      expect(promoted[0].holdStatus).toBe('ACTIVE');
    });

    it('proves TAKEAWAY orders do not hold desserts/beverages and synchronize all courses to pickup time', () => {
      const now = new Date('2026-11-18T12:00:00.000Z');
      const items = [
        { id: 'takeaway-biryani', courseSequence: 2, prepTimeMinutes: 25, status: 'PENDING', holdStatus: 'ACTIVE' as const },
        { id: 'takeaway-shake', courseSequence: 4, prepTimeMinutes: 5, status: 'PENDING', holdStatus: 'ACTIVE' as const },
      ];

      const scheduled = scheduleOrderItems(
        { orderType: 'TAKEAWAY', scheduledFor: null, paidAt: now, items },
        now,
      );

      const biryani = scheduled.find((i) => i.id === 'takeaway-biryani')!;
      const shake = scheduled.find((i) => i.id === 'takeaway-shake')!;

      // TAKEAWAY: Items are NOT in SERVE_LATER_HOLD
      expect(biryani.holdStatus).toBe('ACTIVE');
      expect(shake.holdStatus).not.toBe('SERVE_LATER_HOLD');
      // Shake has 5m prep, so with 25m biryani target serve time, target_fire_at is at minute 18 (> now + 5m -> SCHEDULED_WAIT)
      expect(shake.holdStatus).toBe('SCHEDULED_WAIT');
      expect(shake.targetFireAt.toISOString()).toBe('2026-11-18T12:18:00.000Z');
    });

    it('proves serve-later auto-prompter evaluates prompt timing accurately', () => {
      const now = new Date('2026-11-18T12:20:00.000Z');
      const itemsWithHold = [
        { courseSequence: 3, holdStatus: 'SERVE_LATER_HOLD' as const, status: 'PENDING' },
      ];
      const itemsAllServed = [
        { courseSequence: 3, holdStatus: 'RELEASED' as const, status: 'SERVED' },
      ];

      // 1. Should NOT prompt if main courses are not yet served
      expect(
        shouldSendServeLaterPrompt({
          mainCourseServedAt: null,
          serveLaterPromptSentAt: null,
          items: itemsWithHold,
          referenceNow: now,
        }),
      ).toBe(false);

      // 2. Should NOT prompt if main courses were served only 5 minutes ago (< 15 min threshold)
      const served5MinAgo = new Date('2026-11-18T12:15:00.000Z');
      expect(
        shouldSendServeLaterPrompt({
          mainCourseServedAt: served5MinAgo,
          serveLaterPromptSentAt: null,
          items: itemsWithHold,
          referenceNow: now,
        }),
      ).toBe(false);

      // 3. Should prompt if main courses were served 16 minutes ago (>= 15 min threshold) and unreleased holds exist
      const served16MinAgo = new Date('2026-11-18T12:04:00.000Z');
      expect(
        shouldSendServeLaterPrompt({
          mainCourseServedAt: served16MinAgo,
          serveLaterPromptSentAt: null,
          items: itemsWithHold,
          referenceNow: now,
        }),
      ).toBe(true);

      // 4. Should NOT prompt if prompt was already sent
      expect(
        shouldSendServeLaterPrompt({
          mainCourseServedAt: served16MinAgo,
          serveLaterPromptSentAt: new Date('2026-11-18T12:19:00.000Z'),
          items: itemsWithHold,
          referenceNow: now,
        }),
      ).toBe(false);

      // 5. Should NOT prompt if there are no unreleased holds remaining
      expect(
        shouldSendServeLaterPrompt({
          mainCourseServedAt: served16MinAgo,
          serveLaterPromptSentAt: null,
          items: itemsAllServed,
          referenceNow: now,
        }),
      ).toBe(false);
    });
  });

  // ============================================================================
  // 2. P0 Strict Payment Quarantine (Zero-Leak Payment Gate)
  // ============================================================================

  describe('2. P0 Strict Payment Quarantine Gate', () => {
    let ordersService: OrdersService;
    let kitchenService: KitchenSchedulerService;

    beforeEach(() => {
      ordersService = new OrdersService();
      kitchenService = new KitchenSchedulerService();
    });

    it('proves unpaid or cancelled orders NEVER appear in GET /api/v1/console/orders (listOrders)', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId1,
              status: 'CONFIRMED',
              payment_status: 'PAID',
              payment_method: 'UPI',
              created_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId1,
              name_snapshot: 'Butter Chicken',
              status: 'PENDING',
              course_sequence: 2,
              prep_time_minutes: 15,
              target_fire_at: null,
              hold_status: 'ACTIVE',
              created_at: new Date().toISOString(),
            },
          ],
        });

      const orders = await ordersService.listOrders(orgId, { limit: 10, offset: 0 });

      expect(orders).toHaveLength(1);
      expect(orders[0].id).toBe(orderId1);

      // Inspect the executed SQL query for strict quarantine filtering
      const executedSql = queryMock.mock.calls[0]?.[0] as string;
      expect(executedSql).toContain("status NOT IN ('AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED')");
      expect(executedSql).toContain("(o.payment_status = 'PAID' OR o.payment_method = 'CASH_APPROVED')");
    });

    it('proves unpaid orders NEVER appear in GET /api/v1/console/kds/items (getFlattenedKdsItems)', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            itemId: itemId1,
            orderId: orderId1,
            orderDisplayId: 'ORD-101',
            orderType: 'DINE_IN',
            tableNumber: 'T01',
            scheduledFor: null,
            dishName: 'Hyderabadi Biryani',
            quantity: 1,
            modifiers: [],
            spiceLevel: 'MEDIUM',
            notes: null,
            isComboItem: false,
            comboName: null,
            courseSequence: 2,
            prepTimeMinutes: 25,
            targetFireAt: new Date().toISOString(),
            holdStatus: 'ACTIVE',
            itemStatus: 'PENDING',
            paidAt: new Date().toISOString(),
          },
        ],
      });

      const items = await kitchenService.getFlattenedKdsItems(orgId, outletId);

      expect(items).toHaveLength(1);
      expect(items[0].dishName).toBe('Hyderabadi Biryani');

      // Verify SQL contains forced payment_status = 'PAID' quarantine
      const executedSql = queryMock.mock.calls[0]?.[0] as string;
      expect(executedSql).toContain("o.payment_status = 'PAID'");
      expect(executedSql).toContain("o.status NOT IN ('AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED', 'CANCELLED', 'BILLED')");
    });

    it('proves trying to PATCH an unpaid order item to PREPARING returns 409 Conflict', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            status: 'PENDING',
            order_id: orderId1,
            payment_status: 'PENDING',
            payment_method: 'UPI',
          },
        ],
      });

      await expect(
        ordersService.updateItemStatus(
          orgId,
          orderId1,
          itemId1,
          { status: 'PREPARING' },
          'KDS_STAFF',
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('Cannot prepare an unpaid order'),
      });
    });

    it('proves trying to PATCH an unpaid order status to PREPARING returns 409 Conflict', async () => {
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            status: 'PENDING',
            payment_status: 'PENDING',
            payment_method: 'UPI',
            outlet_id: outletId,
          },
        ],
      });

      await expect(
        ordersService.updateOrderStatus(
          orgId,
          orderId1,
          { status: 'PREPARING' },
          'KDS_STAFF',
          'STAFF',
        ),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('Cannot prepare an unpaid order'),
      });
    });

    it('proves PATCHing an order item to PREPARING succeeds when payment_status is PAID', async () => {
      queryMock
        .mockResolvedValueOnce({
          rows: [{ status: 'PENDING', order_id: orderId1, payment_status: 'PAID' }],
        })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 }) // update order_items
        .mockResolvedValueOnce({ rows: [{ status: 'PREPARING' }] }) // select items
        .mockResolvedValueOnce({ rows: [{ status: 'CONFIRMED' }] }) // select order
        .mockResolvedValueOnce({ rows: [] }) // update orders
        .mockResolvedValueOnce({ rows: [] }) // outbox STATUS_CHANGED
        .mockResolvedValueOnce({ rows: [] }) // order_events ITEM_STATUS_CHANGED
        .mockResolvedValueOnce({ rows: [] }) // outbox ITEM_STATUS_CHANGED
        .mockResolvedValueOnce({ rows: [{ id: orderId1, status: 'PREPARING', table_number: 'T01' }] })
        .mockResolvedValueOnce({
          rows: [{ id: itemId1, name_snapshot: 'Butter Chicken', status: 'PREPARING', created_at: new Date().toISOString() }],
        });

      const res = await ordersService.updateItemStatus(
        orgId,
        orderId1,
        itemId1,
        { status: 'PREPARING' },
        'KDS_STAFF',
      );

      expect(res.status).toBe('PREPARING');
    });
  });

  // ============================================================================
  // 3. Table Reservation Availability & Snooze
  // ============================================================================

  describe('3. Table Reservations & Snooze', () => {
    let kitchenService: KitchenSchedulerService;

    beforeEach(() => {
      kitchenService = new KitchenSchedulerService();
    });

    it('proves table availability check combines tables when single table is insufficient', async () => {
      const reservedFor = new Date('2026-11-18T19:00:00.000Z');

      // checkAvailability calls pool.query for tables and conflicting reservations
      poolQueryMock
        .mockResolvedValueOnce({
          rows: [
            { id: '11111111-0000-0000-0000-000000000001', table_number: 'T01', capacity: 4, section: 'INDOOR' },
            { id: '11111111-0000-0000-0000-000000000002', table_number: 'T02', capacity: 4, section: 'INDOOR' },
            { id: '11111111-0000-0000-0000-000000000003', table_number: 'T03', capacity: 2, section: 'INDOOR' },
          ],
        })
        .mockResolvedValueOnce({
          rows: [], // No conflicting reservations
        });

      // Request for 6 guests: Cannot fit on single table (max 4), so should combine tables
      const result = await kitchenService.checkAvailability(
        orgId,
        {
          outlet_id: outletId,
          guest_count: 6,
          reserved_for: reservedFor.toISOString(),
        },
      );

      expect(result.available).toBe(true);
      expect(result.total_capacity).toBeGreaterThanOrEqual(6);
      expect(result.tables.length).toBeGreaterThanOrEqual(2);
    });

    it('proves table availability returns unavailable when all matching tables are booked', async () => {
      const reservedFor = new Date('2026-11-18T19:00:00.000Z');

      poolQueryMock
        .mockResolvedValueOnce({
          rows: [{ id: '11111111-0000-0000-0000-000000000001', table_number: 'T01', capacity: 2, section: 'INDOOR' }],
        })
        .mockResolvedValueOnce({
          rows: [{ assigned_table_ids: ['11111111-0000-0000-0000-000000000001'] }], // Conflicting reservation
        });

      const result = await kitchenService.checkAvailability(
        orgId,
        {
          outlet_id: outletId,
          guest_count: 2,
          reserved_for: reservedFor.toISOString(),
        },
      );

      expect(result.available).toBe(false);
      expect(result.tables).toHaveLength(0);
    });

    it('proves snoozeServeLater postpones the auto-prompt by 10 minutes', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: orderId1 }] }) // UPDATE orders RETURNING id
        .mockResolvedValueOnce({ rows: [] }); // INSERT order_events

      const res = await kitchenService.snoozeServeLater(orgId, orderId1, 10);

      expect(res.success).toBe(true);
      expect(queryMock).toHaveBeenCalled();
      const executedSql = queryMock.mock.calls[0]?.[0] as string;
      expect(executedSql).toContain('UPDATE orders');
      expect(executedSql).toContain('main_course_served_at');
    });
  });

  // ============================================================================
  // 4. Abandoned Checkout Expiry Cleanup Job
  // ============================================================================

  describe('4. Abandoned Checkout Expiry Cleanup Job', () => {
    let cleanupService: PaymentExpiryCleanupService;

    beforeEach(() => {
      cleanupService = new PaymentExpiryCleanupService();
    });

    it('proves cleanup job expires orders older than 15 minutes and cancels pending reservations', async () => {
      const reservationId = '44444444-4444-4444-4444-444444444444';

      // 1. poolQuery returns expired orders
      poolQueryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId1,
              org_id: orgId,
              reservation_id: reservationId,
              created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(), // 20m ago
            },
          ],
        });

      // 2. withTenantContextRaw queryMock
      queryMock
        .mockResolvedValueOnce({ rows: [] }) // UPDATE orders status = PAYMENT_EXPIRED
        .mockResolvedValueOnce({ rows: [] }) // UPDATE table_reservations status = CANCELLED
        .mockResolvedValueOnce({ rows: [] }) // INSERT order_events PAYMENT_EXPIRED
        .mockResolvedValueOnce({ rows: [] }); // INSERT outbox_events ORDER_EXPIRED

      const expiredCount = await cleanupService.cleanupExpiredCheckouts();

      expect(expiredCount).toBe(1);

      // Check pool query for order expiration & 15-minute threshold
      const updateOrderCall = poolQueryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes("status = 'PAYMENT_EXPIRED'"),
      );
      expect(updateOrderCall).toBeDefined();
      expect(updateOrderCall![0]).toContain("status = 'AWAITING_PAYMENT'");
      expect(updateOrderCall![0]).toContain("created_at < now() - ($1 || ' minutes')::interval");

      // Check pool query for reservation cancellation
      const cancelReservationCall = poolQueryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes("status = 'CANCELLED'"),
      );
      expect(cancelReservationCall).toBeDefined();

      // Check tenant context audit events
      const orderEventCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes("ORDER_PAYMENT_EXPIRED"),
      );
      expect(orderEventCall).toBeDefined();
    });
  });
});
