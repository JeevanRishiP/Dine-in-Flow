import { describe, it, expect } from 'vitest';
import {
  calculateOverviewMetrics,
  calculatePercentageChange,
  buildTimeSeries,
  buildHourlyHeatmap,
  calculateItemPerformance,
  calculatePaymentMix,
  calculateCustomerCohort,
  dateToOutletLocal,
  generateCsvExport,
  type DailyRollupData,
  type ItemRollupData,
  type PaymentRollupData,
} from '../analytics-calc.js';

describe('Analytics Pure Calculation Engine', () => {
  describe('calculateOverviewMetrics', () => {
    it('aggregates daily rollups accurately with integer paise precision', () => {
      const currentRollups: DailyRollupData[] = [
        {
          date: '2026-10-01',
          orderCount: 10,
          grossSalesPaise: 500000n, // ₹5,000.00
          subtotalPaise: 450000n,
          taxPaise: 25000n,
          discountPaise: 10000n,
          refundPaise: 5000n,
          netSalesPaise: 485000n,   // 500000 - 10000 - 5000
          tipPaise: 2000n,
        },
        {
          date: '2026-10-02',
          orderCount: 20,
          grossSalesPaise: 1000000n, // ₹10,000.00
          subtotalPaise: 900000n,
          taxPaise: 50000n,
          discountPaise: 20000n,
          refundPaise: 0n,
          netSalesPaise: 980000n,
          tipPaise: 5000n,
        },
      ];

      const res = calculateOverviewMetrics(currentRollups);

      expect(res.current.orderCount).toBe(30);
      expect(res.current.grossSalesPaise).toBe('1500000');
      expect(res.current.subtotalPaise).toBe('1350000');
      expect(res.current.taxPaise).toBe('75000');
      expect(res.current.discountPaise).toBe('30000');
      expect(res.current.refundPaise).toBe('5000');
      expect(res.current.netSalesPaise).toBe('1465000');
      expect(res.current.tipPaise).toBe('7000');
      // AOV = 1465000 / 30 = 48833 paise
      expect(res.current.averageOrderValuePaise).toBe('48833');
      expect(res.comparison).toBeUndefined();
    });

    it('calculates comparison delta percentages accurately', () => {
      const current: DailyRollupData[] = [
        {
          date: '2026-10-02',
          orderCount: 15,
          grossSalesPaise: 150000n,
          subtotalPaise: 140000n,
          taxPaise: 10000n,
          discountPaise: 0n,
          refundPaise: 0n,
          netSalesPaise: 150000n,
          tipPaise: 0n,
        },
      ];
      const previous: DailyRollupData[] = [
        {
          date: '2026-10-01',
          orderCount: 10,
          grossSalesPaise: 100000n,
          subtotalPaise: 90000n,
          taxPaise: 10000n,
          discountPaise: 0n,
          refundPaise: 0n,
          netSalesPaise: 100000n,
          tipPaise: 0n,
        },
      ];

      const res = calculateOverviewMetrics(current, previous);
      expect(res.comparison).toBeDefined();
      expect(res.comparison?.orderCount).toBe(10);
      expect(res.comparison?.netSalesPaise).toBe('100000');
      // Order count change: (15 - 10) / 10 = +50%
      expect(res.comparison?.orderCountChangePct).toBe(50);
      // Net sales change: (150000 - 100000) / 100000 = +50%
      expect(res.comparison?.netSalesChangePct).toBe(50);
    });

    it('handles zero orders and zero previous period without throwing', () => {
      const res = calculateOverviewMetrics([], []);
      expect(res.current.orderCount).toBe(0);
      expect(res.current.netSalesPaise).toBe('0');
      expect(res.current.averageOrderValuePaise).toBe('0');
      expect(res.comparison?.netSalesChangePct).toBe(0);
    });
  });

  describe('calculatePercentageChange', () => {
    it('computes positive and negative percentage changes with 2 decimal precision', () => {
      expect(calculatePercentageChange(100n, 125n)).toBe(25);
      expect(calculatePercentageChange(100n, 75n)).toBe(-25);
      expect(calculatePercentageChange(1000n, 1005n)).toBe(0.5);
      expect(calculatePercentageChange(0n, 50n)).toBe(100);
      expect(calculatePercentageChange(0n, 0n)).toBe(0);
    });
  });

  describe('buildTimeSeries', () => {
    it('fills gap dates with zeros across date range', () => {
      const rollups: DailyRollupData[] = [
        {
          date: '2026-10-01',
          orderCount: 5,
          grossSalesPaise: 50000n,
          subtotalPaise: 45000n,
          taxPaise: 5000n,
          discountPaise: 0n,
          refundPaise: 0n,
          netSalesPaise: 50000n,
          tipPaise: 0n,
        },
        // 2026-10-02 missing
        {
          date: '2026-10-03',
          orderCount: 8,
          grossSalesPaise: 80000n,
          subtotalPaise: 72000n,
          taxPaise: 8000n,
          discountPaise: 0n,
          refundPaise: 0n,
          netSalesPaise: 80000n,
          tipPaise: 0n,
        },
      ];

      const series = buildTimeSeries(rollups, '2026-10-01', '2026-10-03');
      expect(series).toHaveLength(3);
      expect(series[0]?.date).toBe('2026-10-01');
      expect(series[0]?.orderCount).toBe(5);

      // Gap date filled with 0s
      expect(series[1]?.date).toBe('2026-10-02');
      expect(series[1]?.orderCount).toBe(0);
      expect(series[1]?.netSalesPaise).toBe('0');

      expect(series[2]?.date).toBe('2026-10-03');
      expect(series[2]?.orderCount).toBe(8);
    });
  });

  describe('buildHourlyHeatmap', () => {
    it('creates complete 168-cell grid (7 days x 24 hours)', () => {
      const hourly = [
        {
          date: '2026-10-01',
          dayOfWeek: 1, // Monday
          hour: 13,     // 1 PM
          orderCount: 12,
          totalPaise: 120000n,
        },
      ];

      const heatmap = buildHourlyHeatmap(hourly);
      expect(heatmap).toHaveLength(7 * 24); // 168

      const target = heatmap.find((c) => c.dayOfWeek === 1 && c.hour === 13);
      expect(target).toBeDefined();
      expect(target?.orderCount).toBe(12);
      expect(target?.totalPaise).toBe('120000');

      const empty = heatmap.find((c) => c.dayOfWeek === 0 && c.hour === 0);
      expect(empty?.orderCount).toBe(0);
      expect(empty?.totalPaise).toBe('0');
    });
  });

  describe('calculateItemPerformance', () => {
    it('aggregates and sorts items by total sales', () => {
      const items: ItemRollupData[] = [
        {
          menuItemId: 'item-1',
          itemName: 'Paneer Butter Masala',
          date: '2026-10-01',
          quantitySold: 5,
          totalSalesPaise: 150000n,
        },
        {
          menuItemId: 'item-2',
          itemName: 'Butter Naan',
          date: '2026-10-01',
          quantitySold: 20,
          totalSalesPaise: 80000n,
        },
        {
          menuItemId: 'item-1',
          itemName: 'Paneer Butter Masala',
          date: '2026-10-02',
          quantitySold: 3,
          totalSalesPaise: 90000n, // item-1 total = 240000
        },
        {
          menuItemId: 'item-3',
          itemName: 'Gulab Jamun',
          date: '2026-10-01',
          quantitySold: 2,
          totalSalesPaise: 10000n,
        },
      ];

      const res = calculateItemPerformance(items, 2);

      // Top items
      expect(res.topItems).toHaveLength(2);
      expect(res.topItems[0]?.itemName).toBe('Paneer Butter Masala');
      expect(res.topItems[0]?.quantitySold).toBe(8);
      expect(res.topItems[0]?.totalSalesPaise).toBe('240000');
      expect(res.topItems[1]?.itemName).toBe('Butter Naan');

      // Bottom items
      expect(res.bottomItems).toHaveLength(2);
      expect(res.bottomItems[0]?.itemName).toBe('Gulab Jamun');
      expect(res.bottomItems[0]?.totalSalesPaise).toBe('10000');
    });
  });

  describe('calculatePaymentMix', () => {
    it('aggregates payment methods and calculates percentage shares', () => {
      const payments: PaymentRollupData[] = [
        {
          date: '2026-10-01',
          method: 'UPI',
          paymentCount: 15,
          amountPaise: 750000n, // 75%
          feePaise: 0n,
          netPaise: 750000n,
        },
        {
          date: '2026-10-01',
          method: 'CARD',
          paymentCount: 5,
          amountPaise: 250000n, // 25%
          feePaise: 5000n,
          netPaise: 245000n,
        },
      ];

      const mix = calculatePaymentMix(payments);
      expect(mix).toHaveLength(2);
      expect(mix[0]?.method).toBe('UPI');
      expect(mix[0]?.percentage).toBe(75);
      expect(mix[1]?.method).toBe('CARD');
      expect(mix[1]?.percentage).toBe(25);
      expect(mix[1]?.feePaise).toBe('5000');
      expect(mix[1]?.netPaise).toBe('245000');
    });
  });

  describe('calculateCustomerCohort', () => {
    it('determines new vs returning customer ratio and repeat rate', () => {
      const customers = [
        { customerId: 'cust-1', orderCount: 1 },
        { customerId: 'cust-2', orderCount: 3 },
        { customerId: 'cust-3', orderCount: 1 },
        { customerId: 'cust-4', orderCount: 5 },
        { customerId: null, orderCount: 2 }, // guest order excluded from customer cohort
      ];

      const cohort = calculateCustomerCohort(customers);
      expect(cohort.totalCustomers).toBe(4);
      expect(cohort.newCustomers).toBe(2);
      expect(cohort.returningCustomers).toBe(2);
      expect(cohort.repeatRatePercent).toBe(50);
    });
  });

  describe('dateToOutletLocal', () => {
    it('converts UTC timestamps across midnight accurately in Asia/Kolkata (UTC+5:30)', () => {
      // 2026-10-26 19:30 UTC -> 2026-10-27 01:00 IST (+1 day)
      const resNextDay = dateToOutletLocal('2026-10-26T19:30:00Z', 'Asia/Kolkata');
      expect(resNextDay.localDate).toBe('2026-10-27');
      expect(resNextDay.localHour).toBe(1);

      // 2026-10-26 04:00 UTC -> 2026-10-26 09:30 IST (same day)
      const resSameDay = dateToOutletLocal('2026-10-26T04:00:00Z', 'Asia/Kolkata');
      expect(resSameDay.localDate).toBe('2026-10-26');
      expect(resSameDay.localHour).toBe(9);
    });
  });

  describe('generateCsvExport', () => {
    it('formats RFC 4180 CSV with quotes when cells contain commas or quotes', () => {
      const rows = [
        { item: 'Idli, Sambar', price: 50, note: 'Special "Chef" recipe' },
        { item: 'Dosa', price: 80, note: 'Crispy' },
      ];

      const csv = generateCsvExport(rows);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('item,price,note');
      expect(lines[1]).toBe('"Idli, Sambar",50,"Special ""Chef"" recipe"');
      expect(lines[2]).toBe('Dosa,80,Crispy');
    });

    it('neutralizes CSV formula injection prefixes (=, +, -, @)', () => {
      const rows = [
        { name: '=cmd|"/C calc"!A0', formula: '+1+1', neg: '-2+3', at: '@SUM(A1)' },
      ];
      const csv = generateCsvExport(rows);
      const dataLine = csv.split('\n')[1]!;
      expect(dataLine).toContain('\'=cmd');
      expect(dataLine).toContain(',\'+1+1,');
      expect(dataLine).toContain(',\'-2+3,');
      expect(dataLine).toContain(',\'@SUM(A1)');
    });
  });
});
