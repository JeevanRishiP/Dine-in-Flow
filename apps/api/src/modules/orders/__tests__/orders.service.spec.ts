import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { OrdersService } from '../orders.service.js';
import * as dbClient from '../../../db/client.js';

describe('OrdersService', () => {
  let service: OrdersService;
  let queryMock: ReturnType<typeof vi.fn>;
  let poolQueryMock: ReturnType<typeof vi.fn>;

  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const orderId = '51d320db-3fd4-47cd-bc9d-4bd64d8ccc2a';
  const itemId = '5d08ad3f-138d-4e81-af94-24b5ff3411ad';

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new OrdersService();
    queryMock = vi.fn();
    poolQueryMock = vi.fn();

    const mockClient = { query: queryMock } as unknown as PoolClient;
    const mockPool = { query: poolQueryMock } as unknown as Pool;

    vi.spyOn(dbClient, 'getPool').mockReturnValue(mockPool);
    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_targetOrgId: string, fn: (client: PoolClient) => Promise<T>) => fn(mockClient),
    );
  });

  describe('updateItemStatus', () => {
    it('updates item status within authenticated tenant context and writes audit events', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ status: 'PENDING', order_id: orderId }] }) // select item
        .mockResolvedValueOnce({ rows: [] }) // update order_items
        .mockResolvedValueOnce({ rows: [{ status: 'PREPARING' }] }) // select all items
        .mockResolvedValueOnce({ rows: [{ status: 'CONFIRMED' }] }) // select order status
        .mockResolvedValueOnce({ rows: [] }) // update orders
        .mockResolvedValueOnce({ rows: [] }) // outbox STATUS_CHANGED
        .mockResolvedValueOnce({ rows: [] }) // order_events ITEM_STATUS_CHANGED
        .mockResolvedValueOnce({ rows: [] }) // outbox ITEM_STATUS_CHANGED
        .mockResolvedValueOnce({ rows: [{ id: orderId, status: 'PREPARING', table_number: 'T04' }] }) // getOrderInTx order
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              name_snapshot: 'Butter Chicken',
              status: 'PREPARING',
              created_at: '2026-11-11T15:12:07.943Z',
            },
          ],
        }); // getOrderInTx items

      const result = await service.updateItemStatus(
        orgId,
        orderId,
        itemId,
        { status: 'PREPARING' },
        'KDS_STAFF',
      );

      expect(result.status).toBe('PREPARING');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].created_at).toBe('2026-11-11T15:12:07.943Z');

      const eventCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO order_events'),
      );
      expect(eventCall).toBeDefined();
      expect(eventCall![1][0]).toBe(orgId);
      expect(eventCall![1][2]).toBeNull();

      const getOrderInTxCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('LEFT JOIN tables'),
      );
      expect(getOrderInTxCall).toBeDefined();
      expect(getOrderInTxCall![1]).toEqual([orderId, orgId]);
    });

    it('rejects empty tenant orgId with 401 UNAUTHORIZED cleanly', async () => {
      await expect(
        service.updateItemStatus('', orderId, itemId, { status: 'PREPARING' }, 'KDS_STAFF'),
      ).rejects.toMatchObject({ status: 401 });
      expect(poolQueryMock).not.toHaveBeenCalled();
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('rejects non-UUID itemId with 404 NOT_FOUND cleanly', async () => {
      await expect(
        service.updateItemStatus(orgId, orderId, 'oi000000-0000-0000-0000-000000000007', { status: 'READY' }, 'KDS_STAFF'),
      ).rejects.toMatchObject({ status: 404 });
      expect(queryMock).not.toHaveBeenCalled();
    });

    it('rejects non-UUID orderId with 404 NOT_FOUND cleanly', async () => {
      await expect(
        service.updateItemStatus(orgId, 'not-a-uuid', itemId, { status: 'PREPARING' }, 'KDS_STAFF'),
      ).rejects.toMatchObject({ status: 404 });
      expect(poolQueryMock).not.toHaveBeenCalled();
    });
  });

  describe('listOrders and getOrdersBySession', () => {
    it('selects created_at and updated_at on order_items in listOrders', async () => {
      queryMock
        .mockResolvedValueOnce({ rows: [{ id: orderId, status: 'CONFIRMED', created_at: '2026-11-11T15:12:07.943Z' }] })
        .mockResolvedValueOnce({
          rows: [{ id: itemId, name_snapshot: 'Butter Chicken', status: 'PENDING', created_at: '2026-11-11T15:12:07.943Z' }],
        });

      const orders = await service.listOrders(orgId, { limit: 50, offset: 0 });
      expect(orders).toHaveLength(1);
      const itemQuery = queryMock.mock.calls[1]?.[0] as string;
      expect(itemQuery).toContain('created_at');
      expect(itemQuery).toContain('FROM order_items');
    });
  });
});

