'use client';

import React, { useState } from 'react';
import type { Table, Outlet } from '../../../app/lib/restaurant-db';
import { getStoredOutlets, formatPaise } from '../../../app/lib/restaurant-db';
import { useStaffStore } from '../../../store/useStaffStore';
import { consoleAuthFetch } from '../../../app/lib/auth-client';
import {
  deriveTableOccupancy,
  deriveTableChip,
  extractUniqueSections,
  filterTablesBySection,
  findPendingCallForTable,
  type TableOccupancy,
} from './floor-utils';

export interface FloorMapViewProps {
  currentOutlet?: Outlet;
  onSelectTable?: (table: Table) => void;
  onMarkTableCleaned?: (table: Table) => Promise<void> | void;
  onSelectOutlet?: (outletId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function FloorMapView({
  currentOutlet: propOutlet,
  onSelectTable,
  onMarkTableCleaned,
  onSelectOutlet,
  className,
  style,
}: FloorMapViewProps = {}) {
  // Reactive Global State from useStaffStore
  const tables = useStaffStore((s) => s.tables);
  const sessions = useStaffStore((s) => s.sessions);
  const orders = useStaffStore((s) => s.orders);
  const needsCleaningTableIds = useStaffStore((s) => s.needsCleaningTableIds);
  const calls = useStaffStore((s) => s.calls);
  const acknowledgeCall = useStaffStore((s) => s.acknowledgeCall);
  const resolveCall = useStaffStore((s) => s.resolveCall);
  const setCalls = useStaffStore((s) => s.setCalls);
  const selectedOutletId = useStaffStore((s) => s.selectedOutletId);
  const setSelectedOutletId = useStaffStore((s) => s.setSelectedOutletId);
  const markTableCleanedInStore = useStaffStore((s) => s.markTableCleaned);
  const showStaffToast = useStaffStore((s) => s.showStaffToast);
  const reservations = useStaffStore((s) => s.reservations);
  const serveLaterPrompts = useStaffStore((s) => s.serveLaterPrompts);
  const dismissServeLaterPrompt = useStaffStore((s) => s.dismissServeLaterPrompt);

  const [selectedSection, setSelectedSection] = useState<string>('ALL');
  const [cleaningTableId, setCleaningTableId] = useState<string | null>(null);
  const [releasingOrderId, setReleasingOrderId] = useState<string | null>(null);

  const handleFireHeldItems = async (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (releasingOrderId === orderId) return;
    setReleasingOrderId(orderId);
    try {
      const res = await consoleAuthFetch(
        `/api/v1/console/orders/${orderId}/serve-later/release`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      );
      if (res.ok) {
        dismissServeLaterPrompt(orderId);
        showStaffToast('🔥 Fired held desserts & beverages to kitchen!');
      } else {
        showStaffToast('Failed to fire held items.');
      }
    } catch {
      showStaffToast('Network error firing held items.');
    } finally {
      setReleasingOrderId(null);
    }
  };

  const handleSnoozePrompt = async (orderId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (releasingOrderId === orderId) return;
    setReleasingOrderId(orderId);
    try {
      const res = await consoleAuthFetch(
        `/api/v1/console/orders/${orderId}/serve-later/snooze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes: 10 }),
        },
      );
      if (res.ok) {
        dismissServeLaterPrompt(orderId);
        showStaffToast('⏳ Snoozed dessert check-in for 10 minutes.');
      } else {
        showStaffToast('Failed to snooze check-in.');
      }
    } catch {
      showStaffToast('Network error snoozing check-in.');
    } finally {
      setReleasingOrderId(null);
    }
  };

  // Resolve current outlet metadata
  const fallbackOutlet: Outlet = {
    id: selectedOutletId || '',
    orgId: '',
    name: 'Selected Outlet',
    shortName: 'Outlet',
    address: '',
    timezone: 'Asia/Kolkata',
    isActive: true,
  };
  const outlet =
    propOutlet ||
    (typeof window !== 'undefined'
      ? getStoredOutlets().find((o) => o.id === selectedOutletId) || getStoredOutlets()[0] || fallbackOutlet
      : fallbackOutlet);

  const handleSwitchOutlet = (outletId: string) => {
    if (onSelectOutlet) {
      onSelectOutlet(outletId);
    } else {
      setSelectedOutletId(outletId);
    }
  };

  // Waiter Call bells action handlers
  const handleAcknowledgeBell = (callId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    acknowledgeCall(callId);
    showStaffToast('🔔 Attending guest service call...');
  };

  const handleResolveBell = (callId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    resolveCall(callId);
    showStaffToast('✓ Table bell resolved.');
  };

  const handleTriggerWaiterCall = (tableNumber: string, reason = 'Water refill', e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const newCall = {
      id: `call-${Date.now()}`,
      table: tableNumber,
      timestamp: Date.now(),
      reason,
      status: 'PENDING' as const,
    };
    setCalls((prev) => [newCall, ...prev]);
    showStaffToast(`🔔 Guest call bell triggered for Table ${tableNumber}`);
  };

  // Mark table cleaned & ready action
  const handleCleanTable = async (table: Table, e: React.MouseEvent) => {
    e.stopPropagation();
    if (cleaningTableId === table.id) return;
    setCleaningTableId(table.id);

    try {
      if (onMarkTableCleaned) {
        await onMarkTableCleaned(table);
      } else {
        // Fallback direct backend API call + store mutation
        const res = await consoleAuthFetch(
          `/api/v1/console/tables/${encodeURIComponent(table.id)}/clean`,
          { method: 'POST' },
        );
        if (res.ok) {
          markTableCleanedInStore(table.id);
          showStaffToast(`🧹 Table ${table.number} cleaned and ready for next diner.`);
        } else {
          showStaffToast(`⚠️ Unable to mark Table ${table.number} cleaned.`);
        }
      }
    } catch {
      showStaffToast(`Network error cleaning Table ${table.number}`);
    } finally {
      setCleaningTableId(null);
    }
  };

  // Extract unique sections
  const sections = extractUniqueSections(tables);
  const filteredTables = filterTablesBySection(tables, selectedSection);

  return (
    <div
      className={`floor-map-view ${className || ''}`}
      style={{ padding: '20px 24px', ...style }}
      aria-label="Floor Map and Table Seating View"
    >
      {/* ── Floor Header & Section Filters ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '18px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Restaurant Floor Plan</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            {outlet.name} · {tables.length} Tables Configured
          </p>
        </div>

        {/* Section Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {sections.map((sec) => (
            <button
              key={sec}
              type="button"
              onClick={() => setSelectedSection(sec)}
              style={{
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.82rem',
                fontWeight: 700,
                cursor: 'pointer',
                background: selectedSection === sec ? 'var(--accent-cyan)' : 'var(--bg-surface)',
                color: selectedSection === sec ? '#000' : 'var(--text-secondary)',
                border: '1px solid var(--border-light)',
              }}
            >
              {sec === 'ALL' ? 'All Sections' : sec}
            </button>
          ))}
        </div>
      </div>

      {/* ── Empty State if No Tables Configured ── */}
      {tables.length === 0 ? (
        <div
          style={{
            background: 'var(--bg-card)',
            border: '1.5px dashed var(--border-light)',
            borderRadius: 'var(--radius-lg)',
            padding: '60px 20px',
            textAlign: 'center',
            maxWidth: '600px',
            margin: '40px auto',
          }}
        >
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🪑</div>
          <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
            No Tables Configured in {outlet.shortName || outlet.name}
          </h3>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.9rem',
            }}
          >
            This branch has zero tables in the database. Use the Owner Cockpit to add dining zones,
            table numbers, and generate QR codes.
          </p>
        </div>
      ) : (
        /* ── Grid of Dining Table Cards ── */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '16px',
          }}
        >
          {filteredTables.map((table) => {
            const session = sessions.find((s) => s.tableId === table.id && s.status === 'OPEN');
            const activeOrders = orders.filter(
              (o) =>
                o.status !== 'CANCELLED' &&
                o.status !== 'BILLED' &&
                (o.tableNumber === table.number ||
                  o.items?.some((it) => it.targetTableNumber === table.number)),
            );
            const activeOrder = activeOrders[0];
            const combinedTotalPaise = activeOrders.reduce((sum, o) => sum + (o.totalPaise || 0), 0);

            // Determine accurate occupancy status from useStaffStore
            const occupancy: TableOccupancy = deriveTableOccupancy(
              table.id,
              table.number,
              sessions,
              orders,
              needsCleaningTableIds,
            );

            const hasReadyOrder = activeOrders.some((o) => o.status === 'READY');
            const isOccupied = occupancy === 'OCCUPIED' || occupancy === 'NEEDS_CLEANING';
            const chip = deriveTableChip(occupancy, hasReadyOrder);
            const pendingCall = findPendingCallForTable(calls, table.number);
            const isCleaning = cleaningTableId === table.id;

            const tablePrompt = serveLaterPrompts.find(
              (p) => p.tableNumber === table.number || activeOrders.some((o) => p.orderId === o.id),
            );
            const hasHeldItems = Boolean(
              activeOrders.some((o) => o.items?.some((it) => it.holdStatus === 'SERVE_LATER_HOLD')),
            );
            const showServeLaterBanner = Boolean(tablePrompt || hasHeldItems);

            const upcomingRes = reservations.find(
              (r) => r.tableNumber === table.number && (r.status === 'CONFIRMED' || !r.status),
            );

            return (
              <div
                key={table.id}
                onClick={() => onSelectTable && onSelectTable(table)}
                className={pendingCall ? 'pulse-glow' : ''}
                style={{
                  background: isOccupied ? 'rgba(30, 41, 59, 0.9)' : 'var(--bg-card)',
                  border: pendingCall
                    ? '1.5px solid var(--accent-rose)'
                    : hasReadyOrder
                    ? '1.5px solid #10b981'
                    : isOccupied
                    ? '1.5px solid var(--accent-cyan)'
                    : '1px solid var(--border-card)',
                  borderRadius: 'var(--radius-md)',
                  padding: '18px',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  minHeight: '160px',
                  position: 'relative',
                }}
              >
                {/* ── Table Header & Occupancy Status Chip ── */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                  }}
                >
                  <div>
                    <span
                      style={{
                        fontSize: '1.3rem',
                        fontWeight: 900,
                        color: isOccupied ? 'var(--accent-cyan)' : '#f8fafc',
                      }}
                    >
                      {table.number}
                    </span>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {table.section} · Cap {table.capacity}
                    </div>
                  </div>

                  <span className={`status-chip ${chip.chipClass}`}>{chip.label}</span>
                </div>

                {/* ── Active Waiter Call Bell Alert ── */}
                {pendingCall && (
                  <div
                    style={{
                      background: 'rgba(244, 63, 94, 0.18)',
                      border: '1px solid var(--accent-rose)',
                      borderRadius: '6px',
                      padding: '6px 8px',
                      marginTop: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '6px',
                    }}
                  >
                    <div style={{ fontSize: '0.74rem', fontWeight: 800, color: '#fda4af' }}>
                      🔔 {pendingCall.reason}
                    </div>
                    {pendingCall.status === 'PENDING' ? (
                      <button
                        type="button"
                        onClick={(e) => handleAcknowledgeBell(pendingCall.id, e)}
                        style={{
                          background: 'var(--accent-rose)',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Attend
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => handleResolveBell(pendingCall.id, e)}
                        style={{
                          background: '#10b981',
                          color: '#fff',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '2px 6px',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Resolve ✓
                      </button>
                    )}
                  </div>
                )}

                {/* ── Session & Order Details ── */}
                {session ? (
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                      ⏱ Seated {session.openedAt} ({session.guestCount} Pax)
                    </div>
                    {activeOrders.length > 0 && (
                      <div
                        style={{
                          fontSize: '0.82rem',
                          fontWeight: 700,
                          color: 'var(--accent-amber)',
                          marginTop: '4px',
                        }}
                      >
                        {activeOrders.length === 1
                          ? `Order ${activeOrders[0]?.displayId} · ${formatPaise(activeOrders[0]?.totalPaise || 0)}`
                          : `${activeOrders.length} Orders (${activeOrders.map((o) => o.displayId).join(', ')}) · ${formatPaise(combinedTotalPaise)}`}
                      </div>
                    )}
                  </div>
                ) : (
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      marginTop: '10px',
                    }}
                  >
                    Ready for walk-in or QR scan
                  </div>
                )}

                {/* ── Upcoming Confirmed Reservation Indicator ── */}
                {upcomingRes && (
                  <div
                    style={{
                      marginTop: '8px',
                      padding: '4px 8px',
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.35)',
                      borderRadius: '6px',
                      fontSize: '0.73rem',
                      fontWeight: 700,
                      color: '#93c5fd',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>📅</span>
                    <span>
                      Reserved {new Date(upcomingRes.reservedFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {upcomingRes.guestCount} Pax
                    </span>
                  </div>
                )}

                {/* ── Pulsing Serve-Later Check-In Banner ── */}
                {showServeLaterBanner && activeOrder && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(126, 34, 206, 0.32))',
                      border: '1.5px solid #c084fc',
                      borderRadius: '8px',
                      padding: '8px 10px',
                      marginTop: '8px',
                      boxShadow: '0 0 12px rgba(192, 132, 252, 0.3)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.78rem',
                        fontWeight: 800,
                        color: '#f3e8ff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>🍨</span> Check-In: Ready for Dessert / Coffee?
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                      <button
                        type="button"
                        disabled={releasingOrderId === activeOrder.id}
                        onClick={(e) => handleFireHeldItems(activeOrder.id, e)}
                        style={{
                          flex: 1,
                          padding: '5px 8px',
                          borderRadius: '4px',
                          background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                          color: '#fff',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                          border: 'none',
                          cursor: 'pointer',
                        }}
                      >
                        🔥 Fire Now
                      </button>
                      <button
                        type="button"
                        disabled={releasingOrderId === activeOrder.id}
                        onClick={(e) => handleSnoozePrompt(activeOrder.id, e)}
                        style={{
                          flex: 1,
                          padding: '5px 8px',
                          borderRadius: '4px',
                          background: 'rgba(255, 255, 255, 0.1)',
                          color: '#e9d5ff',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          border: '1px solid rgba(192, 132, 252, 0.4)',
                          cursor: 'pointer',
                        }}
                      >
                        ⏳ Snooze 10m
                      </button>
                    </div>
                  </div>
                )}

                {/* ── Needs Cleaning Fast Action ── */}
                {occupancy === 'NEEDS_CLEANING' && (
                  <div style={{ marginTop: '10px' }}>
                    <button
                      type="button"
                      disabled={isCleaning}
                      onClick={(e) => handleCleanTable(table, e)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        background: 'linear-gradient(135deg, #06b6d4, #0284c7)',
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '0.74rem',
                        border: 'none',
                        cursor: isCleaning ? 'not-allowed' : 'pointer',
                        opacity: isCleaning ? 0.65 : 1,
                      }}
                    >
                      {isCleaning ? 'Updating...' : `🧹 Mark ${table.number} Cleaned`}
                    </button>
                  </div>
                )}

                {/* ── Footer: Token & Manage Prompt ── */}
                <div
                  style={{
                    marginTop: '12px',
                    paddingTop: '8px',
                    borderTop: '1px solid var(--border-light)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                    Token v{table.qrTokenVersion}
                  </span>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <button
                      type="button"
                      title="Trigger/Simulate Waiter Call"
                      onClick={(e) => handleTriggerWaiterCall(table.number, 'Water refill', e)}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.78rem',
                        padding: '2px 4px',
                      }}
                    >
                      🔔
                    </button>
                    <span
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--accent-cyan)',
                        fontWeight: 700,
                      }}
                    >
                      Manage Table →
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default FloorMapView;
