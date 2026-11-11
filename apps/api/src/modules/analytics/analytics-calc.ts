/**
 * Analytics Pure Calculation Engine
 *
 * All business logic, aggregation math, metrics calculations, and timezone
 * conversions are isolated here as pure functions for exhaustive testing.
 *
 * Rules:
 * - AGENTS §2 rule 1: All money in integer paise (bigint), never floating point.
 * - Timezone-aware date conversions for restaurant business days.
 * - Reference: ARCH §17, §15, §25
 */

export interface DailyRollupData {
  date: string;
  orderCount: number;
  grossSalesPaise: bigint;
  subtotalPaise: bigint;
  taxPaise: bigint;
  discountPaise: bigint;
  refundPaise: bigint;
  netSalesPaise: bigint;
  tipPaise: bigint;
}

export interface HourlyRollupData {
  date: string;
  hour: number;
  orderCount: number;
  totalPaise: bigint;
}

export interface ItemRollupData {
  menuItemId: string;
  itemName: string;
  date: string;
  quantitySold: number;
  totalSalesPaise: bigint;
}

export interface PaymentRollupData {
  date: string;
  method: string;
  paymentCount: number;
  amountPaise: bigint;
  feePaise: bigint;
  netPaise: bigint;
}

export interface OverviewMetrics {
  current: {
    orderCount: number;
    grossSalesPaise: string;
    subtotalPaise: string;
    taxPaise: string;
    discountPaise: string;
    refundPaise: string;
    netSalesPaise: string;
    tipPaise: string;
    averageOrderValuePaise: string;
  };
  comparison?: {
    orderCount: number;
    netSalesPaise: string;
    averageOrderValuePaise: string;
    orderCountChangePct: number;
    netSalesChangePct: number;
    aovChangePct: number;
  };
}

export interface HeatmapCell {
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  hour: number;      // 0 .. 23
  orderCount: number;
  totalPaise: string;
}

export interface PaymentMixItem {
  method: string;
  paymentCount: number;
  amountPaise: string;
  feePaise: string;
  netPaise: string;
  percentage: number;
}

export interface CustomerCohortMetrics {
  totalCustomers: number;
  newCustomers: number;
  returningCustomers: number;
  repeatRatePercent: number;
}

/**
 * Compute overview aggregate stats across a set of daily rollups.
 */
export function calculateOverviewMetrics(
  currentRollups: DailyRollupData[],
  previousRollups?: DailyRollupData[],
): OverviewMetrics {
  let orderCount = 0;
  let grossSalesPaise = 0n;
  let subtotalPaise = 0n;
  let taxPaise = 0n;
  let discountPaise = 0n;
  let refundPaise = 0n;
  let netSalesPaise = 0n;
  let tipPaise = 0n;

  for (const r of currentRollups) {
    orderCount += r.orderCount;
    grossSalesPaise += r.grossSalesPaise;
    subtotalPaise += r.subtotalPaise;
    taxPaise += r.taxPaise;
    discountPaise += r.discountPaise;
    refundPaise += r.refundPaise;
    netSalesPaise += r.netSalesPaise;
    tipPaise += r.tipPaise;
  }

  const aov = orderCount > 0 ? netSalesPaise / BigInt(orderCount) : 0n;

  const result: OverviewMetrics = {
    current: {
      orderCount,
      grossSalesPaise: grossSalesPaise.toString(),
      subtotalPaise: subtotalPaise.toString(),
      taxPaise: taxPaise.toString(),
      discountPaise: discountPaise.toString(),
      refundPaise: refundPaise.toString(),
      netSalesPaise: netSalesPaise.toString(),
      tipPaise: tipPaise.toString(),
      averageOrderValuePaise: aov.toString(),
    },
  };

  if (previousRollups) {
    let prevOrderCount = 0;
    let prevNetSalesPaise = 0n;
    for (const r of previousRollups) {
      prevOrderCount += r.orderCount;
      prevNetSalesPaise += r.netSalesPaise;
    }
    const prevAov = prevOrderCount > 0 ? prevNetSalesPaise / BigInt(prevOrderCount) : 0n;

    result.comparison = {
      orderCount: prevOrderCount,
      netSalesPaise: prevNetSalesPaise.toString(),
      averageOrderValuePaise: prevAov.toString(),
      orderCountChangePct: calculatePercentageChange(BigInt(prevOrderCount), BigInt(orderCount)),
      netSalesChangePct: calculatePercentageChange(prevNetSalesPaise, netSalesPaise),
      aovChangePct: calculatePercentageChange(prevAov, aov),
    };
  }

  return result;
}

/**
 * Calculates percentage change between two BigInt values rounded to 2 decimal places.
 */
export function calculatePercentageChange(prev: bigint, curr: bigint): number {
  if (prev === 0n) {
    return curr === 0n ? 0 : 100;
  }
  const diff = curr - prev;
  // Multiply by 10000 for 2 decimal precision: (diff / prev) * 100
  const scaled = (diff * 10000n) / prev;
  return Number(scaled) / 100;
}

export interface DailyTimeSeriesPoint {
  date: string;
  orderCount: number;
  grossSalesPaise: string;
  subtotalPaise: string;
  taxPaise: string;
  discountPaise: string;
  refundPaise: string;
  netSalesPaise: string;
  tipPaise: string;
}

/**
 * Generates continuous daily time series between fromDate and toDate (inclusive),
 * filling empty days with 0 metrics.
 */
export function buildTimeSeries(
  rollups: DailyRollupData[],
  fromDate: string,
  toDate: string,
): DailyTimeSeriesPoint[] {
  const map = new Map<string, DailyRollupData>();
  for (const r of rollups) {
    map.set(r.date, r);
  }

  const results = [];
  const curr = new Date(fromDate + 'T00:00:00Z');
  const end = new Date(toDate + 'T00:00:00Z');

  while (curr <= end) {
    const dateStr = curr.toISOString().split('T')[0]!;
    const entry = map.get(dateStr) ?? {
      date: dateStr,
      orderCount: 0,
      grossSalesPaise: 0n,
      subtotalPaise: 0n,
      taxPaise: 0n,
      discountPaise: 0n,
      refundPaise: 0n,
      netSalesPaise: 0n,
      tipPaise: 0n,
    };

    results.push({
      date: entry.date,
      orderCount: entry.orderCount,
      grossSalesPaise: entry.grossSalesPaise.toString(),
      subtotalPaise: entry.subtotalPaise.toString(),
      taxPaise: entry.taxPaise.toString(),
      discountPaise: entry.discountPaise.toString(),
      refundPaise: entry.refundPaise.toString(),
      netSalesPaise: entry.netSalesPaise.toString(),
      tipPaise: entry.tipPaise.toString(),
    });

    curr.setUTCDate(curr.getUTCDate() + 1);
  }

  return results;
}

/**
 * Build complete 7-day x 24-hour heatmap from hourly rollups.
 */
export function buildHourlyHeatmap(
  hourlyRollups: Array<HourlyRollupData & { dayOfWeek: number }>,
): HeatmapCell[] {
  // Map key: "dayOfWeek:hour"
  const grid = new Map<string, { count: number; total: bigint }>();

  for (const r of hourlyRollups) {
    const key = `${r.dayOfWeek}:${r.hour}`;
    const existing = grid.get(key) ?? { count: 0, total: 0n };
    existing.count += r.orderCount;
    existing.total += r.totalPaise;
    grid.set(key, existing);
  }

  const cells: HeatmapCell[] = [];
  for (let day = 0; day < 7; day++) {
    for (let hour = 0; hour < 24; hour++) {
      const entry = grid.get(`${day}:${hour}`) ?? { count: 0, total: 0n };
      cells.push({
        dayOfWeek: day,
        hour,
        orderCount: entry.count,
        totalPaise: entry.total.toString(),
      });
    }
  }

  return cells;
}

/**
 * Aggregate item performance and return top/bottom ranked items.
 */
export function calculateItemPerformance(
  items: ItemRollupData[],
  limit = 10,
): {
  topItems: Array<{ menuItemId: string; itemName: string; quantitySold: number; totalSalesPaise: string }>;
  bottomItems: Array<{ menuItemId: string; itemName: string; quantitySold: number; totalSalesPaise: string }>;
} {
  const map = new Map<string, { menuItemId: string; itemName: string; quantitySold: number; totalSalesPaise: bigint }>();

  for (const item of items) {
    const existing = map.get(item.menuItemId) ?? {
      menuItemId: item.menuItemId,
      itemName: item.itemName,
      quantitySold: 0,
      totalSalesPaise: 0n,
    };
    existing.quantitySold += item.quantitySold;
    existing.totalSalesPaise += item.totalSalesPaise;
    map.set(item.menuItemId, existing);
  }

  const list = Array.from(map.values());
  const sortedDesc = [...list].sort((a, b) => (b.totalSalesPaise > a.totalSalesPaise ? 1 : b.totalSalesPaise < a.totalSalesPaise ? -1 : 0));
  const sortedAsc = [...list].sort((a, b) => (a.totalSalesPaise > b.totalSalesPaise ? 1 : a.totalSalesPaise < b.totalSalesPaise ? -1 : 0));

  return {
    topItems: sortedDesc.slice(0, limit).map((i) => ({
      ...i,
      totalSalesPaise: i.totalSalesPaise.toString(),
    })),
    bottomItems: sortedAsc.slice(0, limit).map((i) => ({
      ...i,
      totalSalesPaise: i.totalSalesPaise.toString(),
    })),
  };
}

/**
 * Aggregate payment mix metrics by method with percentage shares.
 */
export function calculatePaymentMix(payments: PaymentRollupData[]): PaymentMixItem[] {
  const map = new Map<string, { count: number; amount: bigint; fee: bigint; net: bigint }>();
  let totalAmount = 0n;

  for (const p of payments) {
    const existing = map.get(p.method) ?? { count: 0, amount: 0n, fee: 0n, net: 0n };
    existing.count += p.paymentCount;
    existing.amount += p.amountPaise;
    existing.fee += p.feePaise;
    existing.net += p.netPaise;
    map.set(p.method, existing);
    totalAmount += p.amountPaise;
  }

  const result: PaymentMixItem[] = [];
  for (const [method, data] of map.entries()) {
    const percentage = totalAmount > 0n
      ? Number((data.amount * 10000n) / totalAmount) / 100
      : 0;

    result.push({
      method,
      paymentCount: data.count,
      amountPaise: data.amount.toString(),
      feePaise: data.fee.toString(),
      netPaise: data.net.toString(),
      percentage,
    });
  }

  return result.sort((a, b) => Number(BigInt(b.amountPaise) - BigInt(a.amountPaise)));
}

/**
 * Calculates new vs returning customers from distinct customer order history.
 */
export function calculateCustomerCohort(
  customers: Array<{ customerId: string | null; orderCount: number }>,
): CustomerCohortMetrics {
  const known = customers.filter((c) => c.customerId !== null);
  const totalCustomers = known.length;
  if (totalCustomers === 0) {
    return {
      totalCustomers: 0,
      newCustomers: 0,
      returningCustomers: 0,
      repeatRatePercent: 0,
    };
  }

  let newCustomers = 0;
  let returningCustomers = 0;

  for (const c of known) {
    if (c.orderCount === 1) {
      newCustomers++;
    } else {
      returningCustomers++;
    }
  }

  const repeatRate = Number((BigInt(returningCustomers) * 10000n) / BigInt(totalCustomers)) / 100;

  return {
    totalCustomers,
    newCustomers,
    returningCustomers,
    repeatRatePercent: repeatRate,
  };
}

/**
 * Timezone-aware date parts extractor using standard Intl.DateTimeFormat.
 * Handles restaurant business days accurately per outlet timezone.
 */
export function dateToOutletLocal(
  utcDate: Date | string,
  timeZone = 'Asia/Kolkata',
): { localDate: string; localHour: number; dayOfWeek: number } {
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;

  // Format parts in target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    hourCycle: 'h23',
    weekday: 'short',
  });

  const parts = formatter.formatToParts(d);
  let year = '';
  let month = '';
  let day = '';
  let hour = '0';
  let weekday = '';

  for (const p of parts) {
    if (p.type === 'year') year = p.value;
    if (p.type === 'month') month = p.value;
    if (p.type === 'day') day = p.value;
    if (p.type === 'hour') hour = p.value;
    if (p.type === 'weekday') weekday = p.value;
  }

  const dayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    localDate: `${year}-${month}-${day}`,
    localHour: parseInt(hour, 10),
    dayOfWeek: dayMap[weekday] ?? 0,
  };
}

/**
 * Export formatter: formats arbitrary objects as sanitized RFC 4180 CSV.
 */
export function generateCsvExport(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0]!);

  const escapeCell = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const str = String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.map(escapeCell).join(','),
    ...rows.map((row) => headers.map((h) => escapeCell(row[h])).join(',')),
  ];

  return lines.join('\n');
}
