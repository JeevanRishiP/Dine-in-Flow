import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTotalBilledPaise,
  filterPaymentsByMethod,
  calculateMethodTotalPaise,
  calculateGstBreakdown,
  calculateCashChangePaise,
  createSettledPaymentRecord,
} from './pos-utils.ts';
import type { Payment, Order } from '../../../app/lib/restaurant-db.ts';

describe('pos-utils - Cashier & Billing POS Domain Logic', () => {
  const mockPayments: Payment[] = [
    {
      id: 'pay-1',
      orderId: 'ord-1',
      displayId: 'RS-1001',
      tableNumber: 'T01',
      method: 'DIRECT_UPI_STAFF',
      status: 'PAID',
      amountPaise: 45000,
      gatewayFeePaise: 0,
      netDepositedPaise: 45000,
      timestamp: '12:30 PM',
      customerName: 'Aarav Sharma',
    },
    {
      id: 'pay-2',
      orderId: 'ord-2',
      displayId: 'RS-1002',
      tableNumber: 'T02',
      method: 'UPI',
      status: 'PAID',
      amountPaise: 35000,
      gatewayFeePaise: 0,
      netDepositedPaise: 35000,
      timestamp: '01:15 PM',
      customerName: 'Priya Patel',
    },
    {
      id: 'pay-3',
      orderId: 'ord-3',
      displayId: 'RS-1003',
      tableNumber: 'T03',
      method: 'CASH',
      status: 'PAID',
      amountPaise: 20000,
      gatewayFeePaise: 0,
      netDepositedPaise: 20000,
      timestamp: '01:45 PM',
      customerName: 'Rohan Gupta',
    },
    {
      id: 'pay-4',
      orderId: 'ord-4',
      displayId: 'RS-1004',
      tableNumber: 'T04',
      method: 'CARD',
      status: 'PAID',
      amountPaise: 60000,
      gatewayFeePaise: 1200,
      netDepositedPaise: 58800,
      timestamp: '02:00 PM',
      customerName: 'Vikram Mehta',
    },
    {
      id: 'pay-5',
      orderId: 'ord-5',
      displayId: 'RS-1005',
      tableNumber: 'T05',
      method: 'UPI',
      status: 'FAILED',
      amountPaise: 15000,
      gatewayFeePaise: 0,
      netDepositedPaise: 0,
      timestamp: '02:15 PM',
      customerName: 'Sneha Rao',
    },
  ];

  describe('calculateTotalBilledPaise', () => {
    it('sums amountPaise for all paid transactions in integer minor units', () => {
      // 45000 + 35000 + 20000 + 60000 = 160000 (excluding failed pay-5)
      const total = calculateTotalBilledPaise(mockPayments);
      assert.equal(total, 160000);
    });

    it('returns 0 for empty payment lists', () => {
      assert.equal(calculateTotalBilledPaise([]), 0);
    });
  });

  describe('filterPaymentsByMethod & calculateMethodTotalPaise', () => {
    it('filters payments by single method', () => {
      const cashPayments = filterPaymentsByMethod(mockPayments, 'CASH');
      assert.equal(cashPayments.length, 1);
      assert.equal(cashPayments[0]?.id, 'pay-3');
    });

    it('filters payments by multiple methods (UPI & DIRECT_UPI_STAFF)', () => {
      const upiPayments = filterPaymentsByMethod(mockPayments, ['UPI', 'DIRECT_UPI_STAFF']);
      assert.equal(upiPayments.length, 3); // pay-1, pay-2, pay-5
      const paidUpiTotal = calculateMethodTotalPaise(mockPayments, ['UPI', 'DIRECT_UPI_STAFF']);
      assert.equal(paidUpiTotal, 80000); // 45000 + 35000 (excluding pay-5 failed)
    });

    it('calculates cash till total correctly', () => {
      const cashTotal = calculateMethodTotalPaise(mockPayments, 'CASH');
      assert.equal(cashTotal, 20000);
    });
  });

  describe('calculateGstBreakdown', () => {
    it('calculates 5% inclusive GST (2.5% CGST + 2.5% SGST) without precision drift', () => {
      // e.g. 10500 paise bill -> 10000 subtotal, 500 tax (250 CGST, 250 SGST)
      const gst = calculateGstBreakdown(10500, 5);
      assert.equal(gst.totalPaise, 10500);
      assert.equal(gst.subtotalPaise, 10000);
      assert.equal(gst.totalGstPaise, 500);
      assert.equal(gst.cgstPaise, 250);
      assert.equal(gst.sgstPaise, 250);
      assert.equal(gst.subtotalPaise + gst.cgstPaise + gst.sgstPaise, gst.totalPaise);
    });

    it('handles odd paise tax splits correctly preserving total', () => {
      // e.g. 1000 paise bill -> subtotal = round(100000 / 105) = 952 paise
      // totalGst = 48 paise -> cgst = 24, sgst = 24
      const gst = calculateGstBreakdown(1000, 5);
      assert.equal(gst.totalPaise, 1000);
      assert.equal(gst.subtotalPaise + gst.cgstPaise + gst.sgstPaise, gst.totalPaise);
    });

    it('returns zero for non-positive amounts', () => {
      const zeroGst = calculateGstBreakdown(0);
      assert.equal(zeroGst.subtotalPaise, 0);
      assert.equal(zeroGst.totalPaise, 0);
    });
  });

  describe('calculateCashChangePaise', () => {
    it('calculates change due when cash tendered exceeds bill', () => {
      // Bill: ₹380 (38000 paise), Tendered: ₹500 (50000 paise) -> Change: ₹120 (12000 paise)
      const change = calculateCashChangePaise(38000, 50000);
      assert.equal(change, 12000);
    });

    it('returns 0 when exact cash is tendered or tendered is less than bill', () => {
      assert.equal(calculateCashChangePaise(38000, 38000), 0);
      assert.equal(calculateCashChangePaise(38000, 30000), 0);
    });
  });

  describe('createSettledPaymentRecord', () => {
    it('creates a compliant settled payment record with integer minor units', () => {
      const mockOrder: Pick<Order, 'id' | 'displayId' | 'tableNumber' | 'totalPaise' | 'customerName'> = {
        id: 'ord-101',
        displayId: 'RS-999',
        tableNumber: 'T07',
        totalPaise: 54000,
        customerName: 'Ananya Roy',
      };

      const payment = createSettledPaymentRecord(mockOrder, 'DIRECT_UPI_STAFF', () => 'pay-fixed-id');
      assert.equal(payment.id, 'pay-fixed-id');
      assert.equal(payment.orderId, 'ord-101');
      assert.equal(payment.displayId, 'RS-999');
      assert.equal(payment.tableNumber, 'T07');
      assert.equal(payment.method, 'DIRECT_UPI_STAFF');
      assert.equal(payment.status, 'PAID');
      assert.equal(payment.amountPaise, 54000);
      assert.equal(payment.netDepositedPaise, 54000);
      assert.equal(payment.customerName, 'Ananya Roy');
    });
  });
});
