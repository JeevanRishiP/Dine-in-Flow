'use client';

import React, { useState } from 'react';
import type { TableOrderRecord } from '../../types';
import { getCourseBadge, getCourseSequenceLabel } from './orders-utils';

export interface CustomerServeLaterModalProps {
  isOpen: boolean;
  order: TableOrderRecord | null;
  onReleaseHold: (plateKeys: string[], itemName?: string) => Promise<void> | void;
  onSnooze: (orderId: string, minutes?: number) => Promise<void> | void;
  onClose: () => void;
}

export function CustomerServeLaterModal({
  isOpen,
  order,
  onReleaseHold,
  onSnooze,
  onClose,
}: CustomerServeLaterModalProps) {
  const [loadingAction, setLoadingAction] = useState<'RELEASE' | 'SNOOZE' | null>(null);

  if (!isOpen || !order) return null;

  // Filter items that are currently in hold state
  const heldItems = order.items.filter(
    (it) => it.hold_status === 'SERVE_LATER_HOLD' || (!it.hold_status && it.status !== 'SERVED' && it.status !== 'CANCELLED')
  );

  // Generate plate keys for all held items
  const heldPlateKeys: string[] = [];
  heldItems.forEach((it) => {
    const qty = Math.max(1, it.quantity || 1);
    for (let pIdx = 1; pIdx <= qty; pIdx++) {
      heldPlateKeys.push(`${order.id}-${it.id}-${pIdx}`);
    }
  });

  const handleFireAllNow = async () => {
    if (loadingAction) return;
    setLoadingAction('RELEASE');
    try {
      await onReleaseHold(
        heldPlateKeys,
        heldItems.length === 1 ? heldItems[0]?.name_snapshot : 'Desserts & Beverages'
      );
      onClose();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleSnooze = async () => {
    if (loadingAction) return;
    setLoadingAction('SNOOZE');
    try {
      await onSnooze(order.id, 10);
      onClose();
    } finally {
      setLoadingAction(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="serve-later-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        padding: '16px',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '460px',
          background: '#0f172a',
          border: '1px solid rgba(168, 85, 247, 0.4)',
          borderRadius: '20px',
          padding: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 30px rgba(168, 85, 247, 0.2)',
          display: 'flex',
          flexDirection: 'column',
          gap: '18px',
          color: '#f8fafc',
          position: 'relative',
        }}
      >
        {/* Close "X" button */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          style={{
            position: 'absolute',
            top: '16px',
            right: '16px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            borderRadius: '50%',
            width: '32px',
            height: '32px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94a3b8',
            fontSize: '1.1rem',
            cursor: 'pointer',
          }}
        >
          ✕
        </button>

        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div
            style={{
              width: '52px',
              height: '52px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.25), rgba(236, 72, 153, 0.2))',
              border: '1px solid rgba(168, 85, 247, 0.5)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.8rem',
              flexShrink: 0,
            }}
          >
            🍨
          </div>
          <div>
            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 800,
                color: '#c084fc',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Smart Kitchen Orchestrator
            </span>
            <h2
              id="serve-later-title"
              style={{
                fontSize: '1.25rem',
                fontWeight: 900,
                color: '#fff',
                margin: '2px 0 0 0',
                lineHeight: 1.3,
              }}
            >
              Ready for Desserts & Drinks?
            </h2>
          </div>
        </div>

        {/* Informative Body */}
        <p
          style={{
            fontSize: '0.88rem',
            lineHeight: 1.5,
            color: '#cbd5e1',
            margin: 0,
          }}
        >
          Your main course was served 15 minutes ago! Would you like our chefs to start preparing your desserts
          and beverages now so they arrive fresh and at the perfect temperature?
        </p>

        {/* Held Items List */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            borderRadius: '12px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            maxHeight: '180px',
            overflowY: 'auto',
          }}
        >
          <div
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#94a3b8',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            Held Dishes Waiting for Your Signal:
          </div>
          {heldItems.map((it) => {
            const badge = getCourseBadge(it.course_sequence ?? 3);
            return (
              <div
                key={it.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.86rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      background: badge.bg,
                      color: badge.color,
                      border: `1px solid ${badge.border}`,
                      fontSize: '0.68rem',
                      fontWeight: 800,
                      padding: '2px 6px',
                      borderRadius: '6px',
                    }}
                  >
                    {badge.emoji} {badge.code}
                  </span>
                  <span style={{ fontWeight: 600, color: '#f1f5f9' }}>
                    {it.name_snapshot}
                  </span>
                </div>
                <span style={{ color: '#94a3b8', fontSize: '0.8rem', fontWeight: 700 }}>
                  x{it.quantity}
                </span>
              </div>
            );
          })}
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
          <button
            type="button"
            onClick={handleFireAllNow}
            disabled={loadingAction !== null}
            style={{
              width: '100%',
              background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
              color: '#fff',
              border: 'none',
              borderRadius: '12px',
              padding: '14px',
              fontWeight: 900,
              fontSize: '0.96rem',
              cursor: loadingAction ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 16px rgba(109, 40, 217, 0.4)',
              transition: 'transform 0.15s ease, opacity 0.15s ease',
              opacity: loadingAction === 'RELEASE' ? 0.7 : 1,
            }}
          >
            <span>{loadingAction === 'RELEASE' ? 'Notifying Kitchen…' : '🍳 Yes, Start Cooking Now!'}</span>
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={handleSnooze}
              disabled={loadingAction !== null}
              style={{
                flex: 1,
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: '12px',
                padding: '10px 14px',
                fontWeight: 700,
                fontSize: '0.84rem',
                cursor: loadingAction ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                opacity: loadingAction === 'SNOOZE' ? 0.7 : 1,
              }}
            >
              <span>{loadingAction === 'SNOOZE' ? 'Snoozing…' : '⏰ Snooze 10 Mins'}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                flex: 1,
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '12px',
                padding: '10px 14px',
                fontWeight: 600,
                fontSize: '0.84rem',
                cursor: 'pointer',
              }}
            >
              Decide Later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
