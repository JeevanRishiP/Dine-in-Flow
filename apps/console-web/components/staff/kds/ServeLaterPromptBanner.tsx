'use client';

import React, { useState } from 'react';
import { useStaffStore } from '../../../store/useStaffStore';
import { consoleAuthFetch } from '../../../app/lib/auth-client';

export function ServeLaterPromptBanner() {
  const serveLaterPrompts = useStaffStore((s) => s.serveLaterPrompts);
  const dismissServeLaterPrompt = useStaffStore((s) => s.dismissServeLaterPrompt);
  const updateOrderItemStatus = useStaffStore((s) => s.updateOrderItemStatus);
  const showStaffToast = useStaffStore((s) => s.showStaffToast);
  const orders = useStaffStore((s) => s.orders);

  const [mutatingOrderId, setMutatingOrderId] = useState<string | null>(null);

  if (serveLaterPrompts.length === 0) return null;

  const handleReleaseAll = async (orderId: string, tableNumber: string) => {
    setMutatingOrderId(orderId);
    try {
      const res = await consoleAuthFetch(`/api/v1/console/orders/${encodeURIComponent(orderId)}/serve-later/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || errData.message || 'Failed to release dishes to kitchen');
      }

      dismissServeLaterPrompt(orderId);
      showStaffToast(`🔥 Released desserts & beverages for Table ${tableNumber} to kitchen!`);
    } catch (err: unknown) {
      console.error('Failed to release hold items:', err);
      const msg = err instanceof Error ? err.message : 'Failed to release hold items';
      showStaffToast(`⚠️ ${msg}`);
    } finally {
      setMutatingOrderId(null);
    }
  };

  const handleSnooze = async (orderId: string, tableNumber: string) => {
    setMutatingOrderId(orderId);
    try {
      await consoleAuthFetch(`/api/v1/customer/orders/${orderId}/serve-later/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snooze_minutes: 10 }),
      });
      dismissServeLaterPrompt(orderId);
      showStaffToast(`💤 Snoozed serve-later prompt for Table ${tableNumber} by 10 mins`);
    } catch (err) {
      console.error('Failed to snooze prompt:', err);
      dismissServeLaterPrompt(orderId);
    } finally {
      setMutatingOrderId(null);
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        margin: '12px 24px 0',
      }}
      aria-label="Serve Later Guest Prompts"
    >
      {serveLaterPrompts.map((prompt) => {
        const isMutating = mutatingOrderId === prompt.orderId;
        return (
          <div
            key={prompt.orderId}
            style={{
              background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(15, 23, 42, 0.85))',
              border: '1.5px solid rgba(168, 85, 247, 0.55)',
              borderRadius: 'var(--radius-md)',
              padding: '12px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '12px',
              boxShadow: '0 4px 20px rgba(168, 85, 247, 0.15)',
              opacity: isMutating ? 0.75 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div
                style={{
                  fontSize: '1.6rem',
                  background: 'rgba(168, 85, 247, 0.25)',
                  padding: '6px',
                  borderRadius: '10px',
                }}
              >
                🍨
              </div>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span
                    style={{
                      background: '#9333ea',
                      color: '#fff',
                      fontSize: '0.8rem',
                      fontWeight: 900,
                      padding: '2px 8px',
                      borderRadius: '4px',
                    }}
                  >
                    Table {prompt.tableNumber}
                  </span>
                  <span style={{ fontSize: '0.92rem', fontWeight: 800 }}>
                    Main course was served 15 minutes ago!
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', marginTop: '3px' }}>
                  Guest has items waiting on hold. Ready to fire desserts &amp; post-meal beverages to kitchen?
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                disabled={isMutating}
                onClick={() => handleReleaseAll(prompt.orderId, prompt.tableNumber)}
                className="btn-primary"
                style={{
                  background: 'linear-gradient(135deg, #a855f7, #7e22ce)',
                  border: 'none',
                  fontSize: '0.82rem',
                  fontWeight: 800,
                  padding: '7px 14px',
                }}
              >
                🔥 Fire to Kitchen Now
              </button>

              <button
                type="button"
                disabled={isMutating}
                onClick={() => handleSnooze(prompt.orderId, prompt.tableNumber)}
                className="btn-secondary"
                style={{ fontSize: '0.82rem', fontWeight: 700, padding: '7px 12px' }}
              >
                💤 Snooze 10m
              </button>

              <button
                type="button"
                onClick={() => dismissServeLaterPrompt(prompt.orderId)}
                title="Dismiss prompt"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-muted)',
                  fontSize: '1rem',
                  cursor: 'pointer',
                  padding: '4px',
                }}
              >
                ✕
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ServeLaterPromptBanner;
