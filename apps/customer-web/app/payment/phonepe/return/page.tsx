'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { customerApiFetch } from '../../../lib/guest-session';

function PhonePeReturnContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const orderId = searchParams.get('orderId') || '';
  const merchantTransactionId = searchParams.get('merchantTransactionId') || '';

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'SUCCESS' | 'PENDING' | 'FAILED'>('PENDING');
  const [errorMessage, setErrorMessage] = useState('');

  const handleManualRecheck = async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const res = await customerApiFetch(
        `/api/v1/customer/payments/verify-order?orderId=${encodeURIComponent(orderId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        if (data.status === 'PAID') {
          setStatus('SUCCESS');
          setLoading(false);
          setTimeout(() => {
            router.push(`/?payment_success=true&order_id=${encodeURIComponent(orderId)}`);
          }, 2000);
          return;
        }
      }
    } catch {}
    setLoading(false);
  };

  useEffect(() => {
    let timer: NodeJS.Timeout;
    let isSubscribed = true;

    async function checkStatus() {
      if (!orderId) {
        setLoading(false);
        setStatus('FAILED');
        setErrorMessage('Missing order reference.');
        return;
      }

      let attempts = 0;
      const maxAttempts = 5;

      const poll = async () => {
        if (!isSubscribed) return;
        attempts++;
        try {
          const res = await customerApiFetch(
            `/api/v1/customer/payments/verify-order?orderId=${encodeURIComponent(orderId)}`,
          );
          if (res.ok) {
            const data = await res.json();
            if (data.status === 'PAID') {
              setStatus('SUCCESS');
              setLoading(false);
              // Auto redirect to customer-web with payment_success flag after 2s
              timer = setTimeout(() => {
                if (isSubscribed) {
                  router.push(`/?payment_success=true&order_id=${encodeURIComponent(orderId)}`);
                }
              }, 2000);
              return;
            }
          }
        } catch (err) {
          console.error('Error verifying payment:', err);
        }

        if (attempts < maxAttempts && isSubscribed) {
          timer = setTimeout(poll, 1500);
        } else {
          setLoading(false);
        }
      };

      poll();
    }

    checkStatus();
    return () => {
      isSubscribed = false;
      clearTimeout(timer);
    };
  }, [orderId, router]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0a0d14',
        color: '#f8fafc',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          maxWidth: '440px',
          width: '100%',
          background: '#111624',
          borderRadius: '16px',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          padding: '32px 24px',
          textAlign: 'center',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
        }}
      >
        {/* PhonePe Header Brand */}
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            background: 'rgba(95, 37, 159, 0.2)',
            border: '1px solid rgba(147, 51, 234, 0.4)',
            padding: '6px 14px',
            borderRadius: '999px',
            color: '#c084fc',
            fontSize: '0.82rem',
            fontWeight: 800,
            marginBottom: '20px',
          }}
        >
          <span>⚡</span>
          <span>PhonePe Payment Gateway (Sandbox)</span>
        </div>

        {loading ? (
          <div>
            <div
              style={{
                width: '48px',
                height: '48px',
                border: '3px solid rgba(245, 158, 11, 0.2)',
                borderTopColor: '#f59e0b',
                borderRadius: '50%',
                margin: '0 auto 20px',
                animation: 'spin 0.8s linear infinite',
              }}
            />
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '8px' }}>
              Verifying Payment with Bank...
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5 }}>
              Connecting to PhonePe UPI sandbox servers to reconcile your transaction.
            </p>
          </div>
        ) : status === 'SUCCESS' ? (
          <div>
            <div style={{ fontSize: '3.5rem', marginBottom: '14px' }}>✅</div>
            <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#10b981', marginBottom: '8px' }}>
              Payment Confirmed!
            </h2>
            <p style={{ fontSize: '0.88rem', color: '#cbd5e1', lineHeight: 1.5, marginBottom: '20px' }}>
              Your order has been verified with PhonePe and is now <strong>PREPARING</strong> in the kitchen! 🍳
            </p>

            <div
              style={{
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: '10px',
                padding: '12px',
                marginBottom: '20px',
                fontSize: '0.78rem',
                color: '#94a3b8',
                textAlign: 'left',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Order ID:</span>
                <span style={{ color: '#fff', fontWeight: 700 }}>{orderId.slice(0, 8).toUpperCase()}</span>
              </div>
              {merchantTransactionId && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>PhonePe Ref:</span>
                  <span style={{ color: '#fbbf24', fontFamily: 'monospace' }}>
                    {merchantTransactionId.slice(0, 16)}...
                  </span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Status:</span>
                <span style={{ color: '#34d399', fontWeight: 700 }}>PAID · PREPARING</span>
              </div>
            </div>

            <button
              onClick={() => router.push(`/?payment_success=true&order_id=${encodeURIComponent(orderId)}`)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '10px',
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: '#000',
                fontWeight: 800,
                fontSize: '0.95rem',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 15px rgba(245, 158, 11, 0.35)',
              }}
            >
              Track Dishes Cooking (Preparing) 🍳
            </button>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: '3rem', marginBottom: '14px' }}>⚠️</div>
            <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#f59e0b', marginBottom: '8px' }}>
              Payment Cancelled or Pending
            </h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', lineHeight: 1.5, marginBottom: '20px' }}>
              {errorMessage ||
                'The payment was not completed or the session expired. Don’t worry — your cart items are completely safe!'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                onClick={handleManualRecheck}
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '0.92rem',
                  border: 'none',
                  cursor: 'pointer',
                  boxShadow: '0 4px 15px rgba(16, 185, 129, 0.35)',
                }}
              >
                🔄 Re-check Payment Status Now
              </button>
              <button
                onClick={() => router.push('/?payment_cancelled=true')}
                style={{
                  width: '100%',
                  padding: '11px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  fontSize: '0.84rem',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  cursor: 'pointer',
                }}
              >
                🛒 Return to Cart &amp; Retry Payment
              </button>
            </div>
          </div>
        )}
      </div>
      <style jsx global>{`
        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}

export default function PhonePeReturnPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0a0d14' }} />}>
      <PhonePeReturnContent />
    </Suspense>
  );
}

