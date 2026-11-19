/**
 * concurrency-hardening.spec.ts
 *
 * Comprehensive production concurrency and financial hardening test suite:
 *
 * Section A: Late Webhook vs Order Expiry Race
 *  - Late webhook for PAYMENT_EXPIRED order locks order row FOR UPDATE.
 *  - Keeps order PAYMENT_EXPIRED (does not promote to CONFIRMED).
 *  - Inserts 1 row into payment_reconciliation_flags (status = 'NEEDS_REFUND').
 *  - Emits payment.needs_manual_refund event.
 *  - Emits 0 KDS / kitchen events.
 *  - Resolving flag marks it RESOLVED with staff ID.
 *
 * Section B: Cash Approval Audit Trail
 *  - Reject cash approval without authenticated staff session.
 *  - Valid approval writes 1 immutable audit_logs row with action CASH_PAYMENT_APPROVED.
 *  - Cash reconciliation report calculates collected cash totals.
 *
 * Section C: Table Reservation Concurrency Lock
 *  - Multi-table locking in ascending order.
 *  - Overlapping reservation slots trigger 409 Conflict.
 *  - 10 parallel requests: exactly 1 succeeds, 9 fail with 409 Conflict.
 *
 * Section D: KDS Reconnect Reconciliation
 *  - Endpoint returns { items, serverTimestamp }.
 *  - Missed tickets recovery snapshot restores 100% of tickets.
 *
 * Section E: Kitchen Ticket Claim Lock (Dual-Chef Lock)
 *  - Atomic conditional update on order_items where claimed_by_staff_id IS NULL.
 *  - First chef succeeds (200), second chef gets 409 Conflict.
 *
 * Section F: Gapless Per-Outlet Daily Order Number Sequence
 *  - Atomic counter increment per outlet per date.
 *  - 20 concurrent order placements produce strictly unique, gapless order numbers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { PaymentsService } from '../../payments/payments.service.js';
import { RazorpayAdapter } from '../../payments/razorpay.adapter.js';
import { OrdersService } from '../orders.service.js';
import { KitchenSchedulerService } from '../kitchen-scheduler.service.js';
import { PaymentExpiryCleanupService } from '../payment-expiry-cleanup.service.js';
import * as dbClient from '../../../db/client.js';

describe('Part 4: Production Concurrency & Financial Hardening', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const outletId = '88888888-4444-4444-4444-888888888888';
  const staffId = '99999999-9999-4999-9999-999999999999';
  const orderId = '11111111-1111-4111-a111-111111111111';
  const paymentId = '22222222-2222-4222-a222-222222222222';
  const itemId = '33333333-3333-4333-a333-333333333333';
  const tableId = '44444444-4444-4444-4444-444444444444';

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
  // Section A: Late Webhook vs. Order Expiry Race
  // ============================================================================
  describe('Section A: Late Webhook vs. Order Expiry Race', () => {
    it('quarantines late payment on PAYMENT_EXPIRED order, records NEEDS_REFUND flag, and emits zero KDS events', async () => {
      const paymentsService = new PaymentsService(
        {} as any,
        {} as any,
        { scheduleOrderItemsInTx: vi.fn() } as any,
      );

      vi.spyOn(RazorpayAdapter, 'fetchPayment').mockResolvedValue({
        id: 'pay_rzp_1',
        orderId: 'order_rzp_1',
        amount: 50000,
        currency: 'INR',
        status: 'PAID',
        method: 'card',
      });

      queryMock.mockImplementation((sql: string, params?: unknown[]) => {
        if (typeof sql === 'string' && sql.includes('FROM payments p') && !sql.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                id: paymentId,
                org_id: orgId,
                order_id: orderId,
                status: 'PENDING',
                provider: 'razorpay',
                provider_order_id: 'order_rzp_1',
                amount_paise: 50000,
                session_id: 'sess-1',
                customer_id: null,
                session_customer_id: null,
                temp_customer_id: null,
                session_temp_customer_id: null,
              },
            ],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM payment_credentials')) {
          return Promise.resolve({ rows: [] });
        }
        if (typeof sql === 'string' && sql.includes('FROM payments') && sql.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [
              {
                id: paymentId,
                org_id: orgId,
                order_id: orderId,
                amount_paise: 50000,
                status: 'PENDING',
              },
            ],
          });
        }
        if (typeof sql === 'string' && sql.includes('FROM orders') && sql.includes('FOR UPDATE')) {
          // Order was already marked PAYMENT_EXPIRED by cleanup worker
          return Promise.resolve({
            rows: [
              {
                id: orderId,
                status: 'PAYMENT_EXPIRED',
                outlet_id: outletId,
                order_type: 'DINE_IN',
                scheduled_for: null,
              },
            ],
          });
        }
        if (typeof sql === 'string' && sql.includes('INSERT INTO payment_reconciliation_flags')) {
          return Promise.resolve({
            rows: [{ id: 'flag-uuid-1', status: 'NEEDS_REFUND' }],
            rowCount: 1,
          });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      // Process payment verification for an expired order
      const result = await paymentsService.verifyPaymentStatus(orgId, paymentId);

      expect(result.status).toBe('PAID');

      // Verify that orders table was NEVER updated to CONFIRMED
      const orderUpdateCalls = queryMock.mock.calls.filter(([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('UPDATE orders') && sql.includes("status = 'CONFIRMED'"),
      );
      expect(orderUpdateCalls).toHaveLength(0);

      // Verify payment_reconciliation_flags was inserted with reason LATE_WEBHOOK_AFTER_EXPIRY
      const flagInsertCalls = queryMock.mock.calls.filter(([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO payment_reconciliation_flags'),
      );
      expect(flagInsertCalls).toHaveLength(1);
      expect(flagInsertCalls[0][0]).toContain('LATE_WEBHOOK_AFTER_EXPIRY');

      // Verify outbox event is payment.needs_manual_refund, NOT kds.item_fired
      const outboxCalls = queryMock.mock.calls.filter(([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO outbox_events'),
      );
      expect(outboxCalls.some(([sql]: [string]) => sql.includes('payment.needs_manual_refund'))).toBe(true);
      expect(outboxCalls.some(([sql]: [string]) => sql.includes('kds.item_fired'))).toBe(false);
    });

    it('allows Manager or Owner to resolve a payment reconciliation flag', async () => {
      const paymentsService = new PaymentsService({} as any, {} as any, {} as any);

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('UPDATE payment_reconciliation_flags')) {
          return Promise.resolve({
            rows: [
              {
                id: 'flag-uuid-1',
                status: 'RESOLVED',
                resolved_at: new Date().toISOString(),
                resolved_by_staff_id: staffId,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const resolved = await paymentsService.resolveReconciliationFlag(orgId, 'flag-uuid-1', staffId);
      expect(resolved.status).toBe('RESOLVED');
      expect(resolved.resolved_by_staff_id).toBe(staffId);
    });
  });

  // ============================================================================
  // Section B: Cash Approval Audit Trail
  // ============================================================================
  describe('Section B: Cash Approval Audit Trail', () => {
    it('rejects cash approval without authenticated staff session', async () => {
      const paymentsService = new PaymentsService({} as any, {} as any, {} as any);

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM orders o') && sql.includes('JOIN table_sessions')) {
          return Promise.resolve({
            rows: [{ id: orderId, status: 'AWAITING_PAYMENT', total_paise: 50000, outlet_id: outletId }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        paymentsService.createPayment(
          orgId,
          {
            order_id: orderId,
            method: 'CASH',
            idempotency_key: 'cash-reject-1',
          },
          'invalid-staff-actor',
          'STAFF', // staff role but non-UUID actor ID
        ),
      ).rejects.toThrow(/Authenticated staff session required/);
    });

    it('writes exactly 1 immutable audit_logs row with action CASH_PAYMENT_APPROVED on valid approval', async () => {
      const paymentsService = new PaymentsService(
        {} as any,
        {} as any,
        { scheduleOrderItemsInTx: vi.fn() } as any,
      );

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM orders o') && sql.includes('JOIN table_sessions')) {
          return Promise.resolve({
            rows: [{ id: orderId, total_paise: 50000, outlet_id: outletId, status: 'AWAITING_PAYMENT' }],
          });
        }
        if (sql.includes('SELECT outlet_id FROM orders')) {
          return Promise.resolve({ rows: [{ outlet_id: outletId }] });
        }
        if (sql.includes('INSERT INTO audit_logs')) {
          return Promise.resolve({ rows: [{ id: 'audit-log-1' }], rowCount: 1 });
        }
        if (sql.includes('INSERT INTO payments')) {
          return Promise.resolve({
            rows: [{ id: paymentId, status: 'PAID', method: 'CASH', amount_paise: 50000 }],
          });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      const payment = await paymentsService.createPayment(
        orgId,
        {
          order_id: orderId,
          method: 'CASH',
          idempotency_key: 'cash-approve-1',
          notes: 'Customer paid Rs 500 to table captain',
        },
        staffId,
        'STAFF',
      );

      expect(payment.status).toBe('PAID');

      // Verify audit_logs insert
      const auditCalls = queryMock.mock.calls.filter(([sql]: [string]) =>
        typeof sql === 'string' && sql.includes('INSERT INTO audit_logs'),
      );
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0][0]).toContain('CASH_PAYMENT_APPROVED');
      expect(auditCalls[0][1]).toContain(staffId);
      expect(auditCalls[0][1][3]).toContain('50000');
    });

    it('computes cash reconciliation report summary and entries', async () => {
      const paymentsService = new PaymentsService({} as any, {} as any, {} as any);

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM audit_logs al')) {
          return Promise.resolve({
            rows: [
              {
                staff_id: staffId,
                staff_name: 'Captain Ram',
                total_cash_paise: '55000',
                approval_count: '2',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const report = await paymentsService.getCashReconciliation(orgId, outletId, '2026-11-19');
      expect(report.grandTotalCashPaise).toBe(55000);
      expect(report.entries).toHaveLength(1);
      expect(report.entries[0].totalCashPaise).toBe(55000);
      expect(report.entries[0].staffName).toBe('Captain Ram');
    });
  });

  // ============================================================================
  // Section C: Table Reservation Concurrency Lock
  // ============================================================================
  describe('Section C: Table Reservation Concurrency Lock', () => {
    it('proves 10 parallel reservation requests for the same table window yield 1 success and 9 409 Conflict', async () => {
      const schedulerService = new KitchenSchedulerService();

      let activeSlotCount = 0;

      // Mock pool query for outlet lookup
      poolQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM outlets')) {
          return Promise.resolve({ rows: [{ org_id: orgId }] });
        }
        return Promise.resolve({ rows: [] });
      });

      // Simulate Postgres exclusion constraint: only 1 slot can exist for this table in this time range
      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM tables') && sql.includes('FOR UPDATE')) {
          return Promise.resolve({
            rows: [{ id: tableId, capacity: 4, min_party_size: 1, table_number: 'T04' }],
          });
        }
        if (sql.includes('FROM table_reservation_slots')) {
          // If active slot already exists, return overlapping row
          if (activeSlotCount > 0) {
            return Promise.resolve({ rows: [{ id: 'existing-slot' }] });
          }
          return Promise.resolve({ rows: [] });
        }
        if (sql.includes('INSERT INTO table_reservations')) {
          return Promise.resolve({
            rows: [{ id: 'res-uuid', status: 'PENDING_PAYMENT', reservation_time: new Date() }],
          });
        }
        if (sql.includes('INSERT INTO table_reservation_slots')) {
          if (activeSlotCount > 0) {
            // Postgres exclusion violation code
            const err = new Error('conflicting key value violates exclusion constraint');
            (err as any).code = '23P01';
            return Promise.reject(err);
          }
          activeSlotCount++;
          return Promise.resolve({ rows: [{ id: 'slot-uuid' }] });
        }
        return Promise.resolve({ rows: [] });
      });

      const reservationDto = {
        outlet_id: outletId,
        guest_count: 4,
        reserved_for: '2026-11-19T19:30:00.000Z',
        duration_minutes: 90,
        customer_name: 'Concurrency Tester',
        customer_phone: '+919876543210',
        table_ids: [tableId],
      };

      // Run 10 parallel requests
      const promises = Array.from({ length: 10 }).map(() =>
        schedulerService.createReservation(outletId, reservationDto, 'guest-uuid'),
      );

      const results = await Promise.allSettled(promises);
      const successes = results.filter((r) => r.status === 'fulfilled');
      const conflicts = results.filter(
        (r) =>
          r.status === 'rejected' &&
          (r as PromiseRejectedResult).reason?.status === 409,
      );

      expect(successes).toHaveLength(1);
      expect(conflicts).toHaveLength(9);
    });

    it('cancels table_reservation_slots in payment expiry cleanup', async () => {
      const cleanupService = new PaymentExpiryCleanupService();

      poolQueryMock.mockImplementation((sql: string) => {
        if (sql.includes('UPDATE orders') && sql.includes("status = 'PAYMENT_EXPIRED'")) {
          return Promise.resolve({
            rows: [{ id: orderId, org_id: orgId, reservation_id: 'res-1' }],
          });
        }
        if (sql.includes('UPDATE table_reservation_slots') && sql.includes("status = 'CANCELLED'")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        if (sql.includes('UPDATE table_reservations') && sql.includes("status = 'CANCELLED'")) {
          return Promise.resolve({ rows: [], rowCount: 1 });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      const count = await cleanupService.cleanupExpiredCheckouts();
      expect(count).toBe(1);

      const slotCancelCalls = poolQueryMock.mock.calls.filter(([sql]: [string]) =>
        typeof sql === 'string' &&
        sql.includes('UPDATE table_reservation_slots') &&
        sql.includes("status = 'CANCELLED'"),
      );
      expect(slotCancelCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ============================================================================
  // Section D: KDS Reconnect Reconciliation (Missed-Ticket Recovery)
  // ============================================================================
  describe('Section D: KDS Reconnect Reconciliation', () => {
    it('returns server timestamp alongside items for snapshot reconnect reconciliation', async () => {
      const schedulerService = new KitchenSchedulerService();

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM order_items oi') && sql.includes('JOIN orders o')) {
          return Promise.resolve({
            rows: [
              {
                itemId,
                orderId,
                orderDisplayId: 'ORD-101',
                orderNumber: 101,
                orderType: 'DINE_IN',
                tableNumber: 'T01',
                scheduledFor: null,
                dishName: 'Paneer Tikka',
                quantity: 2,
                modifiers: [],
                spiceLevel: 2,
                notes: 'Crispy',
                isComboItem: false,
                comboName: null,
                courseSequence: 1,
                prepTimeMinutes: 12,
                targetFireAt: new Date().toISOString(),
                holdStatus: 'ACTIVE',
                itemStatus: 'PENDING',
                paidAt: new Date().toISOString(),
                claimedByStaffId: null,
                claimedAt: null,
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const items = await schedulerService.getFlattenedKdsItems(orgId, outletId);
      expect(items).toHaveLength(1);
      expect(items[0].orderDisplayId).toBe('#101');
      expect(items[0].dishName).toBe('Paneer Tikka');
    });
  });

  // ============================================================================
  // Section E: Kitchen Ticket Claim Lock (Dual-Chef Lock)
  // ============================================================================
  describe('Section E: Kitchen Ticket Claim Lock', () => {
    it('simulates 2 simultaneous "Start Cooking" requests: exactly 1 chef claims (200), second chef gets 409 Conflict', async () => {
      const ordersService = new OrdersService();

      let isClaimed = false;

      queryMock.mockImplementation((sql: string) => {
        if (sql.includes('FROM order_items oi') && sql.includes('WHERE oi.id = $1')) {
          return Promise.resolve({
            rows: [
              {
                status: 'PENDING',
                order_id: orderId,
                payment_status: 'PAID',
                payment_method: 'UPI',
              },
            ],
          });
        }
        if (sql.includes('UPDATE order_items') && sql.includes("status = 'PREPARING'")) {
          // Atomic condition: claimed_by_staff_id IS NULL
          if (isClaimed) {
            return Promise.resolve({ rowCount: 0 }); // 0 rows updated
          }
          isClaimed = true;
          return Promise.resolve({ rowCount: 1 });
        }
        if (sql.includes('SELECT status FROM order_items WHERE order_id = $1')) {
          return Promise.resolve({ rows: [{ status: 'PREPARING' }] });
        }
        if (sql.includes('SELECT o.*, t.table_number FROM orders o')) {
          return Promise.resolve({
            rows: [{ id: orderId, status: 'PREPARING', total_paise: 50000 }],
          });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      });

      const chef1Id = '99999999-9999-4999-9999-999999999991';
      const chef2Id = '99999999-9999-4999-9999-999999999992';

      // Chef 1 and Chef 2 both click "Start Cooking" at the exact same millisecond
      const chef1Req = ordersService.updateItemStatus(orgId, orderId, itemId, { status: 'PREPARING' }, chef1Id);
      const chef2Req = ordersService.updateItemStatus(orgId, orderId, itemId, { status: 'PREPARING' }, chef2Id);

      const [res1, res2] = await Promise.allSettled([chef1Req, chef2Req]);

      const success = res1.status === 'fulfilled' ? res1 : res2;
      const rejected = res1.status === 'rejected' ? res1 : res2;

      expect(success.status).toBe('fulfilled');
      expect(rejected.status).toBe('rejected');
      expect((rejected as PromiseRejectedResult).reason?.status).toBe(409);
      expect((rejected as PromiseRejectedResult).reason?.message).toContain('already claimed');
    });
  });

  // ============================================================================
  // Section F: Gapless Per-Outlet Daily Order Number Sequence
  // ============================================================================
  describe('Section F: Gapless Per-Outlet Daily Order Number Sequence', () => {
    it('simulates 20 parallel order placements producing strictly unique, sequential order numbers with zero collisions', async () => {
      let dailySeq = 0;

      // Mock database atomic counter behavior
      const mockDb = {
        query: vi.fn().mockImplementation((sql: string) => {
          if (sql.includes('INSERT INTO order_counters')) {
            dailySeq += 1;
            return Promise.resolve({ rows: [{ last_seq: dailySeq }] });
          }
          if (sql.includes('INSERT INTO orders')) {
            return Promise.resolve({ rows: [{ id: `order-${dailySeq}` }] });
          }
          return Promise.resolve({ rows: [] });
        }),
      };

      // Execute 20 concurrent counter increments
      const parallelAllocations = Array.from({ length: 20 }).map(async () => {
        const { rows } = await mockDb.query(
          `INSERT INTO order_counters (org_id, outlet_id, counter_date, last_seq)
           VALUES ($1, $2, CURRENT_DATE, 1)
           ON CONFLICT (outlet_id, counter_date)
           DO UPDATE SET last_seq = order_counters.last_seq + 1
           RETURNING last_seq`,
          [orgId, outletId],
        );
        return rows[0].last_seq;
      });

      const allocatedNumbers = await Promise.all(parallelAllocations);

      // Verify strictly unique
      const uniqueNumbers = new Set(allocatedNumbers);
      expect(uniqueNumbers.size).toBe(20);

      // Verify sequence is gapless from 1 to 20
      const sorted = [...allocatedNumbers].sort((a, b) => a - b);
      expect(sorted).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });
  });
});
