'use client';

import React, { useState } from 'react';
import type { Order, OrderItem, StaffMember } from '../../../app/lib/restaurant-db';
import { formatPaise } from '../../../app/lib/restaurant-db';
import { useStaffStore } from '../../../store/useStaffStore';
import { consoleAuthFetch } from '../../../app/lib/auth-client';
import { isDessertOrPostMealDish, getCourseSequenceBadge, getFireUrgency } from './kds-utils';

export { isDessertOrPostMealDish };

export type KdsColumnType = 'CONFIRMED' | 'PREPARING' | 'READY';

export interface OrderTicketCardProps {
  order: Order;
  columnType?: KdsColumnType;
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
  className?: string;
  style?: React.CSSProperties;
}

export function OrderTicketCard({
  order,
  columnType = 'CONFIRMED',
  currentUser: propUser,
  onTransitionItem,
  onTransitionOrder,
  onSettleOrder,
  className,
  style,
}: OrderTicketCardProps) {
  const storeUser = useStaffStore((s) => s.currentUser);
  const user = propUser || storeUser;
  const updateOrderItemStatus = useStaffStore((s) => s.updateOrderItemStatus);
  const updateOrderStatus = useStaffStore((s) => s.updateOrderStatus);

  // Self-managed collapsible ticket card state
  const [isExpanded, setIsExpanded] = useState(true);
  const [isMutating, setIsMutating] = useState(false);

  // Ready and cooking items partition
  const readyItems = order.items.filter((it) => it.status === 'READY');
  const cookingItems = order.items.filter(
    (it) =>
      !it.status ||
      it.status === 'PREPARING' ||
      it.status === 'PENDING' ||
      it.status === 'CONFIRMED',
  );

  // Status transition handlers (uses callback if supplied, otherwise triggers store & API directly)
  const handleItemTransition = async (
    itemId: string,
    nextStatus: 'PREPARING' | 'READY' | 'SERVED',
  ) => {
    if (onTransitionItem) {
      await onTransitionItem(order.id, itemId, nextStatus);
      return;
    }

    // Direct fallback mutation
    setIsMutating(true);
    updateOrderItemStatus(order.id, itemId, nextStatus);
    try {
      await consoleAuthFetch(`/api/v1/console/orders/${order.id}/items/${itemId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
    } catch (err) {
      console.error('Failed to update item status:', err);
    } finally {
      setIsMutating(false);
    }
  };

  const handleBulkDeliverReady = async () => {
    if (readyItems.length === 0) return;
    setIsMutating(true);
    try {
      for (const it of readyItems) {
        if (onTransitionItem) {
          await onTransitionItem(order.id, it.id, 'SERVED');
        } else {
          updateOrderItemStatus(order.id, it.id, 'SERVED');
          void consoleAuthFetch(`/api/v1/console/orders/${order.id}/items/${it.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'SERVED' }),
          });
        }
      }
      if (order.status === 'READY') {
        if (onTransitionOrder) {
          await onTransitionOrder(order.id, 'SERVED');
        } else {
          updateOrderStatus(order.id, 'SERVED');
          void consoleAuthFetch(`/api/v1/console/orders/${order.id}/status`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'SERVED' }),
          });
        }
      }
    } finally {
      setIsMutating(false);
    }
  };

  // Border styling by column / urgency
  const getBorderLeft = () => {
    if (columnType === 'READY') return '4px solid #10b981';
    if (columnType === 'PREPARING') return '4px solid var(--accent-amber)';
    if (order.unverifiedGuest) return '4px solid var(--accent-amber)';
    return '4px solid #3b82f6';
  };

  const getTableBadgeColor = () => {
    if (columnType === 'READY') return { bg: '#10b981', color: '#000' };
    if (columnType === 'PREPARING') return { bg: 'var(--accent-amber)', color: '#000' };
    return { bg: 'var(--accent-cyan)', color: '#000' };
  };

  const badgeColor = getTableBadgeColor();
  const qtyColor = columnType === 'READY' ? '#10b981' : 'var(--accent-cyan)';

  return (
    <div
      className={`kds-order-ticket ${columnType === 'READY' ? 'pulse-glow' : ''} ${className || ''}`}
      style={{
        borderLeft: getBorderLeft(),
        background: 'rgba(30, 41, 59, 0.7)',
        borderRadius: 'var(--radius-sm)',
        padding: '14px',
        border: '1px solid var(--border-light)',
        borderLeftWidth: '4px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        opacity: isMutating ? 0.75 : 1,
        transition: 'all 0.2s ease',
        ...style,
      }}
    >
      {/* ── Ticket Header ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span
            style={{
              background: badgeColor.bg,
              color: badgeColor.color,
              fontWeight: 900,
              fontSize: '0.9rem',
              padding: '2px 8px',
              borderRadius: '6px',
            }}
          >
            {order.tableNumber}
          </span>
          <span style={{ fontWeight: 800, fontSize: '0.85rem' }}>{order.displayId}</span>
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            title={isExpanded ? 'Collapse ticket' : 'Expand ticket'}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              cursor: 'pointer',
              padding: '2px 6px',
            }}
          >
            {isExpanded ? '▾' : '▸'}
          </button>
        </div>

        <div style={{ textAlign: 'right' }}>
          {columnType === 'READY' && (
            <div style={{ fontSize: '0.73rem', color: '#10b981', fontWeight: 800 }}>
              ✓ {readyItems.length} PLATED ON PASS
            </div>
          )}
          {columnType === 'PREPARING' && (
            <div style={{ fontSize: '0.73rem', color: 'var(--accent-amber)', fontWeight: 800 }}>
              🔥 Cooking ({cookingItems.length})
            </div>
          )}
          <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
            🕒 {order.createdAt}
          </span>
        </div>
      </div>

      {/* ── Unverified Walk-in Diner Warning ── */}
      {order.unverifiedGuest && (
        <div
          style={{
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            borderRadius: '6px',
            padding: '6px 10px',
            fontSize: '0.75rem',
            color: '#fcd34d',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          ⚠️ Unverified walk-in guest — Captain confirm table
        </div>
      )}

      {/* ── Collapsed Summary View ── */}
      {!isExpanded && (
        <div
          onClick={() => setIsExpanded(true)}
          style={{
            fontSize: '0.78rem',
            color: 'var(--text-secondary)',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '6px 10px',
            borderRadius: '6px',
            cursor: 'pointer',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>
            {order.items.length} item{order.items.length === 1 ? '' : 's'} ·{' '}
            {readyItems.length > 0 ? `${readyItems.length} ready` : `${cookingItems.length} cooking`}
          </span>
          <span style={{ color: 'var(--accent-cyan)', fontSize: '0.72rem', fontWeight: 700 }}>
            Click to expand ▾
          </span>
        </div>
      )}

      {/* ── Expanded Item Check-Off List ── */}
      {isExpanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {order.items.map((item) => {
            const isPendingOrConfirmed =
              !item.status || item.status === 'PENDING' || item.status === 'CONFIRMED';
            const isPreparing = item.status === 'PREPARING';
            const isReady = item.status === 'READY';
            const isServed = item.status === 'SERVED';
            const isPostMeal =
              item.courseSequence === 3 ||
              item.courseSequence === 4 ||
              isDessertOrPostMealDish(item.name, item.notes);
            const isReleased =
              item.holdStatus === 'RELEASED' ||
              Boolean(item.notes && item.notes.includes('[RELEASED_TO_KITCHEN]'));
            const isScheduledWait = item.holdStatus === 'SCHEDULED_WAIT';
            const isOnHold =
              (item.holdStatus === 'SERVE_LATER_HOLD' || (isPostMeal && !isReleased && !isScheduledWait)) &&
              (isPendingOrConfirmed || isPreparing);
            const courseBadge = item.courseSequence ? getCourseSequenceBadge(item.courseSequence) : null;
            const urgency = getFireUrgency(item.targetFireAt, item.holdStatus);

            return (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px 10px',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.07)',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '6px',
                      flexWrap: 'wrap',
                      fontSize: '0.88rem',
                    }}
                  >
                    <span style={{ fontWeight: 800, color: qtyColor }}>
                      {item.quantity}×
                    </span>
                    <span style={{ fontWeight: 700 }}>{item.name}</span>

                    {courseBadge && (
                      <span
                        style={{
                          background: courseBadge.bg,
                          color: courseBadge.color,
                          border: `1px solid ${courseBadge.border}`,
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                        }}
                      >
                        {courseBadge.emoji} {courseBadge.label}
                      </span>
                    )}

                    {item.isComboItem && (
                      <span
                        style={{
                          background: 'rgba(168, 85, 247, 0.2)',
                          color: '#c084fc',
                          border: '1px solid rgba(168, 85, 247, 0.45)',
                          padding: '1px 5px',
                          borderRadius: '4px',
                          fontSize: '0.68rem',
                          fontWeight: 800,
                        }}
                      >
                        🍱 {item.comboName || 'Combo'}
                      </span>
                    )}

                    {item.targetTableNumber && item.targetTableNumber !== order.tableNumber && (
                      <span
                        style={{
                          background: 'rgba(245, 158, 11, 0.2)',
                          color: '#fbbf24',
                          border: '1px solid rgba(245, 158, 11, 0.45)',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                        }}
                      >
                        → Table {item.targetTableNumber}
                      </span>
                    )}
                    {user?.role !== 'KITCHEN' && (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        ({formatPaise(item.pricePaise * item.quantity)})
                      </span>
                    )}
                  </div>

                  {item.notes && (
                    <div
                      style={{
                        fontSize: '0.74rem',
                        color: 'var(--accent-amber)',
                        marginTop: '2px',
                      }}
                    >
                      ↳ Note: {item.notes}
                    </div>
                  )}

                  {isOnHold && (
                    <div style={{ marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'rgba(168, 85, 247, 0.2)',
                          border: '1px solid rgba(168, 85, 247, 0.45)',
                          color: '#c084fc',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                        }}
                      >
                        <span>⏳</span>
                        <span>ON HOLD · Serve Later (Guest will signal)</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => handleItemTransition(item.id, 'PREPARING')}
                        style={{
                          background: 'rgba(168, 85, 247, 0.3)',
                          border: '1px solid #c084fc',
                          color: '#fff',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        🔥 Fire Now
                      </button>
                    </div>
                  )}

                  {isScheduledWait && (
                    <div style={{ marginTop: '4px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: urgency.bg,
                          border: `1px solid ${urgency.border}`,
                          color: urgency.color,
                          fontSize: '0.72rem',
                          fontWeight: 800,
                        }}
                      >
                        <span>⏱️</span>
                        <span>{urgency.label}</span>
                      </span>

                      <button
                        type="button"
                        onClick={() => handleItemTransition(item.id, 'PREPARING')}
                        style={{
                          background: 'rgba(245, 158, 11, 0.25)',
                          border: '1px solid var(--accent-amber)',
                          color: '#fff',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          padding: '2px 8px',
                          borderRadius: '4px',
                          cursor: 'pointer',
                        }}
                      >
                        ⚡ Fire Ahead
                      </button>
                    </div>
                  )}

                  {isReleased && (
                    <div style={{ marginTop: '4px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          background: 'rgba(245, 158, 11, 0.25)',
                          border: '1px solid rgba(245, 158, 11, 0.5)',
                          color: '#fbbf24',
                          fontSize: '0.72rem',
                          fontWeight: 800,
                        }}
                        className="pulse-glow"
                      >
                        <span>🔥</span>
                        <span>GUEST SIGNALLED · PREPARE NOW!</span>
                      </span>
                    </div>
                  )}

                  {!isOnHold && !isScheduledWait && item.targetFireAt && (isPendingOrConfirmed || isPreparing) && (
                    <div style={{ marginTop: '4px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: urgency.bg,
                          border: `1px solid ${urgency.border}`,
                          color: urgency.color,
                          fontSize: '0.7rem',
                          fontWeight: 800,
                        }}
                        className={urgency.pulse ? 'pulse-glow' : ''}
                      >
                        {urgency.label}
                      </span>
                    </div>
                  )}

                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                    🕒 {item.createdAt || order.createdAt}
                  </div>
                </div>

                {/* ── Status Mutation Action Buttons ── */}
                <div style={{ flexShrink: 0 }}>
                  {isPendingOrConfirmed && (
                    <button
                      type="button"
                      onClick={() => handleItemTransition(item.id, 'PREPARING')}
                      className="btn-primary"
                      style={{
                        padding: '6px 10px',
                        fontSize: '0.76rem',
                        fontWeight: 800,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                      }}
                    >
                      <span>🍳 Start Cooking</span>
                      <span>→</span>
                    </button>
                  )}

                  {isPreparing && (
                    <button
                      type="button"
                      onClick={() => handleItemTransition(item.id, 'READY')}
                      style={{
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        color: '#fff',
                        padding: '6px 10px',
                        borderRadius: 'var(--radius-sm)',
                        fontWeight: 800,
                        fontSize: '0.76rem',
                        border: 'none',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span>🍽️ Plated &amp; Ready</span>
                      <span>→</span>
                    </button>
                  )}

                  {isReady &&
                    (user?.role === 'KITCHEN' ? (
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '5px 8px',
                          borderRadius: '6px',
                          background: 'rgba(16, 185, 129, 0.14)',
                          border: '1px solid rgba(16, 185, 129, 0.3)',
                          color: '#10b981',
                          fontSize: '0.72rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        ✓ On Pass
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleItemTransition(item.id, 'SERVED')}
                        className="btn-success"
                        style={{
                          padding: '6px 10px',
                          fontSize: '0.76rem',
                          fontWeight: 800,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        <span>🏃 Served</span>
                        <span>✓</span>
                      </button>
                    ))}

                  {isServed && (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#10b981',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ✓ Served
                    </span>
                  )}

                  {item.status === 'CANCELLED' && (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '5px 8px',
                        borderRadius: '6px',
                        background: 'rgba(239, 68, 68, 0.15)',
                        color: '#f87171',
                        fontSize: '0.72rem',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      ✕ Cancelled
                    </span>
                  )}
                </div>
              </div>
            );
          })}

          {/* ── Special Instructions ── */}
          {order.specialInstructions && (
            <div
              style={{
                fontSize: '0.76rem',
                background: 'rgba(255, 255, 255, 0.04)',
                padding: '6px 8px',
                borderRadius: '4px',
                color: 'var(--text-secondary)',
              }}
            >
              💬 &quot;{order.specialInstructions}&quot;
            </div>
          )}

          {/* ── Ready Column Expediter Footer ── */}
          {columnType === 'READY' && (
            <>
              {cookingItems.length > 0 && (
                <div
                  style={{
                    padding: '6px 10px',
                    background: 'rgba(245, 158, 11, 0.1)',
                    border: '1px solid rgba(245, 158, 11, 0.25)',
                    borderRadius: '6px',
                    color: 'var(--accent-amber)',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  <span>⏳</span>
                  <span>
                    {cookingItems.length} other dish{cookingItems.length === 1 ? '' : 'es'} still
                    cooking in kitchen
                  </span>
                </div>
              )}

              {user?.role === 'KITCHEN' ? (
                <div
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    border: '1px solid rgba(16, 185, 129, 0.3)',
                    borderRadius: 'var(--radius-sm)',
                    color: '#10b981',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    textAlign: 'center',
                  }}
                >
                  ✓ Plated on Pass · Waiting for Runner
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {readyItems.length > 0 && (
                    <button
                      type="button"
                      onClick={handleBulkDeliverReady}
                      className="btn-success"
                      style={{
                        width: '100%',
                        padding: '9px 12px',
                        fontSize: '0.82rem',
                        fontWeight: 800,
                      }}
                    >
                      🏃 Deliver {readyItems.length} Ready Dish
                      {readyItems.length === 1 ? '' : 'es'} to Table
                    </button>
                  )}
                  {onSettleOrder && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        onClick={() => onSettleOrder(order)}
                        style={{
                          flex: 1,
                          background: 'rgba(6, 182, 212, 0.15)',
                          color: 'var(--accent-cyan)',
                          border: '1px solid rgba(6, 182, 212, 0.4)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '8px 12px',
                          fontSize: '0.78rem',
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        💳 Settle ({formatPaise(order.totalPaise)})
                      </button>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default OrderTicketCard;
