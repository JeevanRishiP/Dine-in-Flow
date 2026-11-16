import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsRollupService } from '../analytics-rollup.service.js';
import * as dbClient from '../../../db/client.js';

describe('AnalyticsRollupService — Sargable Queries & Rollup Generation', () => {
  const orgId = '7762b6af-7967-4632-843c-62383c31484d';
  const outletId = '88888888-8888-4888-8888-888888888888';
  let rollupService: AnalyticsRollupService;

  beforeEach(() => {
    rollupService = new AnalyticsRollupService();
    vi.restoreAllMocks();
  });

  it('uses sargable bounded timestamp range instead of non-sargable date casting', async () => {
    const executedQueries: Array<{ sql: string; params: unknown[] }> = [];

    const mockClient = {
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        executedQueries.push({ sql, params: params ?? [] });

        // Step 1: Orders query
        if (sql.includes('FROM orders')) {
          return {
            rows: [
              {
                id: 'order-1',
                subtotal_paise: 50000,
                tax_paise: 2500,
                discount_paise: 5000,
                total_paise: 47500,
                status: 'SERVED',
                created_at: new Date('2026-11-16T08:30:00Z'),
              },
            ],
          };
        }

        // Step 2: Payments query
        if (sql.includes('FROM payments')) {
          return {
            rows: [
              {
                method: 'UPI',
                amount_paise: '47500',
                fee_paise: '0',
                status: 'PAID',
              },
            ],
          };
        }

        // Step 2b: Refunds query
        if (sql.includes('FROM refunds')) {
          return { rows: [] };
        }

        // Step 6: Order items query
        if (sql.includes('FROM order_items')) {
          return {
            rows: [
              {
                menu_item_id: 'item-1',
                name_snapshot: 'Butter Chicken',
                quantity: 2,
                line_total_paise: 50000,
              },
            ],
          };
        }

        // Upsert queries
        return { rows: [] };
      }),
    };

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async (_orgId, fn) => fn(mockClient as any),
    );

    const result = await rollupService.recomputeOutletDay(
      orgId,
      outletId,
      '2026-11-16',
      'Asia/Kolkata',
    );

    expect(result).toBeDefined();
    expect(result.orderCount).toBe(1);
    expect(result.grossSalesPaise).toBe('47500');

    // Verify sargable SQL on orders
    const ordersQuery = executedQueries.find((q) => q.sql.includes('FROM orders'));
    expect(ordersQuery).toBeDefined();

    // MUST NOT use non-sargable (created_at AT TIME ZONE ...)::date
    expect(ordersQuery!.sql).not.toContain('(created_at AT TIME ZONE $3)::date = $4::date');

    // MUST use sargable bounded timestamp range
    expect(ordersQuery!.sql).toContain('created_at >= ($4::timestamp AT TIME ZONE $3)');
    expect(ordersQuery!.sql).toContain("created_at < (($4::timestamp + interval '1 day') AT TIME ZONE $3)");
    expect(ordersQuery!.params).toEqual([orgId, outletId, 'Asia/Kolkata', '2026-11-16']);
  });
});
