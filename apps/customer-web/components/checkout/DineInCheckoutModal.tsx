'use client';

import React, { useEffect, useCallback } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { customerApiFetch } from '../../app/lib/guest-session';

export interface DineInCheckoutModalProps {
  onPaymentSuccess?: (paymentId: string, totalPaise: number) => void;
  onPaymentInitiate?: () => Promise<void> | void;
  onPostponePayment?: () => void;
  showToast?: (msg: string) => void;
}

/**
 * Reusable Bill Breakdown component for Dine-in orders.
 * Strictly calculates totals in integer minor units (paise).
 */
export function DineInBillBreakdown({ style }: { style?: React.CSSProperties }) {
  const cartSubtotalPaise = useOrderStore((s) => s.getCartSubtotalPaise());
  const discountPaise = useOrderStore((s) => s.getDiscountPaise());
  const appliedCoupon = useOrderStore((s) => s.appliedCoupon);
  const gstPaise = useOrderStore((s) => s.getGstPaise());
  const cartGrandTotalPaise = useOrderStore((s) => s.getCartGrandTotalPaise());

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderTop: '1px dashed rgba(255,255,255,0.12)',
        paddingTop: '12px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        fontSize: '0.84rem',
        color: '#94a3b8',
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Item Total</span>
        <span style={{ color: '#fff' }}>₹{(cartSubtotalPaise / 100).toFixed(0)}</span>
      </div>
      {discountPaise > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#10b981' }}>
          <span>Discount ({appliedCoupon})</span>
          <span>-₹{(discountPaise / 100).toFixed(0)}</span>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>GST (5%)</span>
        <span style={{ color: '#fff' }}>₹{(gstPaise / 100).toFixed(0)}</span>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '1.05rem',
          fontWeight: 800,
          color: '#fbbf24',
          borderTop: '1px solid rgba(255,255,255,0.1)',
          paddingTop: '8px',
          marginTop: '4px',
        }}
      >
        <span>To Pay</span>
        <span>₹{(cartGrandTotalPaise / 100).toFixed(0)}</span>
      </div>
    </div>
  );
}

export function DineInCheckoutModal({
  onPaymentSuccess,
  onPaymentInitiate,
  onPostponePayment,
  showToast = (msg: string) => console.log(msg),
}: DineInCheckoutModalProps) {
  // ── Sourced strictly from Zustand Global Store ──
  const isPaymentModalOpen = useOrderStore((s) => s.isPaymentModalOpen);
  const setIsPaymentModalOpen = useOrderStore((s) => s.setIsPaymentModalOpen);
  const selectedPaymentMethod = useOrderStore((s) => s.selectedPaymentMethod);
  const setSelectedPaymentMethod = useOrderStore((s) => s.setSelectedPaymentMethod);
  const paymentLoading = useOrderStore((s) => s.paymentLoading);
  const setPaymentLoading = useOrderStore((s) => s.setPaymentLoading);
  const paymentQrData = useOrderStore((s) => s.paymentQrData);
  const setPaymentQrData = useOrderStore((s) => s.setPaymentQrData);
  const paymentSuccessData = useOrderStore((s) => s.paymentSuccessData);
  const setPaymentSuccessData = useOrderStore((s) => s.setPaymentSuccessData);
  const resetCheckoutState = useOrderStore((s) => s.resetCheckoutState);
  const setIsCartOpen = useOrderStore((s) => s.setIsCartOpen);
  const clearCart = useOrderStore((s) => s.clearCart);

  const cartLines = useOrderStore((s) => s.cartLines);
  const selectedTable = useOrderStore((s) => s.selectedTable);
  const activeSessionId = useOrderStore((s) => s.activeSessionId);
  const cartGrandTotalPaise = useOrderStore((s) => s.getCartGrandTotalPaise());

  // Reset checkout state if user opens checkout with active cart items
  useEffect(() => {
    if (cartLines.length > 0 && paymentSuccessData) {
      setPaymentSuccessData(null);
    }
  }, [cartLines.length, paymentSuccessData, setPaymentSuccessData]);

  // Clean unmount reset
  useEffect(() => {
    return () => {
      // Clear transient payment states on unmount
      if (paymentSuccessData) {
        setPaymentSuccessData(null);
      }
    };
  }, [paymentSuccessData, setPaymentSuccessData]);

  const orderType = useOrderStore((s) => s.orderType);
  const scheduledFor = useOrderStore((s) => s.scheduledFor);
  const guestCount = useOrderStore((s) => s.guestCount);
  const allocatedTableNumbers = useOrderStore((s) => s.allocatedTableNumbers);

  // Confirm UPI / PhonePe Payment
  const handleConfirmUpiPayment = useCallback(async () => {
    if (!paymentQrData) return;
    setPaymentLoading(true);
    try {
      const paymentId = paymentQrData.paymentId;
      const totalPaise = cartGrandTotalPaise;

      setPaymentSuccessData({
        paymentId,
        totalPaise,
      });

      clearCart();
      setIsCartOpen(false);
      setPaymentQrData(null);
      setIsPaymentModalOpen(false);

      if (onPaymentSuccess) {
        onPaymentSuccess(paymentId, totalPaise);
      } else {
        showToast('Payment confirmed via PhonePe! Kitchen is preparing your dishes 🍳');
      }
    } catch (err) {
      console.error('Payment confirmation error:', err);
    } finally {
      setPaymentLoading(false);
    }
  }, [
    paymentQrData,
    cartGrandTotalPaise,
    clearCart,
    setIsCartOpen,
    setPaymentQrData,
    setIsPaymentModalOpen,
    setPaymentSuccessData,
    setPaymentLoading,
    onPaymentSuccess,
    showToast,
  ]);

  // PhonePe Webhook / Status Polling Listener
  useEffect(() => {
    if (!isPaymentModalOpen || !paymentQrData?.paymentId || paymentLoading) return;
    const paymentId = paymentQrData.paymentId;
    if (paymentId.startsWith('pay_')) return;

    let isSubscribed = true;
    const checkPaymentOnce = async () => {
      try {
        const vRes = await customerApiFetch(
          `/api/v1/customer/payments/${encodeURIComponent(paymentId)}/verify`,
          undefined,
          { preferToken: 'guest' },
        );
        if (vRes.ok && isSubscribed) {
          const vData = await vRes.json();
          if (vData.status === 'PAID') {
            clearInterval(pollInterval);
            await handleConfirmUpiPayment();
          }
        }
      } catch {}
    };

    const pollInterval = setInterval(() => void checkPaymentOnce(), 2500);
    const onFocusOrVisible = () => {
      if (document.visibilityState === 'visible') {
        void checkPaymentOnce();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    document.addEventListener('visibilitychange', onFocusOrVisible);

    return () => {
      isSubscribed = false;
      clearInterval(pollInterval);
      window.removeEventListener('focus', onFocusOrVisible);
      document.removeEventListener('visibilitychange', onFocusOrVisible);
    };
  }, [isPaymentModalOpen, paymentQrData?.paymentId, paymentLoading, handleConfirmUpiPayment]);

  if (!isPaymentModalOpen) return null;

  const handleClose = () => {
    setIsPaymentModalOpen(false);
    setPaymentSuccessData(null);
    if (cartLines.length > 0) {
      setIsCartOpen(true);
      if (onPostponePayment) {
        onPostponePayment();
      } else {
        showToast('Payment not completed — your order was NOT sent to the kitchen. Items remain saved in your cart.');
      }
    }
  };

  const handleVerifyPhonePeManual = async () => {
    if (!paymentQrData?.paymentId) return;
    setPaymentLoading(true);
    try {
      const vRes = await customerApiFetch(
        `/api/v1/customer/payments/${encodeURIComponent(paymentQrData.paymentId)}/verify`,
        undefined,
        { preferToken: 'guest' },
      );
      if (vRes.ok) {
        const vData = await vRes.json();
        if (vData.status === 'PAID') {
          await handleConfirmUpiPayment();
          return;
        } else {
          showToast(`Payment status is ${vData.status || 'PENDING'}. Please complete payment on PhonePe.`);
          return;
        }
      } else {
        showToast('Could not verify status yet. Your cart items are completely safe!');
      }
    } catch {
      showToast('Status check pending. If cancelled, your cart is preserved.');
    } finally {
      setPaymentLoading(false);
    }
  };

  return (
    <div className="filter-sheet-overlay" onClick={handleClose}>
      <div className="modal-center-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <div>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#fff', margin: 0 }}>
              {orderType === 'TAKEAWAY'
                ? 'Takeaway Checkout'
                : orderType === 'PRE_BOOK_DINE_IN'
                ? 'Pre-Booked Table Checkout'
                : 'Settle Table Bill'}
            </h3>
            <span style={{ fontSize: '0.78rem', color: '#94a3b8' }}>
              {orderType === 'TAKEAWAY'
                ? scheduledFor
                  ? `Pickup: ${new Date(scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                  : 'Pickup: ASAP (~25 mins)'
                : orderType === 'PRE_BOOK_DINE_IN'
                ? `Table ${allocatedTableNumbers.length > 0 ? allocatedTableNumbers.join('+') : selectedTable} · ${guestCount} Guests`
                : `Table ${selectedTable} · Live Dine-In`}
            </span>
          </div>
          <button
            onClick={handleClose}
            style={{ color: '#94a3b8', fontSize: '1.1rem', background: 'none', border: 'none', cursor: 'pointer' }}
            aria-label="Close payment modal"
          >
            ✕
          </button>
        </div>

        {/* Omnichannel Mode Reminder */}
        {orderType === 'PRE_BOOK_DINE_IN' && (
          <div
            style={{
              background: 'rgba(251, 191, 36, 0.1)',
              border: '1px solid rgba(251, 191, 36, 0.3)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '0.78rem',
              color: '#fbbf24',
              fontWeight: 700,
              marginBottom: '12px',
            }}
          >
            📅 Pre-Booked Dining: Table {allocatedTableNumbers.length > 0 ? allocatedTableNumbers.join('+') : selectedTable} ({guestCount} Guests)
          </div>
        )}
        {orderType === 'TAKEAWAY' && (
          <div
            style={{
              background: 'rgba(56, 189, 248, 0.1)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              borderRadius: '8px',
              padding: '8px 12px',
              fontSize: '0.78rem',
              color: '#38bdf8',
              fontWeight: 700,
              marginBottom: '12px',
            }}
          >
            🛍️ Takeaway Counter Pickup {scheduledFor ? `· ${new Date(scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '· ASAP (~25 mins)'}
          </div>
        )}

        {/* ── View 1: Payment Completed Successfully ── */}
        {paymentSuccessData ? (
          <div style={{ textAlign: 'center', padding: '20px 10px' }}>
            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>✅</div>
            <h3 style={{ color: '#10b981', marginBottom: '6px' }}>Payment Complete!</h3>
            <p style={{ fontSize: '0.85rem', color: '#94a3b8', marginBottom: '16px' }}>
              Bill of ₹{(paymentSuccessData.totalPaise / 100).toFixed(0)} paid. Receipt sent. Thank you!
            </p>
            <button
              className="filter-apply-btn"
              onClick={() => {
                setPaymentSuccessData(null);
                setIsPaymentModalOpen(false);
              }}
              style={{ width: '100%' }}
            >
              Done
            </button>
          </div>
        ) : paymentQrData ? (
          /* ── View 2: Active PhonePe Gateway Session (Redirect / QR) ── */
          <div style={{ textAlign: 'center', padding: '10px' }}>
            {paymentQrData.redirectUrl ? (
              <div style={{ marginBottom: '16px' }}>
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(95, 37, 159, 0.25)',
                    border: '1px solid rgba(147, 51, 234, 0.45)',
                    padding: '4px 12px',
                    borderRadius: '999px',
                    color: '#c084fc',
                    fontSize: '0.78rem',
                    fontWeight: 800,
                    marginBottom: '12px',
                  }}
                >
                  <span>⚡</span>
                  <span>PhonePe Sandbox (UAT) Gateway</span>
                </div>
                <p style={{ fontSize: '0.84rem', color: '#e2e8f0', lineHeight: 1.4, marginBottom: '14px' }}>
                  Click below to open the official PhonePe Sandbox checkout link and complete test payment:
                </p>
                <a
                  href={paymentQrData.redirectUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hero-action-btn"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    width: '100%',
                    padding: '12px 16px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%)',
                    color: '#fff',
                    fontWeight: 800,
                    fontSize: '0.92rem',
                    textDecoration: 'none',
                    boxShadow: '0 4px 16px rgba(124, 58, 237, 0.4)',
                    marginBottom: '10px',
                  }}
                >
                  <span>🚀 Open PhonePe Checkout ↗</span>
                </a>
              </div>
            ) : (
              <div style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '12px' }}>
                Scan UPI QR using Google Pay, PhonePe, or Paytm
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button
                className="accordion-add-action-btn"
                onClick={handleVerifyPhonePeManual}
                disabled={paymentLoading}
                style={{ width: '100%' }}
              >
                {paymentLoading ? 'Verifying with PhonePe...' : '✓ Verify PhonePe Payment'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsPaymentModalOpen(false);
                  setIsCartOpen(true);
                  showToast('Payment cancelled. All items remain in your cart — tap below to retry!');
                }}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  color: '#94a3b8',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✕ Cancel & Return to Cart
              </button>
            </div>
          </div>
        ) : (
          /* ── View 3: Payment Method Selection & Bill Summary ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Integrated Bill Breakdown */}
            <DineInBillBreakdown style={{ marginBottom: '8px' }} />

            <div
              className={`payment-option-card ${selectedPaymentMethod === 'UPI' ? 'selected' : ''}`}
              onClick={() => setSelectedPaymentMethod('UPI')}
            >
              <span style={{ fontSize: '1.4rem' }}>📱</span>
              <div>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>Instant UPI QR</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>GPay, PhonePe, Paytm, BHIM</div>
              </div>
            </div>

            <div
              className={`payment-option-card ${selectedPaymentMethod === 'CASH' ? 'selected' : ''}`}
              onClick={() => setSelectedPaymentMethod('CASH')}
            >
              <span style={{ fontSize: '1.4rem' }}>💵</span>
              <div>
                <div style={{ fontWeight: 700, color: '#fff', fontSize: '0.9rem' }}>Pay Cash at Counter</div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Staff will collect cash at table</div>
              </div>
            </div>

            <button
              className="accordion-add-action-btn"
              onClick={async () => {
                if (onPaymentInitiate) {
                  await onPaymentInitiate();
                } else {
                  showToast('Initiating payment gateway...');
                }
              }}
              disabled={paymentLoading}
              style={{ width: '100%', marginTop: '8px' }}
            >
              {paymentLoading ? 'Processing...' : 'Proceed to Pay'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default DineInCheckoutModal;
