import { describe, it, expect } from 'vitest';
import {
  calculateOverviewMetrics,
  calculateItemPerformance,
  calculatePaymentMix,
  type DailyRollupData,
  type ItemRollupData,
  type PaymentRollupData,
} from '../analytics-calc.js';

describe('Analytics Reconciliation & Mathematical Invariants (Phase 6)', () => {
  it('reconciles rollup sums exactly against raw order components', () => {
    // Generate a simulated batch of 50 orders
    const orders = Array.from({ length: 50 }, (_, i) => {
      const subtotal = 10000 + i * 500;  // in paise (₹100 + i * ₹5)
      const tax = Math.round(subtotal * 0.05); // 5% GST
      const discount = i % 5 === 0 ? 2000 : 0; // ₹20 coupon every 5th order
      const total = subtotal + tax - discount;
      const refund = i % 10 === 0 ? 1000 : 0; // partial refund on some orders
      const tip = i % 3 === 0 ? 500 : 0;

      return {
        id: `order-${i}`,
        subtotalPaise: BigInt(subtotal),
        taxPaise: BigInt(tax),
        discountPaise: BigInt(discount),
        totalPaise: BigInt(total),
        refundPaise: BigInt(refund),
        tipPaise: BigInt(tip),
      };
    });

    // Compute expected raw totals
    let expectedGross = 0n;
    let expectedSubtotal = 0n;
    let expectedTax = 0n;
    let expectedDiscount = 0n;
    let expectedRefund = 0n;
    let expectedTip = 0n;

    for (const o of orders) {
      expectedGross += o.totalPaise;
      expectedSubtotal += o.subtotalPaise;
      expectedTax += o.taxPaise;
      expectedDiscount += o.discountPaise;
      expectedRefund += o.refundPaise;
      expectedTip += o.tipPaise;
    }

    const expectedNet = expectedGross - expectedRefund;

    // Simulate daily rollups built from the raw orders
    const rollup: DailyRollupData = {
      date: '2026-10-26',
      orderCount: orders.length,
      grossSalesPaise: expectedGross,
      subtotalPaise: expectedSubtotal,
      taxPaise: expectedTax,
      discountPaise: expectedDiscount,
      refundPaise: expectedRefund,
      netSalesPaise: expectedNet,
      tipPaise: expectedTip,
    };

    const overview = calculateOverviewMetrics([rollup]);

    // Invariant 1: Order count equals raw count
    expect(overview.current.orderCount).toBe(50);

    // Invariant 2: Gross sales exactly equals sum of raw total_paise
    expect(BigInt(overview.current.grossSalesPaise)).toBe(expectedGross);

    // Invariant 3: Subtotal matches exactly
    expect(BigInt(overview.current.subtotalPaise)).toBe(expectedSubtotal);

    // Invariant 4: Tax matches exactly
    expect(BigInt(overview.current.taxPaise)).toBe(expectedTax);

    // Invariant 5: Discount matches exactly
    expect(BigInt(overview.current.discountPaise)).toBe(expectedDiscount);

    // Invariant 6: Net sales + refund equals gross sales (no paise leaked)
    const netPlusRefund = BigInt(overview.current.netSalesPaise) + BigInt(overview.current.refundPaise);
    expect(netPlusRefund).toBe(BigInt(overview.current.grossSalesPaise));

    // Invariant 7: Average Order Value * count is within integer truncation delta of net sales
    const aov = BigInt(overview.current.averageOrderValuePaise);
    const reconstructedNet = aov * BigInt(overview.current.orderCount);
    const diff = expectedNet - reconstructedNet;
    expect(diff >= 0n && diff < BigInt(overview.current.orderCount)).toBe(true);
  });

  it('reconciles item rollup total revenue with order items', () => {
    const rawItems = [
      { id: 'item-1', name: 'Biryani', qty: 10, unitPaise: 30000 },
      { id: 'item-2', name: 'Raita', qty: 10, unitPaise: 5000 },
      { id: 'item-3', name: 'Gulab Jamun', qty: 5, unitPaise: 6000 },
    ];

    let rawTotalSales = 0n;
    const itemRollups: ItemRollupData[] = rawItems.map((ri) => {
      const lineTotal = BigInt(ri.qty * ri.unitPaise);
      rawTotalSales += lineTotal;
      return {
        menuItemId: ri.id,
        itemName: ri.name,
        date: '2026-10-26',
        quantitySold: ri.qty,
        totalSalesPaise: lineTotal,
      };
    });

    const perf = calculateItemPerformance(itemRollups, 10);
    const topSum = perf.topItems.reduce((acc, i) => acc + BigInt(i.totalSalesPaise), 0n);

    expect(topSum).toBe(rawTotalSales);
  });

  it('reconciles payment mix sums with raw payments', () => {
    const rawPayments: PaymentRollupData[] = [
      { date: '2026-10-26', method: 'UPI', paymentCount: 30, amountPaise: 300000n, feePaise: 0n, netPaise: 300000n },
      { date: '2026-10-26', method: 'CARD', paymentCount: 15, amountPaise: 150000n, feePaise: 3000n, netPaise: 147000n },
      { date: '2026-10-26', method: 'CASH', paymentCount: 5, amountPaise: 50000n, feePaise: 0n, netPaise: 50000n },
    ];

    const mix = calculatePaymentMix(rawPayments);
    const totalMixAmount = mix.reduce((acc, m) => acc + BigInt(m.amountPaise), 0n);
    const totalMixNet = mix.reduce((acc, m) => acc + BigInt(m.netPaise), 0n);
    const totalMixFee = mix.reduce((acc, m) => acc + BigInt(m.feePaise), 0n);

    expect(totalMixAmount).toBe(500000n);
    expect(totalMixFee).toBe(3000n);
    expect(totalMixNet).toBe(497000n);
    expect(totalMixNet + totalMixFee).toBe(totalMixAmount);

    // Percentage shares sum to 100%
    const totalPct = mix.reduce((acc, m) => acc + m.percentage, 0);
    expect(Math.round(totalPct)).toBe(100);
  });
});
