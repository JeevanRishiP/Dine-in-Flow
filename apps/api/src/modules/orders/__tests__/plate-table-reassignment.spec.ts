import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { OrdersService } from '../orders.service.js';
import { TablesService } from '../../tables/tables.service.js';
import * as dbClient from '../../../db/client.js';
import * as configMod from '../../../config/config.js';
import type { TokenService } from '../../auth/token.service.js';

describe('Manual Table Lookup & Per-Plate Table Reassignment', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const outletId = '71ad00a6-d79b-4035-b563-bf9543fcfa86';
  const sessionId = '20000000-0000-4000-8000-000000000001';
  const orderId = '20000000-0000-4000-8000-000000000002';
  const itemId = '20000000-0000-4000-8000-000000000003';
  const table4Id = '20000000-0000-4000-8000-000000000004';
  const table7Id = '20000000-0000-4000-8000-000000000007';

  let queryMock: ReturnType<typeof vi.fn>;
  let poolQueryMock: ReturnType<typeof vi.fn>;
  let ordersService: OrdersService;
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
    tablesService = new TablesService(tokenService);
  });

  it('matches numeric table entry "4" to "T04" in active hotel outlet and rejects invalid table numbers', async () => {
    const tempCustId = '20000000-0000-4000-8000-000000000099';
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ resolve_outlet_org: orgId }] })
      .mockResolvedValueOnce({
        rows: [
          { id: table4Id, org_id: orgId, outlet_id: outletId, table_number: 'T04', section: 'Main', capacity: 4 },
        ],
      });

    queryMock
      .mockResolvedValueOnce({ rows: [{ qr_token_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: tempCustId }] }) // insert temp_customers
      .mockResolvedValueOnce({
        rows: [
          {
            id: sessionId,
            org_id: orgId,
            outlet_id: outletId,
            table_id: table4Id,
            status: 'OPEN',
            pax: 2,
            opened_at: '2026-11-12T00:00:00Z',
            temp_customer_id: tempCustId,
          },
        ],
      });

    const session = await tablesService.openManualSession({
      outlet_id: outletId,
      table_number: '4',
      pax: 2,
    });
    expect(session.table_number).toBe('T04');
    expect(session.guestSessionToken).toBe('guest.jwt.token');
    expect(session.tempCustomerId).toBe(tempCustId);

    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ resolve_outlet_org: orgId }] })
      .mockResolvedValueOnce({
        rows: [{ id: table4Id, org_id: orgId, outlet_id: outletId, table_number: 'T04', section: 'Main', capacity: 4 }],
      });

    await expect(
      tablesService.openManualSession({ outlet_id: outletId, table_number: '999', pax: 2 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reassigns a plate inside a multi-qty order item atomically while preserving integer total', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: orderId, outlet_id: outletId, table_id: table4Id, session_id: sessionId, customer_id: null, status: 'PREPARING' }],
      })
      .mockResolvedValueOnce({ rows: [{ customer_id: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: itemId,
            order_id: orderId,
            menu_item_id: 'menu-1',
            name_snapshot: 'Biryani',
            unit_price_paise: 30001,
            quantity: 2,
            line_total_paise: 60001,
            modifiers: [],
            notes: null,
            status: 'CONFIRMED',
            target_table_id: table4Id,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          { id: table4Id, table_number: 'T04' },
          { id: table7Id, table_number: 'T07' },
        ],
      })
      .mockResolvedValueOnce({ rows: [] }) // update remaining quantity row
      .mockResolvedValueOnce({ rows: [] }) // insert split plate row
      .mockResolvedValueOnce({ rows: [] }) // order_events
      .mockResolvedValueOnce({ rows: [] }) // outbox_events
      .mockResolvedValueOnce({ rows: [{ id: orderId, status: 'PREPARING', table_number: 'T04' }] })
      .mockResolvedValueOnce({ rows: [{ id: itemId, quantity: 1, line_total_paise: 30001, target_table_number: 'T04' }, { id: 'split-1', quantity: 1, line_total_paise: 30000, target_table_number: 'T07' }] });

    const res = await ordersService.reassignItemTable(
      orgId,
      orderId,
      itemId,
      { target_table_number: '7', plate_index: 2 },
      sessionId,
      { actorType: 'GUEST', sessionId },
    );

    const updateRemainingCall = queryMock.mock.calls[4]!;
    const insertSplitCall = queryMock.mock.calls[5]!;
    expect(updateRemainingCall[1][1] + insertSplitCall[1][5]).toBe(60001);
    expect(insertSplitCall[1][9]).toBe(table7Id);
    expect(res.items).toHaveLength(2);
  });

  it('blocks post-SERVED per-plate table reassignment with 400 VALIDATION_ERROR', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [{ id: orderId, outlet_id: outletId, table_id: table4Id, session_id: sessionId, customer_id: null, status: 'SERVED' }],
      })
      .mockResolvedValueOnce({ rows: [{ customer_id: null }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: itemId,
            order_id: orderId,
            menu_item_id: 'menu-1',
            name_snapshot: 'Biryani',
            unit_price_paise: 30000,
            quantity: 1,
            line_total_paise: 30000,
            modifiers: [],
            notes: null,
            status: 'SERVED',
            target_table_id: table4Id,
          },
        ],
      });

    await expect(
      ordersService.reassignItemTable(
        orgId,
        orderId,
        itemId,
        { target_table_number: '7' },
        sessionId,
        { actorType: 'GUEST', sessionId },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('resolves public table directory by host subdomain or pilot slug in dev when outlet_id is omitted', async () => {
    poolQueryMock
      .mockResolvedValueOnce({ rows: [{ outlet_id: outletId, org_id: orgId }] })
      .mockResolvedValueOnce({
        rows: [
          { id: table4Id, org_id: orgId, outlet_id: outletId, table_number: 'T04', section: 'Main', capacity: 4 },
        ],
      });

    const res = await tablesService.listPublicOutletTables(undefined, {
      host: 'royal-spice-bistro.dineflow.app',
    });

    expect(res.org_id).toBe(orgId);
    expect(res.outlet_id).toBe(outletId);
    expect(res.tables).toHaveLength(1);
    expect(res.tables[0]?.numeric_number).toBe('4');
  });

  it('keeps temporary customer ACTIVE while any linked table stays uncleaned, and DISSOLVES once all tables are cleaned', async () => {
    const tempCustId = '20000000-0000-4000-8000-000000000088';
    const table5Id = '20000000-0000-4000-8000-000000000005';
    const staffId = '20000000-0000-4000-8000-000000000077';

    // 1. Captain cleans Table 5, while Table 4 is still ACTIVE for tempCustId -> NOT dissolved
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: table5Id, org_id: orgId, outlet_id: outletId, table_number: 'T05' }] })
      .mockResolvedValueOnce({ rows: [{ temp_customer_id: tempCustId }] }) // linked temp customers
      .mockResolvedValueOnce({ rows: [] }) // update temp_customer_tables
      .mockResolvedValueOnce({ rows: [] }) // close sessions on table 5
      .mockResolvedValueOnce({ rows: [{ remaining: 1 }] }); // Table 4 still ACTIVE!

    const partial = await tablesService.cleanTableAndDissolve(orgId, table5Id, staffId, outletId);
    expect(partial.cleaned).toBe(true);
    expect(partial.dissolvedTempCustomerIds).toEqual([]);
    expect(partial.stillActiveOtherTablesCount).toBe(1);

    // 2. Captain now cleans Table 4 -> remaining becomes 0 -> DISSOLVED!
    queryMock.mockReset();
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: table4Id, org_id: orgId, outlet_id: outletId, table_number: 'T04' }] })
      .mockResolvedValueOnce({ rows: [{ temp_customer_id: tempCustId }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ remaining: 0 }] }) // 0 remaining ACTIVE tables!
      .mockResolvedValueOnce({ rows: [] }) // mark temp_customers DISSOLVED
      .mockResolvedValueOnce({ rows: [] }); // close remaining open sessions

    const finalClean = await tablesService.cleanTableAndDissolve(orgId, table4Id, staffId, outletId);
    expect(finalClean.cleaned).toBe(true);
    expect(finalClean.dissolvedTempCustomerIds).toEqual([tempCustId]);
    expect(finalClean.stillActiveOtherTablesCount).toBe(0);
  });

  it('scopes getMyOrders strictly to customerId when signed in and to active tempCustomerId for guests', async () => {
    const custId = '20000000-0000-4000-8000-000000000066';
    const tcId = '20000000-0000-4000-8000-000000000055';

    // Signed-in account queries o.customer_id = $2 regardless of table number
    queryMock
      .mockResolvedValueOnce({ rows: [{ id: orderId, table_number: 'T04', customer_id: custId }] })
      .mockResolvedValueOnce({ rows: [] }); // order items

    const acctOrders = await ordersService.getMyOrders(orgId, { customerId: custId, sessionId });
    expect(acctOrders).toHaveLength(1);
    const sqlAcct = String(queryMock.mock.calls[0]?.[0] ?? '');
    expect(sqlAcct).toContain('o.customer_id = $2');

    // Dissolved temporary guest receives [] immediately
    queryMock.mockReset();
    queryMock.mockResolvedValueOnce({ rows: [{ status: 'DISSOLVED' }] });
    const dissolvedOrders = await ordersService.getMyOrders(orgId, { tempCustomerId: tcId, sessionId });
    expect(dissolvedOrders).toEqual([]);
  });
});

