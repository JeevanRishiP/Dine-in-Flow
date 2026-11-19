'use client';

import React, { useState } from 'react';
import type { KdsItemTicket } from '../../../app/lib/restaurant-db';
import { useStaffStore } from '../../../store/useStaffStore';
import { consoleAuthFetch } from '../../../app/lib/auth-client';
import { getCourseSequenceBadge, getFireUrgency, formatOriginBadge } from './kds-utils';

export { formatOriginBadge };

export interface KdsItemCardProps {
  ticket: KdsItemTicket;
  nowMs?: number;
  onTransitionItem?: (
    orderId: string,
    itemId: string,
    nextStatus: 'PREPARING' | 'READY' | 'SERVED',
  ) => void | Promise<void>;
  onFireEarly?: (orderId: string, itemId: string) => void | Promise<void>;
  className?: string;
  style?: React.CSSProperties;
}

export function KdsItemCard({
  ticket,
  nowMs = Date.now(),
  onTransitionItem,
  onFireEarly,
  className,
  style,
}: KdsItemCardProps) {
  const updateKdsItemStatus = useStaffStore((s) => s.updateKdsItemStatus);
  const showStaffToast = useStaffStore((s) => s.showStaffToast);
  const [isMutating, setIsMutating] = useState(false);

  const urgency = getFireUrgency(ticket.targetFireAt, ticket.holdStatus, nowMs);
  const courseBadge = getCourseSequenceBadge(ticket.courseSequence);
  const origin = formatOriginBadge(ticket);

  const isCooking = ticket.itemStatus === 'PREPARING';
  const isReady = ticket.itemStatus === 'READY';
  const isQueued = !isCooking && !isReady;
  const isHeld = ticket.holdStatus === 'SERVE_LATER_HOLD' || ticket.holdStatus === 'SCHEDULED_WAIT';

  const handleTransition = async () => {
    if (isMutating) return;
    setIsMutating(true);

    let nextStatus: 'PREPARING' | 'READY' | 'SERVED' = 'PREPARING';
    if (ticket.itemStatus === 'PREPARING') {
      nextStatus = 'READY';
    } else if (ticket.itemStatus === 'READY') {
      nextStatus = 'SERVED';
    }

    try {
      if (onTransitionItem) {
        await onTransitionItem(ticket.orderId, ticket.itemId, nextStatus);
      } else {
        updateKdsItemStatus(ticket.itemId, nextStatus, 'RELEASED');
        const res = await consoleAuthFetch(
          `/api/v1/console/orders/${ticket.orderId}/items/${ticket.itemId}/status`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: nextStatus }),
          },
        );
        if (!res.ok) {
          if (res.status === 409) {
            let msg = 'Item already claimed by another chef';
            try {
              const body = await res.json();
              if (body?.detail) msg = body.detail;
            } catch {}
            showStaffToast(`⚠️ ${msg}`);
            return;
          }
          showStaffToast(`Failed to update item: HTTP ${res.status}`);
          return;
        }
      }

      showStaffToast(
        nextStatus === 'PREPARING'
          ? `🍳 Cooking: ${ticket.quantity}× ${ticket.dishName}`
          : nextStatus === 'READY'
          ? `🍽️ Plated & Ready: ${ticket.dishName} on pass`
          : `✓ Served: ${ticket.dishName}`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update item';
      showStaffToast(`⚠️ ${msg}`);
    } finally {
      setIsMutating(false);
    }
  };

  const handleReleaseHeldItem = async () => {
    if (isMutating) return;
    setIsMutating(true);

    try {
      if (onFireEarly) {
        await onFireEarly(ticket.orderId, ticket.itemId);
      } else {
        updateKdsItemStatus(ticket.itemId, 'CONFIRMED', 'RELEASED');
        const res = await consoleAuthFetch(
          `/api/v1/console/orders/${ticket.orderId}/serve-later/release`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: ticket.itemId }),
          },
        );
        if (!res.ok) {
          if (res.status === 409) {
            showStaffToast('⚠️ Cannot prepare an unpaid order: Order is not paid');
            return;
          }
          showStaffToast(`Failed to fire item: HTTP ${res.status}`);
          return;
        }
      }
      showStaffToast(`🔥 Fired to active queue: ${ticket.dishName}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to fire item';
      showStaffToast(`⚠️ ${msg}`);
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div
      className={`kds-item-card ${urgency.pulse ? 'kds-card-pulse' : ''} ${className || ''}`}
      style={{
        background: 'var(--bg-surface, #1e222b)',
        border: urgency.isOverdue
          ? '2px solid #ef4444'
          : urgency.isFireNow
          ? '1.5px solid rgba(239, 68, 68, 0.6)'
          : isCooking
          ? '1.5px solid rgba(245, 158, 11, 0.5)'
          : isReady
          ? '1.5px solid rgba(16, 185, 129, 0.5)'
          : '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '12px',
        padding: '14px 16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        boxShadow: urgency.isOverdue
          ? '0 0 16px rgba(239, 68, 68, 0.3)'
          : '0 4px 12px rgba(0, 0, 0, 0.25)',
        position: 'relative',
        transition: 'all 0.2s ease',
        ...style,
      }}
      data-item-id={ticket.itemId}
      data-order-id={ticket.orderId}
    >
      {/* ── Header: Origin Badge + Order Reference ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            padding: '3px 8px',
            borderRadius: '6px',
            fontSize: '0.78rem',
            fontWeight: 700,
            background: origin.bg,
            color: origin.color,
            border: `1px solid ${origin.border}`,
            letterSpacing: '0.02em',
          }}
        >
          {origin.text}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {ticket.dinerLabel && (
            <span
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid rgba(56, 189, 248, 0.35)',
                color: '#38bdf8',
                padding: '2px 6px',
                borderRadius: '4px',
                fontSize: '0.74rem',
                fontWeight: 700,
              }}
            >
              👤 {ticket.dinerLabel}
            </span>
          )}
          <span
            style={{
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              fontWeight: 700,
              color: '#fbbf24',
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.25)',
              padding: '2px 6px',
              borderRadius: '4px',
            }}
          >
            {ticket.displayId || ticket.orderDisplayId || (ticket.orderNumber ? `ORD-${String(ticket.orderNumber).padStart(4, '0')}` : ticket.orderId.slice(0, 6).toUpperCase())}
          </span>
        </div>
      </div>

      {/* ── Combo Tag (High Visibility) ── */}
      {ticket.isComboItem && (
        <div
          style={{
            background: 'linear-gradient(90deg, rgba(234, 88, 12, 0.25), rgba(239, 68, 68, 0.25))',
            border: '1px solid rgba(249, 115, 22, 0.5)',
            borderRadius: '6px',
            padding: '4px 8px',
            fontSize: '0.75rem',
            fontWeight: 800,
            color: '#fb923c',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <span>🔥 COMBO:</span>
          <span style={{ color: '#fff', fontWeight: 700 }}>
            {ticket.comboName || 'Combo Item'}
          </span>
        </div>
      )}

      {/* ── Main Quantity & Dish Name ── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
        <span
          style={{
            fontSize: '1.25rem',
            fontWeight: 900,
            color: '#38bdf8',
            fontFamily: 'monospace',
            lineHeight: 1.1,
          }}
        >
          {ticket.quantity}×
        </span>
        <span
          style={{
            fontSize: '1.05rem',
            fontWeight: 700,
            color: '#ffffff',
            lineHeight: 1.25,
            wordBreak: 'break-word',
          }}
        >
          {ticket.dishName}
        </span>
      </div>

      {/* ── Course Sequence & Timing Strip ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          flexWrap: 'wrap',
          fontSize: '0.75rem',
          padding: '6px 8px',
          background: 'rgba(0, 0, 0, 0.2)',
          borderRadius: '8px',
        }}
      >
        {/* Course Label */}
        <span
          style={{
            background: courseBadge.bg,
            color: courseBadge.color,
            border: `1px solid ${courseBadge.border}`,
            padding: '2px 6px',
            borderRadius: '4px',
            fontWeight: 700,
          }}
        >
          {courseBadge.emoji} {courseBadge.label}
        </span>

        {/* Prep Time */}
        <span
          style={{
            color: 'var(--text-secondary, #94a3b8)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '2px',
          }}
        >
          ⏱️ {ticket.prepTimeMinutes}m
        </span>

        {/* Live Fire Countdown / Overdue Badge */}
        <span
          style={{
            marginLeft: 'auto',
            background: urgency.bg,
            color: urgency.color,
            border: `1px solid ${urgency.border}`,
            padding: '2px 8px',
            borderRadius: '4px',
            fontWeight: 800,
            fontSize: '0.73rem',
            letterSpacing: '0.02em',
          }}
        >
          {urgency.label}
        </span>
      </div>

      {/* ── Customizations: Spice, Modifiers, Notes ── */}
      {(ticket.spiceLevel ||
        (Array.isArray(ticket.modifiers) && ticket.modifiers.length > 0) ||
        ticket.notes) && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '4px',
            fontSize: '0.8rem',
            background: 'rgba(255, 255, 255, 0.03)',
            padding: '6px 8px',
            borderRadius: '6px',
            borderLeft: '2px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          {ticket.spiceLevel && (
            <div style={{ color: '#f87171', fontWeight: 600 }}>
              🌶️ Spice: {ticket.spiceLevel}
            </div>
          )}

          {Array.isArray(ticket.modifiers) && ticket.modifiers.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
              {ticket.modifiers.map((mod: any, idx) => (
                <span
                  key={idx}
                  style={{
                    background: 'rgba(255, 255, 255, 0.08)',
                    padding: '1px 6px',
                    borderRadius: '4px',
                    fontSize: '0.72rem',
                    color: '#e2e8f0',
                  }}
                >
                  +{typeof mod === 'string' ? mod : mod?.name || JSON.stringify(mod)}
                </span>
              ))}
            </div>
          )}

          {ticket.notes && (
            <div
              style={{
                fontStyle: 'italic',
                color: '#cbd5e1',
                fontSize: '0.78rem',
              }}
            >
              📝 &ldquo;{ticket.notes}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* ── Single-Tap Transition Button ── */}
      <div style={{ marginTop: 'auto', paddingTop: '4px' }}>
        {isHeld ? (
          <button
            type="button"
            disabled={isMutating}
            onClick={handleReleaseHeldItem}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: isMutating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(168, 85, 247, 0.3)',
              opacity: isMutating ? 0.7 : 1,
            }}
          >
            {isMutating ? 'Processing...' : '🔥 Fire Held Dish Now'}
          </button>
        ) : isQueued ? (
          <button
            type="button"
            disabled={isMutating}
            onClick={handleTransition}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #f59e0b, #d97706)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: isMutating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(245, 158, 11, 0.3)',
              opacity: isMutating ? 0.7 : 1,
            }}
          >
            {isMutating ? 'Updating...' : '🍳 Start Cooking'}
          </button>
        ) : isCooking ? (
          <button
            type="button"
            disabled={isMutating}
            onClick={handleTransition}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: 'none',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#ffffff',
              fontWeight: 800,
              fontSize: '0.88rem',
              cursor: isMutating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              boxShadow: '0 2px 8px rgba(16, 185, 129, 0.3)',
              opacity: isMutating ? 0.7 : 1,
            }}
          >
            {isMutating ? 'Plating...' : '🍽️ Plated & Ready'}
          </button>
        ) : (
          <button
            type="button"
            disabled={isMutating}
            onClick={handleTransition}
            style={{
              width: '100%',
              padding: '10px 14px',
              borderRadius: '8px',
              border: '1px solid rgba(16, 185, 129, 0.4)',
              background: 'rgba(16, 185, 129, 0.12)',
              color: '#34d399',
              fontWeight: 700,
              fontSize: '0.84rem',
              cursor: isMutating ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
            }}
          >
            {isMutating ? 'Updating...' : '✓ On Pass (Deliver to Table)'}
          </button>
        )}
      </div>
    </div>
  );
}
