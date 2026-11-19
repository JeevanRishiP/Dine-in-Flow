import type { Payment, Order } from '../../../app/lib/restaurant-db';

/**
 * Calculates total billed sales in paise from a list of payments.
 * Strictly integer minor units (paise), preventing floating-point inaccuracies.
 */
export function calculateTotalBilledPaise(payments: readonly Payment[]): number {
  return payments.reduce(
    (acc, p) => acc + (p.status === 'PAID' || !p.status ? p.amountPaise : 0),
    0
  );
}

/**
 * Filters settled payments by a specific payment method or list of methods.
 */
export function filterPaymentsByMethod(
  payments: readonly Payment[],
  methods: Payment['method'] | readonly Payment['method'][]
): Payment[] {
  const methodList = Array.isArray(methods) ? methods : [methods];
  return payments.filter((p) => methodList.includes(p.method));
}

/**
 * Calculates total billed amount in paise for specific payment methods
 * (e.g., UPI / DIRECT_UPI_STAFF, or CASH).
 */
export function calculateMethodTotalPaise(
  payments: readonly Payment[],
  methods: Payment['method'] | readonly Payment['method'][]
): number {
  return calculateTotalBilledPaise(filterPaymentsByMethod(payments, methods));
}

export interface GstBreakdown {
  subtotalPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  totalGstPaise: number;
  totalPaise: number;
}

/**
 * Calculates itemized GST breakdown (CGST 2.5% + SGST 2.5% for standard 5% restaurant dine-in).
 * Uses integer paise without floating-point drift.
 */
export function calculateGstBreakdown(totalPaise: number, gstRatePercent = 5): GstBreakdown {
  if (totalPaise <= 0) {
    return {
      subtotalPaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      totalGstPaise: 0,
      totalPaise: 0,
    };
  }

  // Inclusive GST calculation: subtotal = round((total * 100) / (100 + rate))
  const subtotalPaise = Math.round((totalPaise * 100) / (100 + gstRatePercent));
  const totalGstPaise = totalPaise - subtotalPaise;
  const cgstPaise = Math.floor(totalGstPaise / 2);
  const sgstPaise = totalGstPaise - cgstPaise;

  return {
    subtotalPaise,
    cgstPaise,
    sgstPaise,
    totalGstPaise,
    totalPaise,
  };
}

/**
 * Calculates cash change due in paise.
 * Returns 0 if cash tendered is less than or equal to bill total.
 */
export function calculateCashChangePaise(
  billTotalPaise: number,
  cashTenderedPaise: number
): number {
  return Math.max(0, cashTenderedPaise - billTotalPaise);
}

/**
 * Generates a settled payment record for an order.
 */
export function createSettledPaymentRecord(
  order: Pick<Order, 'id' | 'displayId' | 'tableNumber' | 'totalPaise' | 'customerName'>,
  method: Payment['method'],
  idGenerator: () => string = () =>
    `pay-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
): Payment {
  return {
    id: idGenerator(),
    orderId: order.id,
    displayId: order.displayId,
    tableNumber: order.tableNumber,
    method,
    status: 'PAID',
    amountPaise: order.totalPaise,
    gatewayFeePaise: 0,
    netDepositedPaise: order.totalPaise,
    timestamp: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    customerName: order.customerName || `Guest Table ${order.tableNumber}`,
  };
}
