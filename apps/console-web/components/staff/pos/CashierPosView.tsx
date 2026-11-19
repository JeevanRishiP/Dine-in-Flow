'use client';

import React, { useState } from 'react';
import {
  formatPaise,
  type Outlet,
  type StaffMember,
  type Order,
  type Payment,
} from '../../../app/lib/restaurant-db';
import { useStaffStore } from '../../../store/useStaffStore';
import {
  calculateTotalBilledPaise,
  calculateMethodTotalPaise,
  calculateGstBreakdown,
  calculateCashChangePaise,
  createSettledPaymentRecord,
} from './pos-utils';

export type PosSubTab = 'ACTIVE_BILLS' | 'PAYMENTS' | 'STAFF' | 'SETTINGS';

export interface CashierPosViewProps {
  currentOutlet?: Outlet;
  currentUser?: StaffMember | null;
  staffMembers?: StaffMember[];
  onSettleOrder?: (order: Order) => void;
}

export function CashierPosView({
  currentOutlet,
  currentUser,
  staffMembers,
  onSettleOrder,
}: CashierPosViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<PosSubTab>('ACTIVE_BILLS');

  // Read state and actions from global Zustand store
  const orders = useStaffStore((s) => s.orders);
  const tables = useStaffStore((s) => s.tables);
  const sessions = useStaffStore((s) => s.sessions);
  const payments = useStaffStore((s) => s.payments);
  const recordPayment = useStaffStore((s) => s.recordPayment);
  const showStaffToast = useStaffStore((s) => s.showStaffToast);

  // Modal state for settling an active order
  const [settleModalOrder, setSettleModalOrder] = useState<Order | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'DIRECT_UPI' | 'UPI' | 'CASH' | 'CARD'>('DIRECT_UPI');
  const [cashTenderedInput, setCashTenderedInput] = useState<string>('');
  const [upiRefId, setUpiRefId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filter active dine-in orders that can be settled
  const activeOrders = orders.filter((o) => o.status !== 'CANCELLED');

  // Handle opening modal for an order
  const handleOpenSettleModal = (order: Order) => {
    if (onSettleOrder) {
      onSettleOrder(order);
    }
    setSettleModalOrder(order);
    setPaymentMethod('DIRECT_UPI');
    setCashTenderedInput('');
    setUpiRefId('');
  };

  // Handle confirming settlement
  const handleConfirmSettle = () => {
    if (!settleModalOrder) return;
    setIsSubmitting(true);

    try {
      const settledMethod: Payment['method'] =
        paymentMethod === 'DIRECT_UPI' ? 'DIRECT_UPI_STAFF' : paymentMethod;

      const newPayment = createSettledPaymentRecord(settleModalOrder, settledMethod);
      recordPayment(newPayment);

      showStaffToast(`✓ Bill settled for Table ${settleModalOrder.tableNumber} (${formatPaise(settleModalOrder.totalPaise)})`);
      setSettleModalOrder(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Compute cash change in paise
  const cashTenderedPaise = Math.round((parseFloat(cashTenderedInput) || 0) * 100);
  const cashChangePaise = settleModalOrder
    ? calculateCashChangePaise(settleModalOrder.totalPaise, cashTenderedPaise)
    : 0;

  // Active cashier metrics
  const totalBilledSales = calculateTotalBilledPaise(payments);
  const directUpiTotal = calculateMethodTotalPaise(payments, ['UPI', 'DIRECT_UPI_STAFF']);
  const cashDrawerTotal = calculateMethodTotalPaise(payments, 'CASH');

  return (
    <div style={{ padding: '20px 24px', maxWidth: '1100px', margin: '0 auto' }}>
      {/* Sub-navigation tabs */}
      <div
        style={{
          display: 'flex',
          gap: '10px',
          marginBottom: '24px',
          overflowX: 'auto',
          paddingBottom: '4px',
        }}
      >
        <button
          key="ACTIVE_BILLS"
          onClick={() => setActiveSubTab('ACTIVE_BILLS')}
          style={{
            padding: '8px 18px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 800,
            background: activeSubTab === 'ACTIVE_BILLS' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
            color: activeSubTab === 'ACTIVE_BILLS' ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border-light)',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: 'pointer',
          }}
        >
          <span>🧾 Active Table Bills</span>
          {activeOrders.length > 0 && (
            <span
              style={{
                background: activeSubTab === 'ACTIVE_BILLS' ? '#000' : 'var(--accent-cyan)',
                color: activeSubTab === 'ACTIVE_BILLS' ? '#fff' : '#000',
                borderRadius: '10px',
                padding: '1px 7px',
                fontSize: '0.72rem',
                fontWeight: 900,
              }}
            >
              {activeOrders.length}
            </span>
          )}
        </button>

        <button
          key="PAYMENTS"
          onClick={() => setActiveSubTab('PAYMENTS')}
          style={{
            padding: '8px 18px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 800,
            background: activeSubTab === 'PAYMENTS' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
            color: activeSubTab === 'PAYMENTS' ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border-light)',
            cursor: 'pointer',
          }}
        >
          💳 Daily Settle & Reconciliation
        </button>

        <button
          key="STAFF"
          onClick={() => setActiveSubTab('STAFF')}
          style={{
            padding: '8px 18px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 800,
            background: activeSubTab === 'STAFF' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
            color: activeSubTab === 'STAFF' ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border-light)',
            cursor: 'pointer',
          }}
        >
          👥 Staff Directory
        </button>

        <button
          key="SETTINGS"
          onClick={() => setActiveSubTab('SETTINGS')}
          style={{
            padding: '8px 18px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 800,
            background: activeSubTab === 'SETTINGS' ? 'var(--accent-cyan)' : 'var(--bg-surface)',
            color: activeSubTab === 'SETTINGS' ? '#000' : 'var(--text-secondary)',
            border: '1px solid var(--border-light)',
            cursor: 'pointer',
          }}
        >
          ⚙️ Station Settings
        </button>
      </div>

      {/* ========================================================
          SUB-TAB 1: ACTIVE TABLE BILLS & ORDERS
          ======================================================== */}
      {activeSubTab === 'ACTIVE_BILLS' && (
        <div>
          <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800, margin: 0 }}>Active Table Bills & Checkouts</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                Review live tables, check GST itemization, and settle payments for {currentOutlet?.name || 'Indiranagar Flagship'}
              </p>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
              Auto-syncing with Kitchen KDS & Floor Map
            </div>
          </div>

          {activeOrders.length === 0 ? (
            <div
              style={{
                padding: '48px 24px',
                textAlign: 'center',
                background: 'var(--bg-surface)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-light)',
              }}
            >
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>🎉</div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                All Active Tables Settled
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem', maxWidth: '400px', margin: '6px auto 0' }}>
                There are currently no unpaid active dine-in orders pending settlement. Incoming orders from customer QR scans will appear here automatically.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {activeOrders.map((order) => {
                const gst = calculateGstBreakdown(order.totalPaise);
                const matchingSession = sessions.find((s) => s.tableId === order.tableNumber || s.activeOrderId === order.id);
                const tableInfo = tables.find((t) => t.number === order.tableNumber);

                return (
                  <div
                    key={order.id}
                    style={{
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border-light)',
                      padding: '18px 20px',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.15)',
                    }}
                  >
                    <div>
                      {/* Card Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span
                            style={{
                              background: 'var(--accent-cyan)',
                              color: '#000',
                              fontWeight: 900,
                              fontSize: '1rem',
                              padding: '4px 10px',
                              borderRadius: '6px',
                            }}
                          >
                            {order.tableNumber}
                          </span>
                          <div>
                            <div style={{ fontWeight: 800, fontSize: '0.92rem' }}>
                              {order.customerName || `Guest at Table ${order.tableNumber}`}
                            </div>
                            <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
                              Order {order.displayId} {matchingSession?.guestCount ? `· ${matchingSession.guestCount} guests` : ''}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`status-chip ${
                            order.status === 'READY'
                              ? 'chip-green'
                              : order.status === 'PREPARING'
                              ? 'chip-blue'
                              : 'chip-yellow'
                          }`}
                        >
                          {order.status}
                        </span>
                      </div>

                      {/* Items Preview */}
                      <div
                        style={{
                          background: 'rgba(255, 255, 255, 0.02)',
                          borderRadius: '6px',
                          padding: '10px 12px',
                          marginBottom: '14px',
                          border: '1px solid rgba(255, 255, 255, 0.05)',
                        }}
                      >
                        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '6px' }}>
                          ORDER ITEMS ({order.items?.length || 0})
                        </div>
                        <div style={{ maxHeight: '110px', overflowY: 'auto' }}>
                          {order.items?.map((item, idx) => (
                            <div
                              key={item.id || idx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.8rem',
                                padding: '3px 0',
                                borderBottom: idx < order.items.length - 1 ? '1px dashed rgba(255,255,255,0.06)' : 'none',
                              }}
                            >
                              <span>
                                {item.quantity}x {item.name}
                              </span>
                              <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>
                                {formatPaise(item.pricePaise * item.quantity)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* GST Bill Itemization */}
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '14px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span>Subtotal (Net):</span>
                          <span>{formatPaise(gst.subtotalPaise)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '3px' }}>
                          <span>CGST (2.5%):</span>
                          <span>{formatPaise(gst.cgstPaise)}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                          <span>SGST (2.5%):</span>
                          <span>{formatPaise(gst.sgstPaise)}</span>
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            paddingTop: '6px',
                            borderTop: '1px solid var(--border-light)',
                            fontWeight: 900,
                            fontSize: '1.05rem',
                            color: 'var(--accent-cyan)',
                          }}
                        >
                          <span>Total Bill (Incl. GST):</span>
                          <span>{formatPaise(order.totalPaise)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Settle Action Buttons */}
                    <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                      <button
                        type="button"
                        onClick={() => handleOpenSettleModal(order)}
                        className="btn-success"
                        style={{
                          flex: 1,
                          padding: '10px 12px',
                          fontSize: '0.84rem',
                          fontWeight: 800,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                        }}
                      >
                        💳 Settle Payment
                      </button>
                      <button
                        type="button"
                        onClick={() => showStaffToast(`🖨 Proforma bill sent to thermal printer for Table ${order.tableNumber}`)}
                        className="btn-secondary"
                        style={{
                          padding: '10px 14px',
                          fontSize: '0.8rem',
                          fontWeight: 700,
                        }}
                        title="Print Proforma Bill"
                      >
                        🖨 Bill
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ========================================================
          SUB-TAB 2: DAILY CASHIER SETTLE & RECONCILIATION
          ======================================================== */}
      {activeSubTab === 'PAYMENTS' && (
        <div>
          <div style={{ marginBottom: '20px' }}>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Daily Cashier Settle & Reconciliation</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Recorded payments and drawer reconciliation for {currentOutlet?.name || 'Indiranagar Flagship'}
            </p>
          </div>

          {/* Metric Cards */}
          <div className="owner-metric-grid" style={{ marginBottom: '24px' }}>
            <div className="owner-metric-card">
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                TODAY&apos;S BILLED SALES
              </span>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--accent-cyan)', marginTop: '4px' }}>
                {formatPaise(totalBilledSales)}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                {payments.length} settled transactions
              </span>
            </div>

            <div className="owner-metric-card">
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                UPI DIRECT TO RESTAURANT
              </span>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#10b981', marginTop: '4px' }}>
                {formatPaise(directUpiTotal)}
              </div>
              <span style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '4px' }}>
                Zero gateway MDR deduction
              </span>
            </div>

            <div className="owner-metric-card">
              <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                CASH DRAWER TILL
              </span>
              <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--accent-amber)', marginTop: '4px' }}>
                {formatPaise(cashDrawerTotal)}
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                Ready for shift closing count
              </span>
            </div>
          </div>

          {/* Settled Transactions Table */}
          <div className="data-table-container">
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', fontWeight: 800 }}>
              Settled Transactions Log (Today)
            </div>
            {payments.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No payments recorded yet for this outlet today. Settle an active table bill to see it here.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Table</th>
                    <th>Customer</th>
                    <th>Method</th>
                    <th>Amount</th>
                    <th>Time</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontWeight: 700 }}>{p.displayId}</td>
                      <td>
                        <span style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>{p.tableNumber}</span>
                      </td>
                      <td>{p.customerName}</td>
                      <td>
                        <span className="status-chip chip-blue">{p.method}</span>
                      </td>
                      <td style={{ fontWeight: 800, color: '#10b981' }}>{formatPaise(p.amountPaise)}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{p.timestamp}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => showStaffToast(`🖨 Re-printing tax invoice for ${p.displayId}`)}
                          style={{
                            background: 'rgba(255, 255, 255, 0.06)',
                            border: '1px solid var(--border-light)',
                            padding: '4px 10px',
                            borderRadius: '4px',
                            fontSize: '0.78rem',
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          🖨 Reprint KOT
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ========================================================
          SUB-TAB 3: STAFF DIRECTORY
          ======================================================== */}
      {activeSubTab === 'STAFF' && (
        <div className="data-table-container">
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', fontWeight: 800 }}>
            Staff Members for {currentOutlet?.name || 'Indiranagar Flagship'}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff Member</th>
                <th>Role</th>
                <th>Phone</th>
                <th>PIN Quick Access</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {(staffMembers || []).map((s) => (
                <tr key={s.id}>
                  <td style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontSize: '20px' }}>{s.avatar}</span>
                    <div>
                      <div style={{ fontWeight: 700 }}>{s.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.email}</div>
                    </div>
                  </td>
                  <td>
                    <span className="status-chip chip-purple">{s.role}</span>
                  </td>
                  <td>{s.phone}</td>
                  <td style={{ fontFamily: 'monospace', letterSpacing: '2px', color: 'var(--accent-cyan)' }}>
                    ••••
                  </td>
                  <td>
                    <span className="status-chip chip-green">ACTIVE ON SHIFT</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ========================================================
          SUB-TAB 4: STATION SETTINGS
          ======================================================== */}
      {activeSubTab === 'SETTINGS' && (
        <div
          style={{
            background: 'var(--bg-surface)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border-light)',
            padding: '24px',
          }}
        >
          <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '16px' }}>
            Cashier & POS Station Configuration
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px' }}>
            <div style={{ border: '1px solid var(--border-light)', padding: '16px', borderRadius: '8px' }}>
              <h4 style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '8px' }}>🖨 Bill Printer Hardware</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                Configured thermal ESC/POS roll printer for instant guest bills and KOT receipts.
              </p>
              <div style={{ fontSize: '0.84rem', fontWeight: 800, color: 'var(--accent-cyan)' }}>
                Epson TM-T88VI (80mm Thermal, LAN: 192.168.1.120)
              </div>
            </div>

            <div style={{ border: '1px solid var(--border-light)', padding: '16px', borderRadius: '8px' }}>
              <h4 style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '8px' }}>🏛 GST Compliance & Invoice</h4>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginBottom: '12px' }}>
                GSTIN: 29AABCU9603R1ZM · Composite 5% GST (CGST 2.5% + SGST 2.5%)
              </p>
              <div style={{ fontSize: '0.84rem', fontWeight: 800, color: '#10b981' }}>
                Automated B2C GST E-Invoice generation enabled
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================
          BUILT-IN COLLECT PAYMENT / DIRECT UPI QR MODAL
          ======================================================== */}
      {settleModalOrder && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '460px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 6px' }}>
              Settle Table {settleModalOrder.tableNumber}
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
              Order {settleModalOrder.displayId} · Total: {formatPaise(settleModalOrder.totalPaise)}
            </p>

            {/* Payment method selector */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: '6px',
                marginBottom: '18px',
              }}
            >
              {(['DIRECT_UPI', 'UPI', 'CASH', 'CARD'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    background: paymentMethod === m ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.05)',
                    color: paymentMethod === m ? '#000' : 'var(--text-secondary)',
                    border: '1px solid var(--border-light)',
                    cursor: 'pointer',
                  }}
                >
                  {m === 'DIRECT_UPI' ? 'Direct UPI' : m}
                </button>
              ))}
            </div>

            {/* Direct UPI QR Code view */}
            {paymentMethod === 'DIRECT_UPI' && (
              <div
                style={{
                  background: '#fff',
                  padding: '16px',
                  borderRadius: '12px',
                  display: 'inline-block',
                  marginBottom: '14px',
                }}
              >
                <div
                  style={{
                    width: '160px',
                    height: '160px',
                    background: '#000',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    fontSize: '11px',
                    fontWeight: 800,
                    textAlign: 'center',
                    padding: '10px',
                    borderRadius: '8px',
                  }}
                >
                  [ UPI QR CODE: ₹{settleModalOrder.totalPaise / 100} ]
                </div>
                <div style={{ color: '#000', fontWeight: 800, fontSize: '0.85rem', marginTop: '8px' }}>
                  Scan with any UPI App
                </div>
                <div style={{ color: '#666', fontSize: '0.72rem' }}>GPay · PhonePe · Paytm · BHIM</div>
              </div>
            )}

            {/* Cash Calculator view */}
            {paymentMethod === 'CASH' && (
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.04)',
                  padding: '14px 16px',
                  borderRadius: '8px',
                  marginBottom: '16px',
                  textAlign: 'left',
                }}
              >
                <label style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                  Cash Tendered by Guest (₹):
                </label>
                <input
                  type="number"
                  placeholder="e.g. 500"
                  value={cashTenderedInput}
                  onChange={(e) => setCashTenderedInput(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-light)',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '1rem',
                    marginTop: '6px',
                  }}
                />
                <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
                  {[100, 200, 500, 2000].map((denom) => (
                    <button
                      key={denom}
                      type="button"
                      onClick={() => setCashTenderedInput(String(denom))}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: 'rgba(255, 255, 255, 0.08)',
                        border: '1px solid var(--border-light)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.74rem',
                        cursor: 'pointer',
                      }}
                    >
                      ₹{denom}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCashTenderedInput(String(settleModalOrder.totalPaise / 100))}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '4px',
                      background: 'rgba(6, 182, 212, 0.15)',
                      border: '1px solid var(--accent-cyan)',
                      color: 'var(--accent-cyan)',
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    Exact
                  </button>
                </div>

                {cashTenderedPaise > 0 && (
                  <div
                    style={{
                      marginTop: '12px',
                      padding: '8px 12px',
                      background: cashChangePaise > 0 ? 'rgba(16, 185, 129, 0.12)' : 'rgba(255,255,255,0.03)',
                      borderRadius: '6px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-secondary)' }}>
                      Change Return Due:
                    </span>
                    <span style={{ fontSize: '1.1rem', fontWeight: 900, color: '#10b981' }}>
                      {formatPaise(cashChangePaise)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '8px', marginTop: '14px' }}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={handleConfirmSettle}
                className="btn-success"
                style={{ flex: 1, padding: '10px 14px', fontWeight: 800 }}
              >
                ✓ Confirm Settle & Print GST Bill
              </button>
              <button
                type="button"
                onClick={() => setSettleModalOrder(null)}
                className="btn-secondary"
                style={{ padding: '10px 16px' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
