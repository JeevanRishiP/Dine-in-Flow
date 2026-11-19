'use client';

import React, { useState, useEffect, useMemo } from 'react';
import type { KdsItemTicket, StaffMember } from '../../../app/lib/restaurant-db';
import { useStaffStore } from '../../../store/useStaffStore';
import { consoleAuthFetch } from '../../../app/lib/auth-client';
import {
  getCourseSequenceBadge,
  getFireUrgency,
  filterKdsItemsByCourse,
  filterKdsItemsByStatus,
} from './kds-utils';

export interface KdsFlatPriorityQueueProps {
  currentUser?: StaffMember | null;
  onTransitionItem?: (
    orderId: string,
    itemId: string,
    nextStatus: 'PREPARING' | 'READY' | 'SERVED',
  ) => void | Promise<void>;
  className?: string;
  style?: React.CSSProperties;
}

export function KdsFlatPriorityQueue({
  currentUser: propUser,
  onTransitionItem,
  className,
  style,
}: KdsFlatPriorityQueueProps = {}) {
  const storeUser = useStaffStore((s) => s.currentUser);
  const user = propUser || storeUser;
  const kdsItems = useStaffStore((s) => s.kdsItems);
  const setKdsItems = useStaffStore((s) => s.setKdsItems);
  const updateKdsItemStatus = useStaffStore((s) => s.updateKdsItemStatus);
  const selectedOutletId = useStaffStore((s) => s.selectedOutletId);
  const showStaffToast = useStaffStore((s) => s.showStaffToast);

  // Filter States
  const [selectedCourse, setSelectedCourse] = useState<'ALL' | 1 | 2 | 3 | 4>('ALL');
  const [selectedStatus, setSelectedStatus] = useState<'ALL' | 'ACTIVE' | 'PREPARING' | 'READY' | 'HOLD'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionMutatingId, setActionMutatingId] = useState<string | null>(null);

  // 5-second ticker to re-evaluate urgency countdowns
  const [nowMs, setNowMs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  // Fetch KDS priority items from API
  const fetchKdsTickets = async () => {
    try {
      setIsRefreshing(true);
      const res = await consoleAuthFetch(
        `/api/v1/console/orders/kds/items?outlet_id=${encodeURIComponent(selectedOutletId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        const tickets = Array.isArray(data) ? data : (data?.items ?? []);
        setKdsItems(tickets);
      }
    } catch (err) {
      console.error('Failed to fetch KDS items:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void fetchKdsTickets();
  }, [selectedOutletId]);

  // Handle status transition or early hold release
  const handleFireItem = async (ticket: KdsItemTicket, nextStatus: 'PREPARING' | 'READY') => {
    setActionMutatingId(ticket.itemId);
    try {
      if (onTransitionItem) {
        await onTransitionItem(ticket.orderId, ticket.itemId, nextStatus);
      } else {
        updateKdsItemStatus(ticket.itemId, nextStatus, 'RELEASED');
        const res = await consoleAuthFetch(`/api/v1/console/orders/${ticket.orderId}/items/${ticket.itemId}/status`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: nextStatus }),
        });
        if (!res.ok) {
          if (res.status === 409) {
            let msg = 'Item already claimed by another chef';
            try {
              const body = await res.json();
              if (body?.detail) msg = body.detail;
            } catch {}
            showStaffToast(`⚠️ ${msg}`);
            void fetchKdsTickets();
            return;
          }
          showStaffToast(`⚠️ Failed to update item status: HTTP ${res.status}`);
          void fetchKdsTickets();
          return;
        }
      }

      showStaffToast(
        nextStatus === 'PREPARING'
          ? `🔥 Fired: ${ticket.dishName} (Table ${ticket.tableNumber})`
          : `✓ Plated on Pass: ${ticket.dishName} (Table ${ticket.tableNumber})`,
      );
    } catch (err) {
      console.error('Failed to transition item:', err);
      showStaffToast('⚠️ Failed to update item status');
    } finally {
      setActionMutatingId(null);
    }
  };

  // Filtered and searched list
  const filteredItems = useMemo(() => {
    let result = filterKdsItemsByCourse(kdsItems, selectedCourse);
    result = filterKdsItemsByStatus(result, selectedStatus);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (it) =>
          it.dishName.toLowerCase().includes(q) ||
          it.tableNumber.toLowerCase().includes(q) ||
          it.orderDisplayId.toLowerCase().includes(q),
      );
    }

    return result;
  }, [kdsItems, selectedCourse, selectedStatus, searchQuery]);

  return (
    <div
      className={`kds-priority-queue ${className || ''}`}
      style={{ padding: '20px 24px', ...style }}
      aria-label="Smart Kitchen Priority Queue"
    >
      {/* ── Subheader / Control Panel ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '14px',
          marginBottom: '20px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800 }}>
              🔥 Smart Kitchen Fire Queue
            </h2>
            <span
              style={{
                background: 'rgba(6, 182, 212, 0.15)',
                color: 'var(--accent-cyan)',
                border: '1px solid rgba(6, 182, 212, 0.35)',
                padding: '2px 8px',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 800,
              }}
            >
              Expediter Mode
            </span>
          </div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            Synchronized course fire schedule · Dishes finish simultaneously per table
          </p>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={fetchKdsTickets}
            disabled={isRefreshing}
            className="btn-secondary"
            style={{ fontSize: '0.82rem', padding: '6px 14px', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <span>{isRefreshing ? '⏳' : '🔄'}</span>
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* ── Filter Toolbar ── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '12px',
          alignItems: 'center',
          marginBottom: '22px',
          background: 'rgba(15, 23, 42, 0.7)',
          border: '1px solid var(--border-light)',
          padding: '12px 16px',
          borderRadius: 'var(--radius-md)',
        }}
      >
        {/* Course Filter Pills */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-secondary)', marginRight: '4px' }}>
            Course:
          </span>
          <button
            type="button"
            onClick={() => setSelectedCourse('ALL')}
            style={{
              padding: '5px 12px',
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              border: selectedCourse === 'ALL' ? '1px solid var(--accent-cyan)' : '1px solid rgba(255, 255, 255, 0.1)',
              background: selectedCourse === 'ALL' ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.04)',
              color: selectedCourse === 'ALL' ? '#000' : 'var(--text-primary)',
              cursor: 'pointer',
            }}
          >
            All Courses ({kdsItems.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedCourse(1)}
            style={{
              padding: '5px 12px',
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              border: selectedCourse === 1 ? '1px solid #10b981' : '1px solid rgba(16, 185, 129, 0.25)',
              background: selectedCourse === 1 ? '#10b981' : 'rgba(16, 185, 129, 0.08)',
              color: selectedCourse === 1 ? '#000' : '#10b981',
              cursor: 'pointer',
            }}
          >
            🥗 Starters (C1)
          </button>
          <button
            type="button"
            onClick={() => setSelectedCourse(2)}
            style={{
              padding: '5px 12px',
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              border: selectedCourse === 2 ? '1px solid #f59e0b' : '1px solid rgba(245, 158, 11, 0.25)',
              background: selectedCourse === 2 ? '#f59e0b' : 'rgba(245, 158, 11, 0.08)',
              color: selectedCourse === 2 ? '#000' : '#f59e0b',
              cursor: 'pointer',
            }}
          >
            🍛 Mains (C2)
          </button>
          <button
            type="button"
            onClick={() => setSelectedCourse(3)}
            style={{
              padding: '5px 12px',
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              border: selectedCourse === 3 ? '1px solid #c084fc' : '1px solid rgba(192, 132, 252, 0.25)',
              background: selectedCourse === 3 ? '#c084fc' : 'rgba(192, 132, 252, 0.08)',
              color: selectedCourse === 3 ? '#000' : '#c084fc',
              cursor: 'pointer',
            }}
          >
            🍨 Desserts (C3)
          </button>
          <button
            type="button"
            onClick={() => setSelectedCourse(4)}
            style={{
              padding: '5px 12px',
              borderRadius: '999px',
              fontSize: '0.78rem',
              fontWeight: 700,
              border: selectedCourse === 4 ? '1px solid #38bdf8' : '1px solid rgba(56, 189, 248, 0.25)',
              background: selectedCourse === 4 ? '#38bdf8' : 'rgba(56, 189, 248, 0.08)',
              color: selectedCourse === 4 ? '#000' : '#38bdf8',
              cursor: 'pointer',
            }}
          >
            ☕ Drinks (C4)
          </button>
        </div>

        {/* Status Filter */}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginLeft: 'auto' }}>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '0.82rem',
              fontWeight: 700,
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="ACTIVE">🔥 Ready to Fire / Cooking</option>
            <option value="PREPARING">🍳 Currently Cooking</option>
            <option value="HOLD">⏳ On Hold (Serve Later / Sched)</option>
            <option value="READY">✓ Plated on Pass</option>
          </select>

          <input
            type="text"
            placeholder="Search dish or table..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid var(--border-light)',
              color: 'var(--text-primary)',
              borderRadius: '6px',
              padding: '6px 12px',
              fontSize: '0.82rem',
              minWidth: '160px',
            }}
          />
        </div>
      </div>

      {/* ── Empty State ── */}
      {filteredItems.length === 0 ? (
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
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>🍳</div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '8px' }}>
            No Active Kitchen Items
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem' }}>
            Paid customer items will appear here sorted deterministically by target fire time and prep urgency.
          </p>
        </div>
      ) : (
        /* ── Flat Priority Grid ── */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: '16px',
          }}
        >
          {filteredItems.map((ticket, index) => {
            const urgency = getFireUrgency(ticket.targetFireAt, ticket.holdStatus, nowMs);
            const courseBadge = getCourseSequenceBadge(ticket.courseSequence);
            const isMutating = actionMutatingId === ticket.itemId;

            return (
              <div
                key={ticket.itemId}
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-md)',
                  border: urgency.isOverdue
                    ? '1.5px solid #ef4444'
                    : urgency.isFireNow
                    ? '1.5px solid var(--accent-amber)'
                    : '1px solid var(--border-light)',
                  padding: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  position: 'relative',
                  opacity: isMutating ? 0.7 : 1,
                  boxShadow: urgency.pulse ? '0 0 15px rgba(239, 68, 68, 0.15)' : 'none',
                }}
              >
                {/* ── Priority Index & Urgency Banner ── */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        background: '#1e293b',
                        color: 'var(--text-secondary)',
                        fontSize: '0.72rem',
                        fontWeight: 900,
                        padding: '2px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      #{index + 1}
                    </span>
                    <span
                      style={{
                        background: ticket.orderType === 'TAKEAWAY' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(6, 182, 212, 0.2)',
                        color: ticket.orderType === 'TAKEAWAY' ? '#38bdf8' : 'var(--accent-cyan)',
                        border: `1px solid ${ticket.orderType === 'TAKEAWAY' ? 'rgba(56, 189, 248, 0.4)' : 'rgba(6, 182, 212, 0.4)'}`,
                        fontSize: '0.85rem',
                        fontWeight: 900,
                        padding: '2px 8px',
                        borderRadius: '6px',
                      }}
                    >
                      {ticket.orderType === 'TAKEAWAY' ? `🛍️ Takeaway · ${ticket.tableNumber}` : ticket.tableNumber}
                    </span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                      {ticket.orderDisplayId}
                    </span>
                  </div>

                  {/* Urgency Badge */}
                  <span
                    style={{
                      background: urgency.bg,
                      border: `1px solid ${urgency.border}`,
                      color: urgency.color,
                      fontSize: '0.72rem',
                      fontWeight: 900,
                      padding: '3px 8px',
                      borderRadius: '6px',
                    }}
                    className={urgency.pulse ? 'pulse-glow' : ''}
                  >
                    {urgency.label}
                  </span>
                </div>

                {/* ── Dish Name & Quantity ── */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-cyan)' }}>
                      {ticket.quantity}×
                    </span>
                    <span style={{ fontSize: '1.05rem', fontWeight: 800 }}>
                      {ticket.dishName}
                    </span>
                  </div>

                  {/* Badges: Course Sequence, Prep Time, Combos */}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '6px' }}>
                    <span
                      style={{
                        background: courseBadge.bg,
                        border: `1px solid ${courseBadge.border}`,
                        color: courseBadge.color,
                        fontSize: '0.7rem',
                        fontWeight: 800,
                        padding: '1px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      {courseBadge.emoji} {courseBadge.label}
                    </span>

                    <span
                      style={{
                        background: 'rgba(255, 255, 255, 0.06)',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: '4px',
                      }}
                    >
                      ⏱️ {ticket.prepTimeMinutes}m prep
                    </span>

                    {ticket.spiceLevel && (
                      <span
                        style={{
                          background: 'rgba(239, 68, 68, 0.15)',
                          border: '1px solid rgba(239, 68, 68, 0.35)',
                          color: '#f87171',
                          fontSize: '0.7rem',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        🌶️ {ticket.spiceLevel}
                      </span>
                    )}

                    {ticket.isComboItem && (
                      <span
                        style={{
                          background: 'rgba(168, 85, 247, 0.15)',
                          border: '1px solid rgba(168, 85, 247, 0.35)',
                          color: '#c084fc',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          padding: '1px 6px',
                          borderRadius: '4px',
                        }}
                      >
                        🍱 {ticket.comboName || 'Combo Item'}
                      </span>
                    )}
                  </div>
                </div>

                {/* ── Kitchen Notes / Modifiers ── */}
                {ticket.notes && (
                  <div
                    style={{
                      background: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '6px',
                      padding: '6px 10px',
                      fontSize: '0.76rem',
                      color: '#fbbf24',
                      fontWeight: 700,
                    }}
                  >
                    ↳ Note: {ticket.notes}
                  </div>
                )}

                {/* ── Action Buttons ── */}
                <div style={{ marginTop: 'auto', paddingTop: '6px', display: 'flex', gap: '8px' }}>
                  {ticket.holdStatus === 'SERVE_LATER_HOLD' ? (
                    <button
                      type="button"
                      disabled={isMutating}
                      onClick={() => handleFireItem(ticket, 'PREPARING')}
                      className="btn-primary"
                      style={{ flex: 1, fontSize: '0.8rem', padding: '8px 12px' }}
                    >
                      🔥 Early Release to Kitchen
                    </button>
                  ) : ticket.holdStatus === 'SCHEDULED_WAIT' ? (
                    <button
                      type="button"
                      disabled={isMutating}
                      onClick={() => handleFireItem(ticket, 'PREPARING')}
                      className="btn-primary"
                      style={{ flex: 1, fontSize: '0.8rem', padding: '8px 12px' }}
                    >
                      ⚡ Fire Ahead of Schedule
                    </button>
                  ) : ticket.itemStatus === 'PENDING' || ticket.itemStatus === 'CONFIRMED' ? (
                    <button
                      type="button"
                      disabled={isMutating}
                      onClick={() => handleFireItem(ticket, 'PREPARING')}
                      className="btn-primary"
                      style={{ flex: 1, fontSize: '0.85rem', padding: '8px 12px' }}
                    >
                      🔥 Start Cooking
                    </button>
                  ) : ticket.itemStatus === 'PREPARING' ? (
                    <button
                      type="button"
                      disabled={isMutating}
                      onClick={() => handleFireItem(ticket, 'READY')}
                      className="btn-success"
                      style={{ flex: 1, fontSize: '0.85rem', padding: '8px 12px' }}
                    >
                      ✓ Mark Plated on Pass
                    </button>
                  ) : ticket.itemStatus === 'READY' ? (
                    <div
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        fontSize: '0.78rem',
                        color: '#10b981',
                        fontWeight: 800,
                        padding: '6px',
                        background: 'rgba(16, 185, 129, 0.1)',
                        borderRadius: '6px',
                      }}
                    >
                      ✓ Plated on Pass · Awaiting Server Pick
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default KdsFlatPriorityQueue;
