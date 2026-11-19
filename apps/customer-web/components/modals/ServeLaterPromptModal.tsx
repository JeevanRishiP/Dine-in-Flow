'use client';

import React, { useState } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { customerApiFetch } from '../../app/lib/guest-session';
import type { TableOrderRecord } from '../../types';

export interface ServeLaterPromptModalProps {
  isOpen?: boolean;
  order?: TableOrderRecord | null;
  onClose?: () => void;
  showToast?: (msg: string) => void;
  onRefreshOrders?: () => Promise<void> | void;
}

export function ServeLaterPromptModal({
  isOpen: propsIsOpen,
  order: propsOrder,
  onClose,
  showToast = (msg: string) => console.log(msg),
  onRefreshOrders,
}: ServeLaterPromptModalProps) {
  const storePrompt = useOrderStore((s) => s.serveLaterPrompt);
  const setServeLaterPrompt = useOrderStore((s) => s.setServeLaterPrompt);
  const setServeLaterDismissedUntil = useOrderStore((s) => s.setServeLaterDismissedUntil);

  const [loadingAction, setLoadingAction] = useState<'RELEASE' | 'SNOOZE' | null>(null);

  // Determine if modal should be open
  const isOpen = propsIsOpen !== undefined ? propsIsOpen : !!storePrompt;
  const effectiveOrderId = propsOrder?.id || storePrompt?.orderId;
  const itemNames = storePrompt?.itemNames || (
    propsOrder?.items
      .filter((it) => it.hold_status === 'SERVE_LATER_HOLD')
      .map((it) => it.name_snapshot)
  ) || ['Desserts & Beverages'];

  if (!isOpen || !effectiveOrderId) return null;

  const handlePrepareNow = async () => {
    if (loadingAction) return;
    setLoadingAction('RELEASE');
    try {
      const res = await customerApiFetch(
        `/api/v1/customer/orders/${encodeURIComponent(effectiveOrderId)}/serve-later/release`,
        { method: 'POST' },
        { preferToken: 'guest' },
      );

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || 'Failed to fire held dishes to kitchen');
      }

      setServeLaterPrompt(null);
      showToast(`Kitchen notified! Preparing ${itemNames.join(', ')} now 🔥`);
      await onRefreshOrders?.();
      onClose?.();
    } catch (err: unknown) {
      console.error('Error releasing serve-later hold:', err);
      const msg = err instanceof Error ? err.message : 'Could not fire items to kitchen. Please try again.';
      showToast(msg);
    } finally {
      setLoadingAction(null);
    }
  };

  const handleWait10Mins = async () => {
    if (loadingAction) return;
    setLoadingAction('SNOOZE');
    try {
      await customerApiFetch(
        `/api/v1/customer/orders/${encodeURIComponent(effectiveOrderId)}/serve-later/snooze`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ minutes: 10 }),
        },
        { preferToken: 'guest' },
      ).catch(() => {});

      setServeLaterDismissedUntil(Date.now() + 10 * 60 * 1000);
      setServeLaterPrompt(null);
      showToast('Snoozed for 10 minutes. We’ll check back soon ⏳');
      onClose?.();
    } catch (err) {
      console.error('Error snoozing serve later:', err);
      setServeLaterPrompt(null);
      onClose?.();
    } finally {
      setLoadingAction(null);
    }
  };

  const handleDismiss = () => {
    setServeLaterDismissedUntil(Date.now() + 10 * 60 * 1000);
    setServeLaterPrompt(null);
    onClose?.();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="serve-later-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'flex-end', // Bottom sheet
        justifyContent: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(8px)',
        padding: '0',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={handleDismiss}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '500px',
          background: 'linear-gradient(180deg, #1e1b4b 0%, #0f172a 100%)',
          borderTop: '2px solid rgba(168, 85, 247, 0.5)',
          borderRadius: '24px 24px 0 0',
          padding: '24px 20px 32px',
          boxShadow: '0 -20px 40px -15px rgba(0, 0, 0, 0.8), 0 0 30px rgba(168, 85, 247, 0.25)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          color: '#f8fafc',
          position: 'relative',
          animation: 'slideUp 0.25s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle pill */}
        <div
          style={{
            width: '40px',
            height: '4px',
            background: 'rgba(255, 255, 255, 0.2)',
            borderRadius: '2px',
            margin: '0 auto 4px',
          }}
        />

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.2))',
              border: '1px solid rgba(168, 85, 247, 0.6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.6rem',
              flexShrink: 0,
            }}
          >
            🍨
          </div>
          <div style={{ flex: 1 }}>
            <span
              style={{
                fontSize: '0.72rem',
                fontWeight: 800,
                color: '#c084fc',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              Smart Kitchen Orchestrator
            </span>
            <h2
              id="serve-later-modal-title"
              style={{
                margin: 0,
                fontSize: '1.18rem',
                fontWeight: 900,
                color: '#fff',
                lineHeight: 1.25,
              }}
            >
              Ready for your next course?
            </h2>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Close prompt"
            style={{
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
        </div>

        {/* Friendly Message */}
        <p style={{ margin: 0, fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.5 }}>
          Hope you enjoyed your meal! Ready for the kitchen to freshly prepare your{' '}
          <strong style={{ color: '#fbbf24' }}>
            {itemNames.length > 0 ? itemNames.join(', ') : 'Desserts & Beverages'}
          </strong>
          ?
        </p>

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
          <button
            type="button"
            onClick={handlePrepareNow}
            disabled={loadingAction !== null}
            style={{
              width: '100%',
              padding: '14px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#000',
              fontWeight: 900,
              fontSize: '0.96rem',
              border: 'none',
              cursor: loadingAction ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 16px rgba(16, 185, 129, 0.4)',
              opacity: loadingAction === 'RELEASE' ? 0.7 : 1,
            }}
          >
            <span>{loadingAction === 'RELEASE' ? 'Notifying Kitchen…' : '🔥 Prepare Now'}</span>
          </button>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              type="button"
              onClick={handleWait10Mins}
              disabled={loadingAction !== null}
              style={{
                flex: 1,
                padding: '12px 14px',
                borderRadius: '12px',
                background: 'rgba(245, 158, 11, 0.12)',
                color: '#fbbf24',
                border: '1px solid rgba(245, 158, 11, 0.35)',
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
              <span>{loadingAction === 'SNOOZE' ? 'Snoozing…' : '⏳ Wait 10 More Mins'}</span>
            </button>

            <button
              type="button"
              onClick={handleDismiss}
              style={{
                flex: 1,
                padding: '12px 14px',
                borderRadius: '12px',
                background: 'rgba(255, 255, 255, 0.05)',
                color: '#94a3b8',
                border: '1px solid rgba(255, 255, 255, 0.1)',
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

export default ServeLaterPromptModal;
