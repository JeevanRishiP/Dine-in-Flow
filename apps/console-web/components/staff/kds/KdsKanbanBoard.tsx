'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { Order, Outlet, StaffMember, KdsItemTicket } from '../../../app/lib/restaurant-db';
import { getStoredOutlets } from '../../../app/lib/restaurant-db';
import { useStaffStore } from '../../../store/useStaffStore';
import { KdsItemCard } from './KdsItemCard';
import { OrderTicketCard } from './OrderTicketCard';
import {
  sortKdsItems,
  buildBatchSummary,
  filterConfirmedOrders,
  filterPreparingOrders,
  filterReadyOrders,
  countReadyItems,
  filterKdsItemsByCourse,
} from './kds-utils';

export type KdsTabMode = 'ACTIVE_QUEUE' | 'UPCOMING_SCHEDULED' | 'SERVE_LATER_HOLD' | 'ORDER_TICKETS';

export interface KdsKanbanBoardProps {
  currentOutlet?: Outlet;
  currentUser?: StaffMember | null;
  onTransitionItem?: (
    orderId: string,
    itemId: string,
    nextStatus: 'PREPARING' | 'READY' | 'SERVED',
  ) => void | Promise<void>;
  onTransitionOrder?: (
    orderId: string,
    nextStatus: Order['status'],
    reason?: string,
  ) => void | Promise<void>;
  onSettleOrder?: (order: Order) => void;
  onSelectOutlet?: (outletId: string) => void;
  className?: string;
  style?: React.CSSProperties;
}

export function KdsKanbanBoard({
  currentOutlet: propOutlet,
  currentUser: propUser,
  onTransitionItem,
  onTransitionOrder,
  onSettleOrder,
  onSelectOutlet,
  className,
  style,
}: KdsKanbanBoardProps = {}) {
  // Read reactive live state from Zustand store
  const orders = useStaffStore((s) => s.orders);
  const kdsItems = useStaffStore((s) => s.kdsItems);
  const storeUser = useStaffStore((s) => s.currentUser);
  const selectedOutletId = useStaffStore((s) => s.selectedOutletId);
  const setSelectedOutletId = useStaffStore((s) => s.setSelectedOutletId);

  // KDS internal tabs: Active Queue (default), Upcoming Scheduled, Serve Later Hold, or legacy Order Tickets
  const [activeTabMode, setActiveTabMode] = useState<KdsTabMode>('ACTIVE_QUEUE');
  const [selectedCourse, setSelectedCourse] = useState<'ALL' | 1 | 2 | 3 | 4>('ALL');

  // 30-second interval ticker for live urgency countdowns and re-sorting
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const ticker = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(ticker);
  }, []);

  const user = propUser || storeUser;

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

  // Filter KDS items by selected course
  const courseFilteredItems = useMemo(() => {
    return filterKdsItemsByCourse(kdsItems, selectedCourse);
  }, [kdsItems, selectedCourse]);

  // Tab 1: Active Queue items
  // Column 1: Fire Now / Queued (ACTIVE or RELEASED and not PREPARING/READY/SERVED)
  const queuedItems = useMemo(() => {
    const raw = courseFilteredItems.filter(
      (it) =>
        (it.holdStatus === 'ACTIVE' || it.holdStatus === 'RELEASED') &&
        (it.itemStatus === 'PENDING' || it.itemStatus === 'CONFIRMED' || it.itemStatus === 'CREATED'),
    );
    return sortKdsItems(raw);
  }, [courseFilteredItems]);

  // Column 2: Cooking (PREPARING)
  const cookingItems = useMemo(() => {
    const raw = courseFilteredItems.filter((it) => it.itemStatus === 'PREPARING');
    return sortKdsItems(raw);
  }, [courseFilteredItems]);

  // Column 3: Ready on Pass (READY)
  const readyItems = useMemo(() => {
    const raw = courseFilteredItems.filter((it) => it.itemStatus === 'READY');
    return sortKdsItems(raw);
  }, [courseFilteredItems]);

  // Tab 2: Upcoming Scheduled (SCHEDULED_WAIT)
  const scheduledWaitItems = useMemo(() => {
    const raw = courseFilteredItems.filter((it) => it.holdStatus === 'SCHEDULED_WAIT');
    return sortKdsItems(raw);
  }, [courseFilteredItems]);

  // Tab 3: Serve Later Hold (SERVE_LATER_HOLD)
  const serveLaterHoldItems = useMemo(() => {
    const raw = courseFilteredItems.filter((it) => it.holdStatus === 'SERVE_LATER_HOLD');
    return sortKdsItems(raw);
  }, [courseFilteredItems]);

  // Batch Cook Summary: aggregates active dishes across Queued + Cooking
  const batchSummary = useMemo(() => {
    const activeForBatch = kdsItems.filter(
      (it) =>
        (it.holdStatus === 'ACTIVE' || it.holdStatus === 'RELEASED') &&
        it.itemStatus !== 'READY' &&
        it.itemStatus !== 'SERVED' &&
        it.itemStatus !== 'CANCELLED',
    );
    return buildBatchSummary(activeForBatch);
  }, [kdsItems]);

  // Legacy Order-grouped partitions (for the Order Tickets toggle)
  const confirmedOrders = filterConfirmedOrders(orders);
  const preparingOrders = filterPreparingOrders(orders);
  const readyOrders = filterReadyOrders(orders);
  const readyItemsCount = countReadyItems(orders);

  const totalActiveQueueCount = queuedItems.length + cookingItems.length + readyItems.length;

  return (
    <div
      className={`kds-kanban-container ${className || ''}`}
      style={{ padding: '20px 24px', ...style }}
      aria-label="Kitchen Display System Kanban Board"
    >
      {/* ── Top Header & Tab Controls ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '16px',
          flexWrap: 'wrap',
          gap: '12px',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>
            Kitchen Display System (KDS)
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Live Item Priority Queue for {outlet.shortName || outlet.name} · Auto-sorted by urgency
          </p>
        </div>

        {/* ── Tab Switcher: Active Queue / Scheduled Wait / Serve Later Hold / Order Tickets ── */}
        <div
          style={{
            background: 'var(--bg-surface, #1e222b)',
            border: '1px solid var(--border-light, rgba(255, 255, 255, 0.1))',
            borderRadius: '8px',
            padding: '4px',
            display: 'flex',
            gap: '4px',
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTabMode('ACTIVE_QUEUE')}
            style={{
              padding: '7px 14px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 800,
              border: 'none',
              cursor: 'pointer',
              background: activeTabMode === 'ACTIVE_QUEUE' ? 'var(--accent-cyan, #06b6d4)' : 'transparent',
              color: activeTabMode === 'ACTIVE_QUEUE' ? '#000' : 'var(--text-secondary, #94a3b8)',
              transition: 'all 0.15s ease',
            }}
          >
            🔥 Active Queue ({totalActiveQueueCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTabMode('UPCOMING_SCHEDULED')}
            style={{
              padding: '7px 14px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 800,
              border: 'none',
              cursor: 'pointer',
              background: activeTabMode === 'UPCOMING_SCHEDULED' ? 'var(--accent-cyan, #06b6d4)' : 'transparent',
              color: activeTabMode === 'UPCOMING_SCHEDULED' ? '#000' : 'var(--text-secondary, #94a3b8)',
              transition: 'all 0.15s ease',
            }}
          >
            ⏰ Upcoming Scheduled ({scheduledWaitItems.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTabMode('SERVE_LATER_HOLD')}
            style={{
              padding: '7px 14px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 800,
              border: 'none',
              cursor: 'pointer',
              background: activeTabMode === 'SERVE_LATER_HOLD' ? 'var(--accent-cyan, #06b6d4)' : 'transparent',
              color: activeTabMode === 'SERVE_LATER_HOLD' ? '#000' : 'var(--text-secondary, #94a3b8)',
              transition: 'all 0.15s ease',
            }}
          >
            ⏳ Serve Later Hold ({serveLaterHoldItems.length})
          </button>

          <button
            type="button"
            onClick={() => setActiveTabMode('ORDER_TICKETS')}
            style={{
              padding: '7px 12px',
              borderRadius: '6px',
              fontSize: '0.82rem',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              background: activeTabMode === 'ORDER_TICKETS' ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
              color: activeTabMode === 'ORDER_TICKETS' ? '#fff' : 'var(--text-secondary, #94a3b8)',
              transition: 'all 0.15s ease',
            }}
          >
            📋 Order Tickets ({orders.length})
          </button>
        </div>
      </div>

      {/* ── Compact Batch Cook Summary Strip ── */}
      {batchSummary.length > 0 && activeTabMode !== 'ORDER_TICKETS' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 16px',
            background: 'linear-gradient(90deg, rgba(56, 189, 248, 0.1), rgba(16, 185, 129, 0.08))',
            border: '1px solid rgba(56, 189, 248, 0.25)',
            borderRadius: '10px',
            marginBottom: '18px',
            overflowX: 'auto',
            flexWrap: 'wrap',
          }}
          aria-label="Batch Cook Summary Strip"
        >
          <span
            style={{
              fontWeight: 800,
              color: '#38bdf8',
              fontSize: '0.85rem',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>🍳</span> Active Batch:
          </span>

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {batchSummary.map((b) => (
              <span
                key={b.dishName}
                style={{
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  color: '#f8fafc',
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                <strong style={{ color: '#38bdf8', marginRight: '4px' }}>{b.totalQty}×</strong>
                {b.dishName}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Course Sequence Quick Filter Pills ── */}
      {activeTabMode !== 'ORDER_TICKETS' && (
        <div
          style={{
            display: 'flex',
            gap: '8px',
            marginBottom: '18px',
            overflowX: 'auto',
            paddingBottom: '2px',
          }}
        >
          {(
            [
              { key: 'ALL', label: 'All Courses' },
              { key: 1, label: '🥗 Course 1 · Starters' },
              { key: 2, label: '🍛 Course 2 · Mains' },
              { key: 3, label: '🍨 Course 3 · Desserts' },
              { key: 4, label: '☕ Course 4 · Beverages' },
            ] as const
          ).map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setSelectedCourse(c.key)}
              style={{
                padding: '5px 12px',
                borderRadius: '20px',
                fontSize: '0.78rem',
                fontWeight: 700,
                border: selectedCourse === c.key ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.12)',
                background: selectedCourse === c.key ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                color: selectedCourse === c.key ? '#38bdf8' : 'var(--text-secondary, #94a3b8)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* ── TAB 1: ACTIVE QUEUE (3 Kanban Columns) ── */}
      {activeTabMode === 'ACTIVE_QUEUE' && (
        <>
          {totalActiveQueueCount === 0 ? (
            <div
              style={{
                background: 'var(--bg-card, #131722)',
                border: '1.5px dashed var(--border-light, rgba(255, 255, 255, 0.15))',
                borderRadius: '12px',
                padding: '60px 20px',
                textAlign: 'center',
                maxWidth: '600px',
                margin: '40px auto',
              }}
            >
              <div style={{ fontSize: '48px', marginBottom: '16px' }}>🍳</div>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
                All Clear on the Kitchen Pass!
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                No active plates in queue for {outlet.shortName || outlet.name}. Paid customer orders
                appear here with live fire countdowns and chimes.
              </p>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                gap: '20px',
                alignItems: 'start',
              }}
            >
              {/* Column 1: Fire Now / Queued */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '12px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '14px',
                    paddingBottom: '10px',
                    borderBottom: '2px solid rgba(245, 158, 11, 0.5)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#f59e0b',
                      }}
                    />
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                      FIRE NOW / QUEUED
                    </h3>
                  </div>
                  <span
                    style={{
                      background: 'rgba(245, 158, 11, 0.15)',
                      color: '#fbbf24',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                    }}
                  >
                    {queuedItems.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {queuedItems.length === 0 ? (
                    <div
                      style={{
                        padding: '30px 16px',
                        textAlign: 'center',
                        color: 'var(--text-secondary, #94a3b8)',
                        fontSize: '0.85rem',
                      }}
                    >
                      No queued items waiting to fire.
                    </div>
                  ) : (
                    queuedItems.map((ticket) => (
                      <KdsItemCard
                        key={ticket.itemId}
                        ticket={ticket}
                        nowMs={nowMs}
                        onTransitionItem={onTransitionItem}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Column 2: Cooking (PREPARING) */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '12px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '14px',
                    paddingBottom: '10px',
                    borderBottom: '2px solid rgba(56, 189, 248, 0.5)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#38bdf8',
                      }}
                    />
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                      COOKING
                    </h3>
                  </div>
                  <span
                    style={{
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                    }}
                  >
                    {cookingItems.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {cookingItems.length === 0 ? (
                    <div
                      style={{
                        padding: '30px 16px',
                        textAlign: 'center',
                        color: 'var(--text-secondary, #94a3b8)',
                        fontSize: '0.85rem',
                      }}
                    >
                      No items currently on pans.
                    </div>
                  ) : (
                    cookingItems.map((ticket) => (
                      <KdsItemCard
                        key={ticket.itemId}
                        ticket={ticket}
                        nowMs={nowMs}
                        onTransitionItem={onTransitionItem}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Column 3: Ready on Pass (READY) */}
              <div
                style={{
                  background: 'rgba(255, 255, 255, 0.02)',
                  borderRadius: '12px',
                  padding: '16px',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '14px',
                    paddingBottom: '10px',
                    borderBottom: '2px solid rgba(16, 185, 129, 0.5)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        background: '#10b981',
                      }}
                    />
                    <h3 style={{ fontSize: '0.95rem', fontWeight: 800, letterSpacing: '0.04em' }}>
                      READY ON PASS
                    </h3>
                  </div>
                  <span
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      color: '#34d399',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      fontSize: '0.8rem',
                      fontWeight: 800,
                    }}
                  >
                    {readyItems.length}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {readyItems.length === 0 ? (
                    <div
                      style={{
                        padding: '30px 16px',
                        textAlign: 'center',
                        color: 'var(--text-secondary, #94a3b8)',
                        fontSize: '0.85rem',
                      }}
                    >
                      Pass is empty. Pick up plated dishes promptly.
                    </div>
                  ) : (
                    readyItems.map((ticket) => (
                      <KdsItemCard
                        key={ticket.itemId}
                        ticket={ticket}
                        nowMs={nowMs}
                        onTransitionItem={onTransitionItem}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── TAB 2: UPCOMING SCHEDULED (SCHEDULED_WAIT) ── */}
      {activeTabMode === 'UPCOMING_SCHEDULED' && (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: 'rgba(59, 130, 246, 0.1)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              marginBottom: '16px',
              color: '#93c5fd',
              fontSize: '0.85rem',
            }}
          >
            ⏰ <strong>Upcoming Scheduled Dishes:</strong> Pre-booked dine-in reservations and takeaway orders
            with future pickup/dining times. The system auto-promotes each item to <strong>ACTIVE</strong> when its target fire time arrives.
          </div>

          {scheduledWaitItems.length === 0 ? (
            <div
              style={{
                background: 'var(--bg-card, #131722)',
                borderRadius: '12px',
                padding: '40px 20px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              No upcoming scheduled items found for this outlet.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {scheduledWaitItems.map((ticket) => (
                <KdsItemCard
                  key={ticket.itemId}
                  ticket={ticket}
                  nowMs={nowMs}
                  onTransitionItem={onTransitionItem}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: SERVE LATER HOLD (SERVE_LATER_HOLD) ── */}
      {activeTabMode === 'SERVE_LATER_HOLD' && (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
          <div
            style={{
              padding: '12px 16px',
              borderRadius: '8px',
              background: 'rgba(168, 85, 247, 0.1)',
              border: '1px solid rgba(168, 85, 247, 0.3)',
              marginBottom: '16px',
              color: '#d8b4fe',
              fontSize: '0.85rem',
            }}
          >
            🍨 <strong>Serve Later Hold:</strong> Desserts, hot coffees, and after-meal beverages
            held so they stay fresh. Guests release them from their phone, or Captains/Chefs can fire them early.
          </div>

          {serveLaterHoldItems.length === 0 ? (
            <div
              style={{
                background: 'var(--bg-card, #131722)',
                borderRadius: '12px',
                padding: '40px 20px',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              No desserts or beverages currently on hold.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
                gap: '16px',
              }}
            >
              {serveLaterHoldItems.map((ticket) => (
                <KdsItemCard
                  key={ticket.itemId}
                  ticket={ticket}
                  nowMs={nowMs}
                  onTransitionItem={onTransitionItem}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 4: ORDER TICKETS (Grouped by Order) ── */}
      {activeTabMode === 'ORDER_TICKETS' && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: '20px',
            alignItems: 'start',
          }}
        >
          {/* Column 1: New / Confirmed Orders */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
                paddingBottom: '10px',
                borderBottom: '2px solid rgba(245, 158, 11, 0.5)',
              }}
            >
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>
                NEW / CONFIRMED ({confirmedOrders.length})
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {confirmedOrders.map((order) => (
                <OrderTicketCard
                  key={order.id}
                  order={order}
                  columnType="CONFIRMED"
                  currentUser={user}
                  onTransitionItem={onTransitionItem}
                  onTransitionOrder={onTransitionOrder}
                  onSettleOrder={onSettleOrder}
                />
              ))}
            </div>
          </div>

          {/* Column 2: Preparing Orders */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
                paddingBottom: '10px',
                borderBottom: '2px solid rgba(56, 189, 248, 0.5)',
              }}
            >
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>
                COOKING ({preparingOrders.length})
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {preparingOrders.map((order) => (
                <OrderTicketCard
                  key={order.id}
                  order={order}
                  columnType="PREPARING"
                  currentUser={user}
                  onTransitionItem={onTransitionItem}
                  onTransitionOrder={onTransitionOrder}
                  onSettleOrder={onSettleOrder}
                />
              ))}
            </div>
          </div>

          {/* Column 3: Ready Orders */}
          <div
            style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '12px',
              padding: '16px',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '14px',
                paddingBottom: '10px',
                borderBottom: '2px solid rgba(16, 185, 129, 0.5)',
              }}
            >
              <h3 style={{ fontSize: '0.95rem', fontWeight: 800 }}>
                READY ON PASS ({readyOrders.length} orders · {readyItemsCount} plates)
              </h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {readyOrders.map((order) => (
                <OrderTicketCard
                  key={order.id}
                  order={order}
                  columnType="READY"
                  currentUser={user}
                  onTransitionItem={onTransitionItem}
                  onTransitionOrder={onTransitionOrder}
                  onSettleOrder={onSettleOrder}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default KdsKanbanBoard;
