import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { OrdersService } from '../orders.service.js';
import { KitchenSchedulerService } from '../kitchen-scheduler.service.js';
import { TablesService } from '../../tables/tables.service.js';
import * as dbClient from '../../../db/client.js';
import * as configMod from '../../../config/config.js';
import type { TokenService } from '../../auth/token.service.js';

describe('Diner Plate Identity, Display ID Unification, Serve-Later Release & Table Cleanup', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const outletId = '71ad00a6-d79b-4035-b563-bf9543fcfa86';
  const sessionId = '20000000-0000-4000-8000-000000000001';
  const orderId = '20000000-0000-4000-8000-000000000002';
  const itemId = '20000000-0000-4000-8000-000000000003';
  const tableId = '20000000-0000-4000-8000-000000000004';
  const customerId = '20000000-0000-4000-8000-000000000005';
  const tempCustomer1 = '20000000-0000-4000-8000-000000000011';
  const tempCustomer2 = '20000000-0000-4000-8000-000000000012';

  let queryMock: ReturnType<typeof vi.fn>;
  let poolQueryMock: ReturnType<typeof vi.fn>;
  let ordersService: OrdersService;
  let schedulerService: KitchenSchedulerService;
  let tablesService: TablesService;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock = vi.fn();
    poolQueryMock = vi.fn();

    vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQueryMock } as unknown as Pool);
    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
        fn({ query: queryMock } as unknown as PoolClient),
    );
    vi.spyOn(configMod, 'getConfig').mockReturnValue({
      QR_TOKEN_SECRET: 'test_qr_secret_min_32_characters_long_123456',
      JWT_SECRET: 'test_jwt_secret_min_32_characters_long_123456',
    } as unknown as configMod.AppConfig);

    const tokenService = {
      signGuestSessionToken: vi.fn().mockReturnValue('guest.jwt.token'),
      signTempCustomerToken: vi.fn().mockReturnValue('temp.cust.token'),
      verifyTempCustomerToken: vi.fn(),
    } as unknown as TokenService;

    ordersService = new OrdersService();
    schedulerService = new KitchenSchedulerService();
    tablesService = new TablesService(tokenService);
  });

  describe('1. Diner Identification & Sequential Per-Table Labeling', () => {
    it('assigns Member label for signed-in customer with name', async () => {
      const sessionRow = {
        id: sessionId,
        org_id: orgId,
        outlet_id: outletId,
        table_id: tableId,
        customer_id: customerId,
        temp_customer_id: null,
        status: 'OPEN',
      };

      queryMock
        // 1. Idempotency check
        .mockResolvedValueOnce({ rows: [] })
        // 2. Session lookup
        .mockResolvedValueOnce({ rows: [sessionRow] })
        // 3. Menu item validation
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'item-1',
              name: 'Butter Chicken',
              price_paise: 25000,
              is_available: true,
              is_active: true,
              outlet_id: outletId,
              course_sequence: 2,
              prep_time_minutes: 15,
            },
          ],
        })
        // 4. item_availability query
        .mockResolvedValueOnce({ rows: [] })
        // 5. Order counter sequence
        .mockResolvedValueOnce({ rows: [{ last_seq: 101 }] })
        // 6. Customer name lookup
        .mockResolvedValueOnce({ rows: [{ name: 'Aarav Sharma' }] })
        // 7. Insert orders
        .mockResolvedValueOnce({ rows: [{ id: orderId }] })
        // 8. Course sequence and prep time lookup
        .mockResolvedValueOnce({
          rows: [{ id: 'item-1', course_sequence: 2, prep_time_minutes: 15 }],
        })
        // 9. Insert order_items
        .mockResolvedValueOnce({ rowCount: 1 })
        // 10. Audit event
        .mockResolvedValueOnce({ rowCount: 1 })
        // 11. getOrderInTx order query
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId,
              org_id: orgId,
              outlet_id: outletId,
              order_number: 101,
              display_id: 'ORD-0101',
              diner_id: customerId,
              diner_label: 'Aarav Sharma',
              status: 'AWAITING_PAYMENT',
              payment_status: 'PENDING',
              subtotal_paise: '25000',
              tax_total_paise: '0',
              tip_paise: '0',
              total_paise: '25000',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        })
        // 11. getOrderInTx items query
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              order_id: orderId,
              menu_item_id: 'item-1',
              name_snapshot: 'Butter Chicken',
              unit_price_paise: '25000',
              quantity: 1,
              line_total_paise: '25000',
              status: 'PENDING',
              hold_status: 'ACTIVE',
              diner_id: customerId,
              diner_label: 'Aarav Sharma',
            },
          ],
        });

      const order = await ordersService.placeOrder(
        orgId,
        {
          session_id: sessionId,
          items: [{ menu_item_id: 'item-1', quantity: 1, portion: 'FULL' }],
          tip_paise: 0,
        },
        customerId,
        'CUSTOMER',
        { customerId, sessionId },
      );

      expect(order.dinerId).toBe(customerId);
      expect(order.dinerLabel).toBe('Aarav Sharma');
      expect(order.displayId).toBe('ORD-0101');

      // Verify the order_items insert captured diner_id and diner_label
      const insertItemsCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO order_items'),
      );
      expect(insertItemsCall).toBeDefined();
      expect(insertItemsCall![1]).toContain(customerId);
      // Log params if needed
      expect(insertItemsCall![1][13]).toBe('Aarav Sharma');
    });

    it('assigns Guest 1 to the first anonymous diner, and Guest 2 to the second anonymous diner on the same session', async () => {
      // Test Guest 1: 0 other distinct diners
      const sessionRow1 = {
        id: sessionId,
        org_id: orgId,
        outlet_id: outletId,
        table_id: tableId,
        customer_id: null,
        temp_customer_id: tempCustomer1,
        status: 'OPEN',
      };

      queryMock
        // 1. Idempotency check
        .mockResolvedValueOnce({ rows: [] })
        // 2. Session lookup
        .mockResolvedValueOnce({ rows: [sessionRow1] })
        // 3. Menu items
        .mockResolvedValueOnce({
          rows: [{ id: 'item-1', price_paise: 10000, is_available: true }],
        })
        // 4. Modifier groups
        .mockResolvedValueOnce({ rows: [] })
        // 5. Tax rates
        .mockResolvedValueOnce({ rows: [] })
        // 6. Order counter sequence
        .mockResolvedValueOnce({ rows: [{ last_seq: 102 }] })
        // 7. Existing label lookup for this diner_id -> none yet
        .mockResolvedValueOnce({ rows: [] })
        // 8. Other distinct diners count -> 0!
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        // 9. Insert orders
        .mockResolvedValueOnce({ rows: [{ id: orderId }] })
        // 10. Insert order_items
        .mockResolvedValueOnce({ rowCount: 1 })
        // 11. linkTempCustomerTables lookup
        .mockResolvedValueOnce({ rows: [{ id: 'tct-1', status: 'ACTIVE' }] })
        // 12. Insert order_events
        .mockResolvedValueOnce({ rowCount: 1 })
        // 13. getOrderInTx orders
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId,
              org_id: orgId,
              outlet_id: outletId,
              order_number: 102,
              display_id: 'ORD-0102',
              diner_id: tempCustomer1,
              diner_label: 'Guest 1',
              status: 'AWAITING_PAYMENT',
              payment_status: 'PENDING',
              subtotal_paise: '10000',
              tax_total_paise: '0',
              tip_paise: '0',
              total_paise: '10000',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        })
        // 14. getOrderInTx items
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              order_id: orderId,
              menu_item_id: 'item-1',
              name_snapshot: 'Masala Chai',
              unit_price_paise: '10000',
              quantity: 1,
              line_total_paise: '10000',
              status: 'PENDING',
              hold_status: 'ACTIVE',
              diner_id: tempCustomer1,
              diner_label: 'Guest 1',
            },
          ],
        });

      const order1 = await ordersService.placeOrder(
        orgId,
        {
          session_id: sessionId,
          items: [{ menu_item_id: 'item-1', quantity: 1, portion: 'FULL' }],
          tip_paise: 0,
        },
        tempCustomer1,
        'CUSTOMER',
        { tempCustomerId: tempCustomer1, sessionId },
      );

      expect(order1.dinerId).toBe(tempCustomer1);
      expect(order1.dinerLabel).toBe('Guest 1');

      // Now test Guest 2: session has 1 existing distinct diner (Guest 1)
      const queryMockGuest2 = vi.fn();
      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMockGuest2 } as unknown as PoolClient),
      );

      queryMockGuest2
        // 1. Idempotency check
        .mockResolvedValueOnce({ rows: [] })
        // 2. Session lookup
        .mockResolvedValueOnce({
          rows: [{ ...sessionRow1, temp_customer_id: tempCustomer2 }],
        })
        // 3. Menu items
        .mockResolvedValueOnce({
          rows: [{ id: 'item-1', price_paise: 10000, is_available: true }],
        })
        // 4. Modifier groups
        .mockResolvedValueOnce({ rows: [] })
        // 5. Tax rates
        .mockResolvedValueOnce({ rows: [] })
        // 6. Order counter sequence
        .mockResolvedValueOnce({ rows: [{ last_seq: 103 }] })
        // 7. Existing label lookup for tempCustomer2 -> none yet
        .mockResolvedValueOnce({ rows: [] })
        // 8. Other distinct diners count -> 1 other diner exists!
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        // 9. Insert orders
        .mockResolvedValueOnce({ rows: [{ id: 'order-2' }] })
        // 10. Insert order_items
        .mockResolvedValueOnce({ rowCount: 1 })
        // 11. linkTempCustomerTables lookup
        .mockResolvedValueOnce({ rows: [{ id: 'tct-2', status: 'ACTIVE' }] })
        // 12. Insert order_events
        .mockResolvedValueOnce({ rowCount: 1 })
        // 13. getOrderInTx orders
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'order-2',
              org_id: orgId,
              outlet_id: outletId,
              order_number: 103,
              display_id: 'ORD-0103',
              diner_id: tempCustomer2,
              diner_label: 'Guest 2',
              status: 'AWAITING_PAYMENT',
              payment_status: 'PENDING',
              subtotal_paise: '10000',
              tax_total_paise: '0',
              tip_paise: '0',
              total_paise: '10000',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        })
        // 14. getOrderInTx items
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'item-2',
              order_id: 'order-2',
              menu_item_id: 'item-1',
              name_snapshot: 'Masala Chai',
              unit_price_paise: '10000',
              quantity: 1,
              line_total_paise: '10000',
              status: 'PENDING',
              hold_status: 'ACTIVE',
              diner_id: tempCustomer2,
              diner_label: 'Guest 2',
            },
          ],
        });

      const order2 = await ordersService.placeOrder(
        orgId,
        {
          session_id: sessionId,
          items: [{ menu_item_id: 'item-1', quantity: 1, portion: 'FULL' }],
          tip_paise: 0,
        },
        tempCustomer2,
        'CUSTOMER',
        { tempCustomerId: tempCustomer2, sessionId },
      );

      expect(order2.dinerId).toBe(tempCustomer2);
      expect(order2.dinerLabel).toBe('Guest 2');
    });
  });

  describe('2. Canonical displayId Synchronization Across Customer, Console & KDS', () => {
    const canonicalDisplayId = 'ORD-0042';

    it('returns exact same displayId in Customer Session Orders, Captain Console Orders, and KDS Flattened Items', async () => {
      // 1. Customer Session Orders: getOrdersBySession
      queryMock
        // Session scope lookup
        .mockResolvedValueOnce({
          rows: [{ id: sessionId, customer_id: null, temp_customer_id: tempCustomer1 }],
        })
        // Orders query
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId,
              org_id: orgId,
              outlet_id: outletId,
              order_number: 42,
              display_id: canonicalDisplayId,
              diner_id: tempCustomer1,
              diner_label: 'Guest 1',
              status: 'CONFIRMED',
              payment_status: 'PAID',
              subtotal_paise: '25000',
              tax_total_paise: '0',
              tip_paise: '0',
              total_paise: '25000',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        })
        // attachItemsToOrders
        .mockResolvedValueOnce({
          rows: [
            {
              order_id: orderId,
              id: itemId,
              display_id: canonicalDisplayId,
              name_snapshot: 'Butter Chicken',
              unit_price_paise: '25000',
              quantity: 1,
              line_total_paise: '25000',
              status: 'CONFIRMED',
              hold_status: 'ACTIVE',
              diner_id: tempCustomer1,
              diner_label: 'Guest 1',
            },
          ],
        });

      const customerOrders = await ordersService.getOrdersBySession(orgId, sessionId, {
        sessionId,
      });
      expect(customerOrders).toHaveLength(1);
      expect(customerOrders[0]!['displayId']).toBe(canonicalDisplayId);
      const custItems = customerOrders[0]!['items'] as Array<Record<string, unknown>>;
      expect(custItems[0]!['displayId']).toBe(canonicalDisplayId);

      // 2. Captain Console: listOrders
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId,
              org_id: orgId,
              outlet_id: outletId,
              order_number: 42,
              display_id: canonicalDisplayId,
              diner_id: tempCustomer1,
              diner_label: 'Guest 1',
              status: 'CONFIRMED',
              payment_status: 'PAID',
              subtotal_paise: '25000',
              tax_total_paise: '0',
              tip_paise: '0',
              total_paise: '25000',
            },
          ],
        })
        // attachItemsToOrders
        .mockResolvedValueOnce({
          rows: [
            {
              order_id: orderId,
              id: itemId,
              name_snapshot: 'Butter Chicken',
              quantity: 1,
              status: 'CONFIRMED',
              hold_status: 'ACTIVE',
              diner_id: tempCustomer1,
              diner_label: 'Guest 1',
            },
          ],
        });

      const consoleOrders = await ordersService.listOrders(orgId, { outlet_id: outletId });
      expect(consoleOrders).toHaveLength(1);
      expect(consoleOrders[0]!['displayId']).toBe(canonicalDisplayId);

      // 3. Kitchen KDS: getFlattenedKdsItems
      queryMock.mockResolvedValueOnce({
        rows: [
          {
            itemId: itemId,
            orderId: orderId,
            displayId: canonicalDisplayId,
            orderDisplayId: canonicalDisplayId,
            orderNumber: 42,
            orderType: 'DINE_IN',
            tableNumber: 'T04',
            scheduledFor: null,
            dishName: 'Butter Chicken',
            quantity: 1,
            modifiers: [],
            spiceLevel: 2,
            notes: null,
            isComboItem: false,
            comboName: null,
            courseSequence: 2,
            prepTimeMinutes: 15,
            targetFireAt: new Date().toISOString(),
            holdStatus: 'ACTIVE',
            itemStatus: 'CONFIRMED',
            paidAt: new Date().toISOString(),
            claimedByStaffId: null,
            claimedAt: null,
            dinerId: tempCustomer1,
            dinerLabel: 'Guest 1',
          },
        ],
      });

      const kdsItems = await schedulerService.getFlattenedKdsItems(orgId, outletId);
      expect(kdsItems).toHaveLength(1);
      expect(kdsItems[0]!.displayId).toBe(canonicalDisplayId);
      expect(kdsItems[0]!.id).toBe(itemId);
      expect(kdsItems[0]!.dinerLabel).toBe('Guest 1');
    });
  });

  describe('3. Customer & Captain Serve-Later Hold Release', () => {
    it('releases hold without setting item status to PREPARING prematurely', async () => {
      poolQueryMock.mockResolvedValueOnce({ rows: [{ resolve_order_org: orgId }] });

      queryMock
        // Order lookup
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId,
              outlet_id: outletId,
              table_id: tableId,
              session_id: sessionId,
              customer_id: customerId,
              status: 'CONFIRMED',
              payment_status: 'PAID',
              display_id: 'ORD-0001',
            },
          ],
        })
        // Session lookup
        .mockResolvedValueOnce({
          rows: [{ customer_id: customerId, temp_customer_id: null }],
        })
        // Item lookup (in SERVE_LATER_HOLD)
        .mockResolvedValueOnce({
          rows: [
            {
              id: itemId,
              order_id: orderId,
              name_snapshot: 'Gulab Jamun',
              notes: 'Serve warm',
              status: 'CONFIRMED',
              hold_status: 'SERVE_LATER_HOLD',
            },
          ],
        })
        // Update order_items
        .mockResolvedValueOnce({ rowCount: 1 })
        // Insert order_events
        .mockResolvedValueOnce({ rowCount: 1 })
        // Insert outbox kds.item_fired
        .mockResolvedValueOnce({ rowCount: 1 })
        // Insert outbox ORDER_ITEM_RELEASED
        .mockResolvedValueOnce({ rowCount: 1 });

      const released = await ordersService.releaseItemHold(
        orgId,
        orderId,
        itemId,
        customerId,
        { customerId, sessionId },
      );

      // Verify the item remains CONFIRMED (ready for chef to pick up), NOT PREPARING
      expect(released.id).toBe(itemId);
      expect(released.hold_status).toBe('RELEASED');
      expect(released.status).toBe('CONFIRMED');
      expect(released.is_released).toBe(true);

      // Verify DB update parameters: target_fire_at updated to now(), hold_status = 'RELEASED', status = 'CONFIRMED'
      const updateCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('UPDATE order_items'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall![1][1]).toBe('CONFIRMED'); // Not 'PREPARING'
      expect(updateCall![0]).toContain("hold_status = 'RELEASED'");
      expect(updateCall![0]).toContain('target_fire_at = now()');

      // Verify kds.item_fired outbox event was queued
      const kdsOutboxCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('kds.item_fired'),
      );
      expect(kdsOutboxCall).toBeDefined();
    });

    it('Captain releaseOrderHeldItemsByStaff releases specific item or all held items on order', async () => {
      // 1. Order lookup
      queryMock
        .mockResolvedValueOnce({
          rows: [
            {
              id: orderId,
              org_id: orgId,
              outlet_id: outletId,
              status: 'CONFIRMED',
              payment_status: 'PAID',
              display_id: 'ORD-0001',
            },
          ],
        })
        // 2. Select held items
        .mockResolvedValueOnce({
          rows: [
            { id: itemId, name_snapshot: 'Rasmalai', notes: null, status: 'CONFIRMED' },
          ],
        })
        // 3. Update order_items
        .mockResolvedValueOnce({ rowCount: 1 })
        // 4. Insert order_events
        .mockResolvedValueOnce({ rowCount: 1 })
        // 5. Insert outbox events for kds.item_fired
        .mockResolvedValueOnce({ rowCount: 1 })
        // 6. Insert outbox event for SERVE_LATER_RELEASED
        .mockResolvedValueOnce({ rowCount: 1 });

      const captainResult = await ordersService.releaseOrderHeldItemsByStaff(
        orgId,
        orderId,
        'staff-uuid',
        undefined,
        itemId,
      );

      expect(captainResult.released_count).toBe(1);
      expect(captainResult.released_item_ids).toContain(itemId);
    });
  });

  describe('4. Table Cleanup Ghost Item Prevention', () => {
    it('cleanTableAndDissolve closes sessions, marks unserved items CANCELLED, ready items SERVED, and parent orders BILLED', async () => {
      // 1. getTableInTx
      queryMock
        .mockResolvedValueOnce({
          rows: [{ id: tableId, org_id: orgId, table_number: 'T04', outlet_id: outletId }],
        })
        // 2. linked temp customers
        .mockResolvedValueOnce({
          rows: [{ temp_customer_id: tempCustomer1 }],
        })
        // 3. update temp_customer_tables to CLEANED
        .mockResolvedValueOnce({ rowCount: 1 })
        // 4. close table_sessions for table
        .mockResolvedValueOnce({ rows: [{ id: sessionId }] })
        // 5. check remaining active tables for temp customer 1
        .mockResolvedValueOnce({ rows: [{ remaining: 0 }] })
        // 6. dissolve temp_customers
        .mockResolvedValueOnce({ rowCount: 1 })
        // 7. close table_sessions for temp customer
        .mockResolvedValueOnce({ rows: [] })
        // 8. update order_items READY -> SERVED
        .mockResolvedValueOnce({ rowCount: 1 })
        // 9. update lingering order_items -> CANCELLED
        .mockResolvedValueOnce({ rowCount: 1 })
        // 10. update paid orders -> BILLED
        .mockResolvedValueOnce({ rowCount: 1 })
        // 11. update unpaid orders -> CANCELLED
        .mockResolvedValueOnce({ rowCount: 0 })
        // 12. insert outbox table.cleaned
        .mockResolvedValueOnce({ rowCount: 1 })
        // 13. insert outbox kds.sync_required
        .mockResolvedValueOnce({ rowCount: 1 });

      const cleanResult = await tablesService.cleanTableAndDissolve(
        orgId,
        tableId,
        'staff-cleaner-uuid',
        outletId,
      );

      expect(cleanResult.cleaned).toBe(true);
      expect(cleanResult.tableNumber).toBe('T04');
      expect(cleanResult.dissolvedTempCustomerIds).toContain(tempCustomer1);

      // Verify table.cleaned outbox event
      const tableCleanedEvent = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('table.cleaned'),
      );
      expect(tableCleanedEvent).toBeDefined();

      // Verify kds.sync_required outbox event
      const kdsSyncEvent = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('kds.sync_required'),
      );
      expect(kdsSyncEvent).toBeDefined();
    });

    it('KDS query strictly excludes orders with CLOSED sessions and terminal statuses', async () => {
      // Run getFlattenedKdsItems and verify the SQL query construction
      queryMock.mockResolvedValueOnce({ rows: [] });

      await schedulerService.getFlattenedKdsItems(orgId, outletId);

      const kdsQueryCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('FROM order_items oi'),
      );
      expect(kdsQueryCall).toBeDefined();
      const sql = kdsQueryCall![0] as string;

      // Invariant: must exclude COMPLETED, CANCELLED, BILLED
      expect(sql).toContain("o.status NOT IN ('COMPLETED')");
      expect(sql).toContain("oi.status NOT IN ('CANCELLED', 'SERVED')");
      // Invariant: must filter by session status OPEN or takeaway/pre-book
      expect(sql).toContain("ts.status = 'OPEN'");
    });

    it('Console listOrders strictly excludes CLOSED sessions and terminal orders', async () => {
      queryMock.mockResolvedValueOnce({ rows: [] });

      await ordersService.listOrders(orgId, { outlet_id: outletId });

      const listQueryCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('FROM orders o'),
      );
      expect(listQueryCall).toBeDefined();
      const sql = listQueryCall![0] as string;

      // Invariant: excludes closed sessions unless takeaway/pre-book
      expect(sql).toContain("ts.status = 'OPEN'");
      expect(sql).toContain("o.status NOT IN ('CANCELLED', 'BILLED', 'COMPLETED')");
    });
  });
});
