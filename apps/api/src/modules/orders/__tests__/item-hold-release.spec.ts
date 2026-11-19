import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { OrdersService } from '../orders.service.js';
import * as dbClient from '../../../db/client.js';

describe('Customer Serve Later -> Kitchen Now Item Release', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const outletId = '71ad00a6-d79b-4035-b563-bf9543fcfa86';
  const sessionId = '20000000-0000-4000-8000-000000000001';
  const orderId = '20000000-0000-4000-8000-000000000002';
  const itemId = '20000000-0000-4000-8000-000000000003';
  const customerId = '20000000-0000-4000-8000-000000000004';

  let queryMock: ReturnType<typeof vi.fn>;
  let poolQueryMock: ReturnType<typeof vi.fn>;
  let ordersService: OrdersService;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock = vi.fn();
    poolQueryMock = vi.fn();

    vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQueryMock } as unknown as Pool);
    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
        fn({ query: queryMock } as unknown as PoolClient),
    );

    ordersService = new OrdersService();
  });

  it('successfully releases hold on an item, appends [RELEASED_TO_KITCHEN], and keeps status CONFIRMED (NOT PREPARING)', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ resolve_order_org: orgId }] });

    queryMock
      // 1. Order lookup
      .mockResolvedValueOnce({
        rows: [
          {
            id: orderId,
            outlet_id: outletId,
            table_id: 'table-uuid',
            session_id: sessionId,
            customer_id: customerId,
            status: 'CONFIRMED',
            payment_status: 'PAID',
            display_id: 'ORD-0001',
          },
        ],
      })
      // 2. Session verification
      .mockResolvedValueOnce({
        rows: [{ customer_id: customerId, temp_customer_id: null }],
      })
      // 3. Item lookup
      .mockResolvedValueOnce({
        rows: [
          {
            id: itemId,
            order_id: orderId,
            name_snapshot: 'Filter Coffee',
            notes: 'Strong brew, less sugar',
            status: 'PENDING',
            hold_status: 'SERVE_LATER_HOLD',
          },
        ],
      })
      // 4. Update order_items
      .mockResolvedValueOnce({ rowCount: 1 })
      // 5. Insert order_events
      .mockResolvedValueOnce({ rowCount: 1 })
      // 6. Insert outbox_events (kds.item_fired)
      .mockResolvedValueOnce({ rowCount: 1 })
      // 7. Insert outbox_events (ORDER_ITEM_RELEASED)
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await ordersService.releaseItemHold(
      orgId,
      orderId,
      itemId,
      customerId,
      { customerId, sessionId },
    );

    expect(result.id).toBe(itemId);
    expect(result.status).toBe('CONFIRMED');
    expect(result.hold_status).toBe('RELEASED');
    expect(result.notes).toContain('Strong brew, less sugar');
    expect(result.notes).toContain('[RELEASED_TO_KITCHEN]');
    expect(result.is_released).toBe(true);

    // Verify SQL update call
    const updateCall = queryMock.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE order_items'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall![1][0]).toContain('[RELEASED_TO_KITCHEN]');
    expect(updateCall![1][1]).toBe('CONFIRMED');

    // Verify audit event
    const eventCall = queryMock.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('ITEM_RELEASED_FROM_HOLD'),
    );
    expect(eventCall).toBeDefined();

    // Verify outbox event
    const outboxCall = queryMock.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('ORDER_ITEM_RELEASED'),
    );
    expect(outboxCall).toBeDefined();
  });

  it('is idempotent and does not duplicate [RELEASED_TO_KITCHEN] in notes', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ resolve_order_org: orgId }] });

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: orderId,
            outlet_id: outletId,
            table_id: 'table-uuid',
            session_id: sessionId,
            customer_id: customerId,
            status: 'PREPARING',
            payment_status: 'PAID',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ customer_id: customerId, temp_customer_id: null }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: itemId,
            order_id: orderId,
            name_snapshot: 'Filter Coffee',
            notes: 'Strong brew · [RELEASED_TO_KITCHEN]',
            status: 'PREPARING',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 })
      .mockResolvedValueOnce({ rowCount: 1 });

    const result = await ordersService.releaseItemHold(
      orgId,
      orderId,
      itemId,
      customerId,
      { customerId, sessionId },
    );

    expect(result.notes).toBe('Strong brew · [RELEASED_TO_KITCHEN]');
    expect(result.status).toBe('PREPARING');
  });

  it('rejects hold release if order is already BILLED', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ resolve_order_org: orgId }] });

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: orderId,
            outlet_id: outletId,
            table_id: 'table-uuid',
            session_id: sessionId,
            customer_id: customerId,
            status: 'BILLED',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ customer_id: customerId, temp_customer_id: null }],
      });

    await expect(
      ordersService.releaseItemHold(orgId, orderId, itemId, customerId, {
        customerId,
        sessionId,
      }),
    ).rejects.toThrow("Cannot release items on 'BILLED' order.");
  });

  it('rejects if customer access scope does not match session', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [{ resolve_order_org: orgId }] });

    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: orderId,
            outlet_id: outletId,
            table_id: 'table-uuid',
            session_id: 'other-session-uuid',
            customer_id: 'other-customer-uuid',
            status: 'PREPARING',
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ customer_id: 'other-customer-uuid', temp_customer_id: null }],
      });

    await expect(
      ordersService.releaseItemHold(orgId, orderId, itemId, customerId, {
        customerId,
        sessionId,
      }),
    ).rejects.toThrow('Access denied for this table session.');
  });
});
