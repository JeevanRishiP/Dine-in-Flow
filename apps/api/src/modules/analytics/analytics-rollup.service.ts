import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import { dateToOutletLocal } from './analytics-calc.js';

interface RawOrderRow {
  id: string;
  subtotal_paise: number;
  tax_paise: number;
  discount_paise: number;
  total_paise: number;
  status: string;
  created_at: Date;
}

interface RawOrderItemRow {
  menu_item_id: string;
  name_snapshot: string;
  quantity: number;
  line_total_paise: number;
}

interface RawPaymentRow {
  method: string;
  amount_paise: string;
  fee_paise: string | null;
  status: string;
}

interface RawRefundRow {
  amount_paise: string;
  status: string;
}

/**
 * Service to aggregate raw orders and payments into rollup tables.
 * Can be run incrementally by jobs (ARCH §15 queues: analytics-rollups)
 * or triggered on-demand.
 *
 * Reference: ARCH §17, §15, §25
 */
@Injectable()
export class AnalyticsRollupService {
  private readonly logger = new Logger(AnalyticsRollupService.name);

  /**
   * Recompute all rollups for a single outlet and date in that outlet's timezone.
   */
  async recomputeOutletDay(
    orgId: string,
    outletId: string,
    targetDateStr: string, // YYYY-MM-DD
    timeZone = 'Asia/Kolkata',
  ) {
    return withTenantContextRaw(orgId, async (client) => {
      // 1. Fetch orders created for this outlet
      // In timezone-aware queries: convert order timestamp to outlet timezone date
      const ordersRes = await client.query<RawOrderRow>(
        `SELECT id, subtotal_paise, tax_paise, discount_paise, total_paise, status, created_at
         FROM orders
         WHERE org_id = $1
           AND outlet_id = $2
           AND (created_at AT TIME ZONE $3)::date = $4::date
           AND status NOT IN ('CANCELLED', 'PENDING')`,
        [orgId, outletId, timeZone, targetDateStr],
      );

      const orders = ordersRes.rows;
      const orderIds = orders.map((o) => o.id);

      // 2. Fetch payments for those orders
      let payments: RawPaymentRow[] = [];
      let refunds: RawRefundRow[] = [];
      if (orderIds.length > 0) {
        const paymentsRes = await client.query<RawPaymentRow>(
          `SELECT method, amount_paise, fee_paise, status
           FROM payments
           WHERE org_id = $1
             AND order_id = ANY($2::uuid[])
             AND status IN ('PAID', 'PARTIALLY_REFUNDED')`,
          [orgId, orderIds],
        );
        payments = paymentsRes.rows;

        const refundsRes = await client.query<RawRefundRow>(
          `SELECT r.amount_paise, r.status
           FROM refunds r
           JOIN payments p ON p.id = r.payment_id
           WHERE r.org_id = $1
             AND p.order_id = ANY($2::uuid[])
             AND r.status = 'SUCCEEDED'`,
          [orgId, orderIds],
        );
        refunds = refundsRes.rows;
      }

      // 3. Compute daily aggregates
      let orderCount = orders.length;
      let grossSalesPaise = 0n;
      let subtotalPaise = 0n;
      let taxPaise = 0n;
      let discountPaise = 0n;
      let refundPaise = 0n;

      for (const o of orders) {
        subtotalPaise += BigInt(o.subtotal_paise);
        taxPaise += BigInt(o.tax_paise);
        discountPaise += BigInt(o.discount_paise);
        grossSalesPaise += BigInt(o.total_paise);
      }

      for (const r of refunds) {
        refundPaise += BigInt(r.amount_paise);
      }

      const netSalesPaise = grossSalesPaise > refundPaise ? grossSalesPaise - refundPaise : 0n;

      // 4. Upsert Daily Outlet Rollup
      await client.query(
        `INSERT INTO analytics_daily_outlet_rollups (
           org_id, outlet_id, date, order_count, gross_sales_paise,
           subtotal_paise, tax_paise, discount_paise, refund_paise, net_sales_paise, tip_paise, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 0, now())
         ON CONFLICT (org_id, outlet_id, date) DO UPDATE SET
           order_count = EXCLUDED.order_count,
           gross_sales_paise = EXCLUDED.gross_sales_paise,
           subtotal_paise = EXCLUDED.subtotal_paise,
           tax_paise = EXCLUDED.tax_paise,
           discount_paise = EXCLUDED.discount_paise,
           refund_paise = EXCLUDED.refund_paise,
           net_sales_paise = EXCLUDED.net_sales_paise,
           updated_at = now()`,
        [
          orgId,
          outletId,
          targetDateStr,
          orderCount,
          grossSalesPaise.toString(),
          subtotalPaise.toString(),
          taxPaise.toString(),
          discountPaise.toString(),
          refundPaise.toString(),
          netSalesPaise.toString(),
        ],
      );

      // 5. Hourly Outlet Rollups
      const hourlyMap = new Map<number, { count: number; total: bigint }>();
      for (const o of orders) {
        const { localHour } = dateToOutletLocal(o.created_at, timeZone);
        const existing = hourlyMap.get(localHour) ?? { count: 0, total: 0n };
        existing.count += 1;
        existing.total += BigInt(o.total_paise);
        hourlyMap.set(localHour, existing);
      }

      for (let h = 0; h < 24; h++) {
        const data = hourlyMap.get(h) ?? { count: 0, total: 0n };
        await client.query(
          `INSERT INTO analytics_hourly_outlet_rollups (
             org_id, outlet_id, date, hour, order_count, total_paise, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, now())
           ON CONFLICT (org_id, outlet_id, date, hour) DO UPDATE SET
             order_count = EXCLUDED.order_count,
             total_paise = EXCLUDED.total_paise,
             updated_at = now()`,
          [orgId, outletId, targetDateStr, h, data.count, data.total.toString()],
        );
      }

      // 6. Item Rollups
      if (orderIds.length > 0) {
        const itemsRes = await client.query<RawOrderItemRow>(
          `SELECT menu_item_id, name_snapshot, quantity, line_total_paise
           FROM order_items
           WHERE org_id = $1
             AND order_id = ANY($2::uuid[])
             AND status != 'CANCELLED'`,
          [orgId, orderIds],
        );

        const itemAgg = new Map<string, { name: string; qty: number; sales: bigint }>();
        for (const item of itemsRes.rows) {
          const ex = itemAgg.get(item.menu_item_id) ?? {
            name: item.name_snapshot,
            qty: 0,
            sales: 0n,
          };
          ex.qty += item.quantity;
          ex.sales += BigInt(item.line_total_paise);
          itemAgg.set(item.menu_item_id, ex);
        }

        for (const [menuItemId, val] of itemAgg.entries()) {
          await client.query(
            `INSERT INTO analytics_item_daily_rollups (
               org_id, outlet_id, menu_item_id, item_name, date, quantity_sold, total_sales_paise, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
             ON CONFLICT (org_id, outlet_id, menu_item_id, date) DO UPDATE SET
               quantity_sold = EXCLUDED.quantity_sold,
               total_sales_paise = EXCLUDED.total_sales_paise,
               item_name = EXCLUDED.item_name,
               updated_at = now()`,
            [orgId, outletId, menuItemId, val.name, targetDateStr, val.qty, val.sales.toString()],
          );
        }
      }

      // 7. Payment Mix Rollups
      const paymentAgg = new Map<string, { count: number; amount: bigint; fee: bigint }>();
      for (const p of payments) {
        const ex = paymentAgg.get(p.method) ?? { count: 0, amount: 0n, fee: 0n };
        ex.count += 1;
        ex.amount += BigInt(p.amount_paise);
        ex.fee += BigInt(p.fee_paise ?? '0');
        paymentAgg.set(p.method, ex);
      }

      for (const [method, val] of paymentAgg.entries()) {
        const net = val.amount > val.fee ? val.amount - val.fee : 0n;
        await client.query(
          `INSERT INTO analytics_payment_daily_rollups (
             org_id, outlet_id, date, method, payment_count, amount_paise, fee_paise, net_paise, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
           ON CONFLICT (org_id, outlet_id, method, date) DO UPDATE SET
             payment_count = EXCLUDED.payment_count,
             amount_paise = EXCLUDED.amount_paise,
             fee_paise = EXCLUDED.fee_paise,
             net_paise = EXCLUDED.net_paise,
             updated_at = now()`,
          [orgId, outletId, targetDateStr, method, val.count, val.amount.toString(), val.fee.toString(), net.toString()],
        );
      }

      this.logger.log(`[ROLLUP] Recomputed ${targetDateStr} for outlet ${outletId}: ${orderCount} orders`);
      return {
        date: targetDateStr,
        orderCount,
        grossSalesPaise: grossSalesPaise.toString(),
        netSalesPaise: netSalesPaise.toString(),
      };
    });
  }
}
