import { Injectable, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import {
  calculateOverviewMetrics,
  buildTimeSeries,
  buildHourlyHeatmap,
  calculateItemPerformance,
  calculatePaymentMix,
  calculateCustomerCohort,
  generateCsvExport,
  type DailyRollupData,
  type HourlyRollupData,
  type ItemRollupData,
  type PaymentRollupData,
} from './analytics-calc.js';
import type {
  DateRangeQueryDto,
  ItemsQueryDto,
  CreateExportDto,
} from './analytics.dto.js';

interface DailyRollupRow {
  date: string | Date;
  order_count: number;
  gross_sales_paise: string;
  subtotal_paise: string;
  tax_paise: string;
  discount_paise: string;
  refund_paise: string;
  net_sales_paise: string;
  tip_paise: string;
}

interface HourlyRollupRow {
  date: string | Date;
  hour: number;
  order_count: number;
  total_paise: string;
}

interface ItemRollupRow {
  menu_item_id: string;
  item_name: string;
  date: string | Date;
  quantity_sold: number;
  total_sales_paise: string;
}

interface PaymentRollupRow {
  date: string | Date;
  method: string;
  payment_count: number;
  amount_paise: string;
  fee_paise: string;
  net_paise: string;
}

/**
 * Owner & Manager Analytics Service
 *
 * Implements high-performance dashboard aggregations backed by pre-computed
 * rollup tables.
 *
 * Reference: ARCH §17, §15, §25, AGENTS §2 rule 1+3+5
 */
@Injectable()
export class AnalyticsService {

  // ─── Overview ─────────────────────────────────────────────────────────────────

  async getOverview(orgId: string, query: DateRangeQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      // 1. Fetch current window rollups
      const currentRows = await this.fetchDailyRollups(
        client,
        orgId,
        query.from,
        query.to,
        query.outletId,
      );

      // 2. Fetch comparison window if requested
      let previousRows: DailyRollupData[] | undefined;
      if (query.comparison === 'previous_period') {
        const { prevFrom, prevTo } = this.computePreviousPeriod(query.from, query.to);
        previousRows = await this.fetchDailyRollups(
          client,
          orgId,
          prevFrom,
          prevTo,
          query.outletId,
        );
      }

      return calculateOverviewMetrics(currentRows, previousRows);
    });
  }

  // ─── Sales Time Series ────────────────────────────────────────────────────────

  async getSales(orgId: string, query: DateRangeQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const rows = await this.fetchDailyRollups(
        client,
        orgId,
        query.from,
        query.to,
        query.outletId,
      );
      return {
        from: query.from,
        to: query.to,
        data: buildTimeSeries(rows, query.from, query.to),
      };
    });
  }

  // ─── Top / Bottom Items ───────────────────────────────────────────────────────

  async getItems(orgId: string, query: ItemsQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const params: unknown[] = [orgId, query.from, query.to];
      let outletFilter = '';
      if (query.outletId) {
        params.push(query.outletId);
        outletFilter = `AND outlet_id = $${params.length}`;
      }

      const res = await client.query<ItemRollupRow>(
        `SELECT menu_item_id, item_name, date, quantity_sold, total_sales_paise
         FROM analytics_item_daily_rollups
         WHERE org_id = $1
           AND date >= $2::date
           AND date <= $3::date
           ${outletFilter}`,
        params,
      );

      const items: ItemRollupData[] = res.rows.map((r) => ({
        menuItemId: r.menu_item_id,
        itemName: r.item_name,
        date: typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().split('T')[0]!,
        quantitySold: r.quantity_sold,
        totalSalesPaise: BigInt(r.total_sales_paise),
      }));

      return calculateItemPerformance(items, query.limit);
    });
  }

  // ─── Hourly Heatmap ───────────────────────────────────────────────────────────

  async getHeatmap(orgId: string, query: DateRangeQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const params: unknown[] = [orgId, query.from, query.to];
      let outletFilter = '';
      if (query.outletId) {
        params.push(query.outletId);
        outletFilter = `AND outlet_id = $${params.length}`;
      }

      const res = await client.query<HourlyRollupRow>(
        `SELECT date, hour, order_count, total_paise
         FROM analytics_hourly_outlet_rollups
         WHERE org_id = $1
           AND date >= $2::date
           AND date <= $3::date
           ${outletFilter}`,
        params,
      );

      const cells = res.rows.map((r) => {
        const dateStr = typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().split('T')[0]!;
        const dayOfWeek = new Date(dateStr + 'T00:00:00Z').getUTCDay();
        return {
          date: dateStr,
          hour: r.hour,
          dayOfWeek,
          orderCount: r.order_count,
          totalPaise: BigInt(r.total_paise),
        };
      });

      return {
        heatmap: buildHourlyHeatmap(cells),
      };
    });
  }

  // ─── Payment Mix ──────────────────────────────────────────────────────────────

  async getPaymentMix(orgId: string, query: DateRangeQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const params: unknown[] = [orgId, query.from, query.to];
      let outletFilter = '';
      if (query.outletId) {
        params.push(query.outletId);
        outletFilter = `AND outlet_id = $${params.length}`;
      }

      const res = await client.query<PaymentRollupRow>(
        `SELECT date, method, payment_count, amount_paise, fee_paise, net_paise
         FROM analytics_payment_daily_rollups
         WHERE org_id = $1
           AND date >= $2::date
           AND date <= $3::date
           ${outletFilter}`,
        params,
      );

      const data: PaymentRollupData[] = res.rows.map((r) => ({
        date: typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().split('T')[0]!,
        method: r.method,
        paymentCount: r.payment_count,
        amountPaise: BigInt(r.amount_paise),
        feePaise: BigInt(r.fee_paise),
        netPaise: BigInt(r.net_paise),
      }));

      return {
        paymentMix: calculatePaymentMix(data),
      };
    });
  }

  // ─── Customer Cohort ──────────────────────────────────────────────────────────

  async getCustomers(orgId: string, query: DateRangeQueryDto) {
    return withTenantContextRaw(orgId, async (client) => {
      const params: unknown[] = [orgId, query.from, query.to];
      let outletFilter = '';
      if (query.outletId) {
        params.push(query.outletId);
        outletFilter = `AND outlet_id = $${params.length}`;
      }

      const res = await client.query<{ customer_id: string | null; order_count: string }>(
        `SELECT customer_id, count(*)::text as order_count
         FROM orders
         WHERE org_id = $1
           AND created_at >= $2::date
           AND created_at < ($3::date + '1 day'::interval)
           AND status NOT IN ('CANCELLED', 'PENDING')
           ${outletFilter}
         GROUP BY customer_id`,
        params,
      );

      const customers = res.rows.map((r) => ({
        customerId: r.customer_id,
        orderCount: parseInt(r.order_count, 10),
      }));

      return calculateCustomerCohort(customers);
    });
  }

  // ─── Exports with Audit Trail ─────────────────────────────────────────────────

  async createExport(orgId: string, requestedBy: string, dto: CreateExportDto) {
    return withTenantContextRaw(orgId, async (client) => {
      // 1. Audit log entry per ARCH §17: "PII columns require analytics:view + audit entry"
      await client.query(
        `INSERT INTO audit_logs (org_id, actor_id, actor_type, action, resource, metadata)
         VALUES ($1, $2, 'staff', 'analytics.export', 'analytics_export', $3::jsonb)`,
        [
          orgId,
          requestedBy,
          JSON.stringify({
            exportType: dto.exportType,
            format: dto.format,
            outletId: dto.outletId ?? 'ALL',
            dateFrom: dto.dateFrom,
            dateTo: dto.dateTo,
          }),
        ],
      );

      // 2. Fetch data based on exportType
      let exportRows: Record<string, unknown>[] = [];

      if (dto.exportType === 'SALES') {
        const sales = await this.getSales(orgId, {
          from: dto.dateFrom,
          to: dto.dateTo,
          outletId: dto.outletId,
          comparison: 'none',
        });
        exportRows = sales.data.map((d) => ({
          date: d.date,
          orders: d.orderCount,
          gross_sales_paise: d.grossSalesPaise,
          subtotal_paise: d.subtotalPaise,
          tax_paise: d.taxPaise,
          discount_paise: d.discountPaise,
          refund_paise: d.refundPaise,
          net_sales_paise: d.netSalesPaise,
        }));
      } else if (dto.exportType === 'ITEMS') {
        const items = await this.getItems(orgId, {
          from: dto.dateFrom,
          to: dto.dateTo,
          outletId: dto.outletId,
          limit: 100,
        });
        exportRows = items.topItems.map((i) => ({
          menu_item_id: i.menuItemId,
          item_name: i.itemName,
          quantity_sold: i.quantitySold,
          total_sales_paise: i.totalSalesPaise,
        }));
      } else if (dto.exportType === 'PAYMENTS') {
        const pm = await this.getPaymentMix(orgId, {
          from: dto.dateFrom,
          to: dto.dateTo,
          outletId: dto.outletId,
          comparison: 'none',
        });
        exportRows = pm.paymentMix.map((p) => ({
          method: p.method,
          payment_count: p.paymentCount,
          amount_paise: p.amountPaise,
          fee_paise: p.feePaise,
          net_paise: p.netPaise,
          share_percent: p.percentage,
        }));
      } else {
        // ORDERS export
        const params: unknown[] = [orgId, dto.dateFrom, dto.dateTo];
        let outletFilter = '';
        if (dto.outletId) {
          params.push(dto.outletId);
          outletFilter = `AND outlet_id = $${params.length}`;
        }
        const ordersRes = await client.query<{
          id: string;
          created_at: Date;
          status: string;
          subtotal_paise: number;
          tax_paise: number;
          discount_paise: number;
          total_paise: number;
        }>(
          `SELECT id, created_at, status, subtotal_paise, tax_paise, discount_paise, total_paise
           FROM orders
           WHERE org_id = $1
             AND created_at >= $2::date
             AND created_at < ($3::date + '1 day'::interval)
             ${outletFilter}
           ORDER BY created_at DESC`,
          params,
        );
        exportRows = ordersRes.rows.map((o) => ({
          order_id: o.id,
          created_at: o.created_at.toISOString(),
          status: o.status,
          subtotal_paise: o.subtotal_paise,
          tax_paise: o.tax_paise,
          discount_paise: o.discount_paise,
          total_paise: o.total_paise,
        }));
      }

      // 3. Serialize content
      const content =
        dto.format === 'CSV'
          ? generateCsvExport(exportRows)
          : JSON.stringify(exportRows, null, 2);

      const fileSizeBytes = Buffer.byteLength(content, 'utf8');

      // 4. Save to analytics_exports
      const insertRes = await client.query<{ id: string }>(
        `INSERT INTO analytics_exports (
           org_id, outlet_id, requested_by, export_type, format, status,
           file_size_bytes, row_count, date_from, date_to, completed_at
         ) VALUES ($1, $2, $3, $4, $5, 'COMPLETED', $6, $7, $8, $9, now())
         RETURNING id`,
        [
          orgId,
          dto.outletId ?? null,
          requestedBy,
          dto.exportType,
          dto.format,
          fileSizeBytes,
          exportRows.length,
          dto.dateFrom,
          dto.dateTo,
        ],
      );

      const exportId = insertRes.rows[0]!.id;

      return {
        exportId,
        status: 'COMPLETED',
        format: dto.format,
        rowCount: exportRows.length,
        fileSizeBytes,
        content,
      };
    });
  }

  async listExports(orgId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `SELECT id, outlet_id, export_type, format, status, file_size_bytes,
                row_count, date_from, date_to, created_at, completed_at
         FROM analytics_exports
         WHERE org_id = $1
         ORDER BY created_at DESC
         LIMIT 20`,
        [orgId],
      );
      return res.rows;
    });
  }

  async getExport(orgId: string, exportId: string) {
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `SELECT id, outlet_id, export_type, format, status, file_size_bytes,
                row_count, date_from, date_to, created_at, completed_at
         FROM analytics_exports
         WHERE org_id = $1 AND id = $2`,
        [orgId, exportId],
      );
      if (res.rowCount === 0) {
        throw new NotFoundException(`Export ${exportId} not found`);
      }
      return res.rows[0];
    });
  }

  // ─── Private Helpers ──────────────────────────────────────────────────────────

  private async fetchDailyRollups(
    client: PoolClient,
    orgId: string,
    from: string,
    to: string,
    outletId?: string,
  ): Promise<DailyRollupData[]> {
    const params: unknown[] = [orgId, from, to];
    let outletFilter = '';
    if (outletId) {
      params.push(outletId);
      outletFilter = `AND outlet_id = $${params.length}`;
    }

    const res = await client.query<DailyRollupRow>(
      `SELECT date,
              SUM(order_count)::int as order_count,
              SUM(gross_sales_paise)::text as gross_sales_paise,
              SUM(subtotal_paise)::text as subtotal_paise,
              SUM(tax_paise)::text as tax_paise,
              SUM(discount_paise)::text as discount_paise,
              SUM(refund_paise)::text as refund_paise,
              SUM(net_sales_paise)::text as net_sales_paise,
              SUM(tip_paise)::text as tip_paise
       FROM analytics_daily_outlet_rollups
       WHERE org_id = $1
         AND date >= $2::date
         AND date <= $3::date
         ${outletFilter}
       GROUP BY date
       ORDER BY date ASC`,
      params,
    );

    return res.rows.map((r) => ({
      date: typeof r.date === 'string' ? r.date : (r.date as Date).toISOString().split('T')[0]!,
      orderCount: r.order_count,
      grossSalesPaise: BigInt(r.gross_sales_paise ?? '0'),
      subtotalPaise: BigInt(r.subtotal_paise ?? '0'),
      taxPaise: BigInt(r.tax_paise ?? '0'),
      discountPaise: BigInt(r.discount_paise ?? '0'),
      refundPaise: BigInt(r.refund_paise ?? '0'),
      netSalesPaise: BigInt(r.net_sales_paise ?? '0'),
      tipPaise: BigInt(r.tip_paise ?? '0'),
    }));
  }

  private computePreviousPeriod(from: string, to: string): { prevFrom: string; prevTo: string } {
    const dFrom = new Date(from + 'T00:00:00Z');
    const dTo = new Date(to + 'T00:00:00Z');
    const diffMs = dTo.getTime() - dFrom.getTime();
    const durationDays = Math.round(diffMs / (1000 * 60 * 60 * 24)) + 1;

    const prevToDate = new Date(dFrom.getTime() - 24 * 60 * 60 * 1000);
    const prevFromDate = new Date(prevToDate.getTime() - (durationDays - 1) * 24 * 60 * 60 * 1000);

    return {
      prevFrom: prevFromDate.toISOString().split('T')[0]!,
      prevTo: prevToDate.toISOString().split('T')[0]!,
    };
  }
}
