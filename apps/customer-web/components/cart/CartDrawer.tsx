'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { useOrderStore, computeCouponDiscountPaise } from '../../store/useOrderStore';
import { DineInBillBreakdown } from '../checkout/DineInCheckoutModal';
import {
  sanitizeTableDigits,
  matchHotelTable,
  openManualTableSession,
  resolveTenantIds,
  loadCustomerAuth,
  customerApiFetch,
  loadGuestSession,
  type OutletTableInfo,
} from '../../app/lib/guest-session';
import { getLiveTableValidation as validateLiveTable } from '../modals/TableModal';

export interface CartDrawerProps {
  onPlaceOrder?: () => Promise<void> | void;
  isPlacingOrder?: boolean;
  onViewOrders?: () => void;
  flattenedPlatesCount?: number;
  onBrowseMenu?: () => void;
  onOpenAvailableCoupons?: () => void;
  outletTables?: OutletTableInfo[];
  outletTablesLoaded?: boolean;
  showToast?: (msg: string) => void;
  onApplyCoupon?: (code: string) => Promise<void> | void;
}

export function CartDrawer({
  onPlaceOrder,
  isPlacingOrder = false,
  onViewOrders,
  flattenedPlatesCount = 0,
  onBrowseMenu,
  onOpenAvailableCoupons,
  outletTables = [],
  outletTablesLoaded = true,
  showToast = (msg: string) => console.log(msg),
  onApplyCoupon,
}: CartDrawerProps) {
  // ── Sourced strictly from Zustand Global Store ──
  const isCartOpen = useOrderStore((s) => s.isCartOpen);
  const setIsCartOpen = useOrderStore((s) => s.setIsCartOpen);
  const cartLines = useOrderStore((s) => s.cartLines);
  const selectedTable = useOrderStore((s) => s.selectedTable);
  const tablePax = useOrderStore((s) => s.tablePax);
  const activeSessionId = useOrderStore((s) => s.activeSessionId);
  const activeOutletId = useOrderStore((s) => s.activeOutletId);
  const isTableVerified = useOrderStore((s) => s.isTableVerified);
  const setSelectedTable = useOrderStore((s) => s.setSelectedTable);
  const appliedCoupon = useOrderStore((s) => s.appliedCoupon);
  const setAppliedCoupon = useOrderStore((s) => s.setAppliedCoupon);
  const coupons = useOrderStore((s) => s.coupons);
  const cartSubtotalPaise = useOrderStore((s) => s.getCartSubtotalPaise());
  const discountPaise = useOrderStore((s) => s.getDiscountPaise());
  const cartGrandTotalPaise = useOrderStore((s) => s.getCartGrandTotalPaise());

  const orderType = useOrderStore((s) => s.orderType);
  const scheduledFor = useOrderStore((s) => s.scheduledFor);
  const guestCount = useOrderStore((s) => s.guestCount);
  const allocatedTableNumbers = useOrderStore((s) => s.allocatedTableNumbers);
  const setIsBookingModalOpen = useOrderStore((s) => s.setIsBookingModalOpen);

  const incrementCartLine = useOrderStore((s) => s.incrementCartLine);
  const decrementCartLine = useOrderStore((s) => s.decrementCartLine);
  const removeCartLine = useOrderStore((s) => s.removeCartLine);
  const assignCartLineTable = useOrderStore((s) => s.assignCartLineTable);

  // ── Local Component UI State ──
  const [couponInput, setCouponInput] = useState('');
  const [couponError, setCouponError] = useState<string | null>(null);
  const [cartPlateEditingId, setCartPlateEditingId] = useState<string | null>(null);
  const [cartPlateDigits, setCartPlateDigits] = useState('');
  const [cartCheckoutTableDigits, setCartCheckoutTableDigits] = useState('');

  // ── Live Table Matching Validations ──
  const getLiveTableValidation = useCallback(
    (digits: string): { matched: OutletTableInfo | null; error: string } => {
      return validateLiveTable(
        digits,
        outletTables,
        outletTablesLoaded,
        activeOutletId,
      );
    },
    [activeOutletId, outletTables, outletTablesLoaded],
  );

  const cartPlateValidation = useMemo(
    () => getLiveTableValidation(cartPlateDigits),
    [cartPlateDigits, getLiveTableValidation],
  );

  const cartCheckoutTableValidation = useMemo(
    () => getLiveTableValidation(cartCheckoutTableDigits),
    [cartCheckoutTableDigits, getLiveTableValidation],
  );

  if (!isCartOpen) return null;

  // ── Coupon Application Handler ──
  const handleApplyCoupon = async (code: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      setCouponError('Please enter a coupon code.');
      return;
    }
    if (onApplyCoupon) {
      await onApplyCoupon(trimmed);
      return;
    }
    const custAuth = loadCustomerAuth();
    if (!custAuth?.accessToken) {
      useOrderStore.getState().setPendingCouponCode(trimmed);
      useOrderStore.getState().setIsAuthModalOpen(true);
      setCouponError(`Log in or sign up to apply coupon ${trimmed}`);
      showToast(`Log in or sign up to apply coupon ${trimmed}`);
      return;
    }
    try {
      const effOrg = resolveTenantIds(loadGuestSession()).orgId;
      const res = await customerApiFetch(
        '/api/v1/customer/coupons/apply',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            code: trimmed,
            subtotalPaise: cartSubtotalPaise,
            outletId: activeOutletId || '88888888-8888-4888-8888-888888888888',
          }),
        },
        { preferToken: 'customer', tokenOverride: custAuth.accessToken, orgIdOverride: effOrg },
      );
      if (res.status === 401) {
        useOrderStore.getState().setPendingCouponCode(trimmed);
        useOrderStore.getState().setIsAuthModalOpen(true);
        setCouponError(`Log in or sign up to apply coupon ${trimmed}`);
        showToast(`Log in or sign up to apply coupon ${trimmed}`);
        return;
      }
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setCouponError(data.reason || data.detail || `Coupon "${trimmed}" is not valid.`);
        setAppliedCoupon(null);
        return;
      }
      setCouponError(null);
      setAppliedCoupon(trimmed);
      useOrderStore.getState().setAppliedCouponDiscountPaise(data.discountPaise);
      showToast(`Coupon ${trimmed} applied! Saved ₹${Math.round(data.discountPaise / 100)} 🎉`);
    } catch {
      setCouponError('Error applying coupon. Check network connection.');
    }
  };

  return (
    <div className="side-drawer-wrap" onClick={() => setIsCartOpen(false)}>
      <div className="side-drawer-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.2rem' }}>🛒</span>
            <span className="drawer-title">
              {orderType === 'TAKEAWAY'
                ? 'Takeaway Cart'
                : orderType === 'PRE_BOOK_DINE_IN'
                ? `Pre-Order Cart (Table ${allocatedTableNumbers.length > 0 ? allocatedTableNumbers.join('+') : selectedTable})`
                : `Table ${selectedTable} Cart`}
            </span>
          </div>
          <button
            onClick={() => setIsCartOpen(false)}
            style={{ color: '#94a3b8', fontSize: '1.2rem', background: 'none', border: 'none', cursor: 'pointer' }}
            aria-label="Close cart drawer"
          >
            ✕
          </button>
        </div>

        {/* Omnichannel Booking / Schedule Banner */}
        {orderType === 'PRE_BOOK_DINE_IN' && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.12), rgba(217, 119, 6, 0.15))',
              border: '1px solid rgba(251, 191, 36, 0.35)',
              borderRadius: '10px',
              padding: '10px 14px',
              margin: '12px 16px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem' }}>📅</span>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#fbbf24' }}>
                  Pre-Booked: Table {allocatedTableNumbers.length > 0 ? allocatedTableNumbers.join('+') : selectedTable} ({guestCount} Guests)
                </div>
                <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>
                  {scheduledFor
                    ? `Arrival: ${new Date(scheduledFor).toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${new Date(scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Scheduled Dining'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsBookingModalOpen(true)}
              style={{
                background: 'rgba(251, 191, 36, 0.2)',
                border: '1px solid rgba(251, 191, 36, 0.5)',
                color: '#fbbf24',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.70rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Change
            </button>
          </div>
        )}

        {orderType === 'TAKEAWAY' && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.12), rgba(2, 132, 199, 0.15))',
              border: '1px solid rgba(56, 189, 248, 0.35)',
              borderRadius: '10px',
              padding: '10px 14px',
              margin: '12px 16px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.3rem' }}>🛍️</span>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#38bdf8' }}>
                  Takeaway Order (Counter Pickup)
                </div>
                <div style={{ fontSize: '0.72rem', color: '#cbd5e1' }}>
                  {scheduledFor
                    ? `Ready by: ${new Date(scheduledFor).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Preparation: ASAP (~25 mins)'}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsBookingModalOpen(true)}
              style={{
                background: 'rgba(56, 189, 248, 0.2)',
                border: '1px solid rgba(56, 189, 248, 0.5)',
                color: '#38bdf8',
                borderRadius: '6px',
                padding: '4px 8px',
                fontSize: '0.70rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Change
            </button>
          </div>
        )}

        {/* Quick Link to Table Orders if dishes are already placed */}
        {flattenedPlatesCount > 0 && (
          <div
            style={{
              background: 'linear-gradient(135deg, rgba(16,185,129,0.12), rgba(5,150,105,0.2))',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: '10px',
              padding: '10px 14px',
              margin: '12px 16px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.2rem' }}>📋</span>
              <div>
                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#34d399' }}>
                  {flattenedPlatesCount} {flattenedPlatesCount === 1 ? 'item' : 'items'} ordered for Table {selectedTable}
                </div>
                <div style={{ fontSize: '0.70rem', color: '#94a3b8' }}>
                  Cooking, served &amp; course status
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsCartOpen(false);
                onViewOrders?.();
              }}
              style={{
                background: '#10b981',
                color: '#000',
                border: 'none',
                borderRadius: '6px',
                padding: '6px 10px',
                fontSize: '0.74rem',
                fontWeight: 800,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              View Orders →
            </button>
          </div>
        )}

        <div className="drawer-body">
          {cartLines.length === 0 ? (
            /* ── Empty Cart State ── */
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '3rem', marginBottom: '14px' }}>🍽️</div>
              <h4 style={{ color: '#fff', marginBottom: '6px' }}>Your cart is empty</h4>
              <p style={{ fontSize: '0.85rem', marginBottom: '20px' }}>
                Browse our chef specialties or choose from the menu!
              </p>
              <button
                className="hero-action-btn"
                onClick={() => {
                  setIsCartOpen(false);
                  onBrowseMenu?.();
                }}
              >
                Browse Full Menu →
              </button>
              {flattenedPlatesCount > 0 && (
                <div style={{ marginTop: '14px' }}>
                  <button
                    onClick={() => {
                      setIsCartOpen(false);
                      onViewOrders?.();
                    }}
                    style={{
                      background: 'rgba(16,185,129,0.15)',
                      border: '1px solid rgba(16,185,129,0.4)',
                      color: '#34d399',
                      borderRadius: '8px',
                      padding: '10px 18px',
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>📋</span>
                    <span>View Table Orders ({flattenedPlatesCount})</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            /* ── Populated Cart List ── */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {cartLines.map((line) => {
                const modsTotal = line.selectedModifiers.reduce((acc, m) => acc + m.pricePaise, 0);
                const linePricePaise = (line.item.pricePaise + modsTotal) * line.quantity;

                return (
                  <div
                    key={line.cartLineId}
                    style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '12px',
                      padding: '12px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div style={{ flex: 1, marginRight: '10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span>{line.item.dietaryTag === 'VEG' ? '🟢' : '🔴'}</span>
                          <span style={{ fontWeight: 700, color: '#fff', fontSize: '0.92rem' }}>
                            {line.item.name}
                          </span>
                          {line.portion === 'HALF' && (
                            <span
                              style={{
                                fontSize: '0.66rem',
                                fontWeight: 800,
                                padding: '1px 6px',
                                borderRadius: '4px',
                                background: 'rgba(245, 158, 11, 0.2)',
                                color: '#fbbf24',
                                border: '1px solid rgba(245, 158, 11, 0.4)',
                                letterSpacing: '0.04em',
                              }}
                            >
                              HALF PLATE
                            </span>
                          )}
                          {line.plateLabel && <span className="plate-badge-pill">{line.plateLabel}</span>}
                          <button
                            type="button"
                            onClick={() => {
                              if (cartPlateEditingId === line.cartLineId) {
                                setCartPlateEditingId(null);
                                setCartPlateDigits('');
                              } else {
                                setCartPlateEditingId(line.cartLineId);
                                setCartPlateDigits(
                                  sanitizeTableDigits(line.targetTableNumber || (selectedTable !== '--' ? selectedTable : '')),
                                );
                              }
                            }}
                            style={{
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: '999px',
                              background: line.targetTableNumber
                                ? 'rgba(16, 185, 129, 0.16)'
                                : 'rgba(255, 255, 255, 0.08)',
                              border: line.targetTableNumber
                                ? '1px solid rgba(16, 185, 129, 0.45)'
                                : '1px solid rgba(255, 255, 255, 0.16)',
                              color: line.targetTableNumber ? '#34d399' : '#cbd5e1',
                              cursor: 'pointer',
                            }}
                            title="Change table number for this plate before checkout"
                          >
                            🪑 Table {line.targetTableNumber || (selectedTable !== '--' ? selectedTable : 'Select')} ✎
                          </button>
                        </div>
                        <div style={{ fontSize: '0.85rem', color: '#fbbf24', fontWeight: 700, marginTop: '2px' }}>
                          ₹{(linePricePaise / 100).toFixed(0)}
                        </div>
                      </div>

                      {/* Quantity Stepper & Remove Action */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div className="menu-stepper-wrap" style={{ margin: 0 }}>
                          <button
                            type="button"
                            onClick={() => decrementCartLine(line.cartLineId)}
                            aria-label={`Decrease quantity of ${line.item.name}`}
                          >
                            −
                          </button>
                          <span>{line.quantity}</span>
                          <button
                            type="button"
                            onClick={() => incrementCartLine(line.cartLineId)}
                            aria-label={`Increase quantity of ${line.item.name}`}
                          >
                            +
                          </button>
                        </div>

                        <button
                          onClick={() => removeCartLine(line.cartLineId)}
                          style={{ color: '#ef4444', fontSize: '0.8rem', padding: '4px', background: 'none', border: 'none', cursor: 'pointer' }}
                          title="Remove line"
                          aria-label={`Remove ${line.item.name} from cart`}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>

                    {/* Per-Plate Table Switcher Panel */}
                    {cartPlateEditingId === line.cartLineId && (
                      <div
                        style={{
                          background: 'rgba(15, 23, 42, 0.9)',
                          border: '1px solid rgba(245, 158, 11, 0.35)',
                          borderRadius: '8px',
                          padding: '8px 10px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '6px',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="Table #"
                            value={cartPlateDigits}
                            onChange={(e) => setCartPlateDigits(sanitizeTableDigits(e.target.value))}
                            style={{
                              width: '90px',
                              padding: '5px 8px',
                              borderRadius: '6px',
                              background: 'rgba(255,255,255,0.08)',
                              border: '1px solid rgba(255,255,255,0.18)',
                              color: '#fff',
                              fontSize: '0.82rem',
                              fontWeight: 700,
                            }}
                          />
                          <button
                            type="button"
                            disabled={!cartPlateValidation.matched}
                            onClick={() => {
                              if (cartPlateValidation.matched) {
                                assignCartLineTable(
                                  line.cartLineId,
                                  cartPlateValidation.matched.table_number,
                                  cartPlateValidation.matched.id,
                                );
                                setCartPlateEditingId(null);
                                setCartPlateDigits('');
                                showToast(`Assigned plate to Table ${cartPlateValidation.matched.table_number} ✓`);
                              }
                            }}
                            style={{
                              padding: '5px 10px',
                              borderRadius: '6px',
                              border: 'none',
                              background: cartPlateValidation.matched
                                ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                : 'rgba(255,255,255,0.08)',
                              color: cartPlateValidation.matched ? '#000' : '#64748b',
                              fontSize: '0.74rem',
                              fontWeight: 800,
                              cursor: cartPlateValidation.matched ? 'pointer' : 'not-allowed',
                            }}
                          >
                            {line.quantity > 1 ? 'Move 1 Plate' : 'Save Table'}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setCartPlateEditingId(null);
                              setCartPlateDigits('');
                            }}
                            style={{
                              padding: '5px 8px',
                              borderRadius: '6px',
                              background: 'transparent',
                              border: '1px solid rgba(255,255,255,0.14)',
                              color: '#94a3b8',
                              fontSize: '0.72rem',
                              cursor: 'pointer',
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                        {cartPlateValidation.error && (
                          <div style={{ fontSize: '0.72rem', color: '#f87171', fontWeight: 600 }}>
                            {cartPlateValidation.error}
                          </div>
                        )}
                        {cartPlateValidation.matched && (
                          <div style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 600 }}>
                            ✓ Table {cartPlateValidation.matched.table_number} matched
                          </div>
                        )}
                      </div>
                    )}

                    {/* Modifiers & Notes Badges */}
                    {(line.spiceLevel || line.notes || line.selectedModifiers.length > 0) && (
                      <div
                        style={{
                          background: 'rgba(0,0,0,0.25)',
                          padding: '6px 8px',
                          borderRadius: '6px',
                          fontSize: '0.74rem',
                          color: '#cbd5e1',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                        }}
                      >
                        {line.spiceLevel && <span>🌶️ Spice: {line.spiceLevel}</span>}
                        {line.notes && <span>📝 Note: {line.notes}</span>}
                        {line.selectedModifiers.map((m) => (
                          <span key={m.id} style={{ color: m.pricePaise > 0 ? '#fbbf24' : '#94a3b8' }}>
                            + {m.name} {m.pricePaise > 0 ? `(+₹${(m.pricePaise / 100).toFixed(0)})` : '(Included)'}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Apply Coupon Section */}
              <div style={{ marginTop: '10px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#94a3b8' }}>
                    Have a coupon?
                  </span>
                  <button
                    type="button"
                    onClick={onOpenAvailableCoupons}
                    style={{
                      background: 'rgba(245, 158, 11, 0.12)',
                      border: '1px solid rgba(245, 158, 11, 0.35)',
                      color: '#fbbf24',
                      padding: '3px 9px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <span>🏷️</span>
                    <span>Available Coupons</span>
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    placeholder="Enter coupon code"
                    value={couponInput}
                    onChange={(e) => {
                      setCouponInput(e.target.value.toUpperCase());
                      if (couponError) setCouponError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleApplyCoupon(couponInput);
                      }
                    }}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      background: 'rgba(255,255,255,0.05)',
                      border: couponError
                        ? '1px solid #ef4444'
                        : appliedCoupon
                        ? '1px solid #10b981'
                        : '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '8px',
                      color: '#fff',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                      outline: 'none',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => handleApplyCoupon(couponInput)}
                    style={{
                      background: 'rgba(245,158,11,0.2)',
                      border: '1px solid var(--accent-gold)',
                      color: '#fbbf24',
                      padding: '0 14px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                    }}
                  >
                    Apply
                  </button>
                </div>

                {couponError && (
                  <div
                    style={{
                      fontSize: '0.74rem',
                      color: '#f87171',
                      marginTop: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontWeight: 600,
                    }}
                  >
                    <span>⚠️</span>
                    <span>{couponError}</span>
                  </div>
                )}

                {appliedCoupon && !couponError && (
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: '#10b981',
                      marginTop: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontWeight: 700,
                    }}
                  >
                    <span>✓ Applied: {appliedCoupon} (-₹{(discountPaise / 100).toFixed(0)})</span>
                    <button
                      type="button"
                      onClick={() => {
                        setAppliedCoupon(null);
                        setCouponInput('');
                        setCouponError(null);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#f87171',
                        fontSize: '0.72rem',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        padding: '0 4px',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>

              {/* Reusable Extracted Bill Breakdown */}
              <DineInBillBreakdown />
            </div>
          )}
        </div>

        {/* ── Footer with Checkout Action ── */}
        {cartLines.length > 0 && (() => {
          const isTakeaway = orderType === 'TAKEAWAY';
          const isPreBook = orderType === 'PRE_BOOK_DINE_IN';
          const tableRequired = !isTakeaway && (!isTableVerified || !activeSessionId) && (!isPreBook || allocatedTableNumbers.length === 0);

          return (
            <div className="drawer-footer" style={{ padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}>
              {tableRequired && (
                <div
                  style={{
                    background: 'rgba(245, 158, 11, 0.09)',
                    border: '1px solid rgba(245, 158, 11, 0.35)',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    marginBottom: '12px',
                  }}
                >
                  <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fbbf24', marginBottom: '6px' }}>
                    🪑 Enter Your Table Number to Checkout
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="Digits only (e.g. 4)"
                      value={cartCheckoutTableDigits}
                      onChange={(e) => setCartCheckoutTableDigits(sanitizeTableDigits(e.target.value))}
                      style={{
                        flex: 1,
                        padding: '8px 10px',
                        borderRadius: '8px',
                        background: 'rgba(0, 0, 0, 0.35)',
                        border: cartCheckoutTableValidation.error
                          ? '1px solid #ef4444'
                          : '1px solid rgba(255,255,255,0.18)',
                        color: '#fff',
                        fontSize: '0.86rem',
                        fontWeight: 700,
                      }}
                    />
                    <button
                      type="button"
                      disabled={!cartCheckoutTableValidation.matched}
                      onClick={async () => {
                        const targetOutlet = activeOutletId || resolveTenantIds().outletId || undefined;
                        if (cartCheckoutTableValidation.matched) {
                          const res = await openManualTableSession(
                            targetOutlet,
                            cartCheckoutTableValidation.matched.table_number,
                            tablePax,
                          );
                          if (res.ok) {
                            setSelectedTable(
                              res.session.tableNumber || cartCheckoutTableValidation.matched.table_number,
                              tablePax,
                              res.session.tableId,
                              res.session.sessionId,
                            );
                            setCartCheckoutTableDigits('');
                            showToast(`Saved Table ${res.session.tableNumber || cartCheckoutTableValidation.matched.table_number}!`);
                          } else {
                            showToast(res.error || 'Failed to open table session');
                          }
                        }
                      }}
                      style={{
                        padding: '8px 12px',
                        borderRadius: '8px',
                        border: 'none',
                        background: cartCheckoutTableValidation.matched
                          ? 'linear-gradient(135deg, #10b981, #059669)'
                          : 'rgba(255,255,255,0.08)',
                        color: cartCheckoutTableValidation.matched ? '#fff' : '#64748b',
                        fontWeight: 800,
                        fontSize: '0.76rem',
                        cursor: cartCheckoutTableValidation.matched ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Save Table
                    </button>
                  </div>
                  {cartCheckoutTableValidation.error && (
                    <div style={{ fontSize: '0.73rem', color: '#f87171', fontWeight: 600, marginTop: '5px' }}>
                      {cartCheckoutTableValidation.error}
                    </div>
                  )}
                  {cartCheckoutTableValidation.matched && (
                    <div style={{ fontSize: '0.73rem', color: '#34d399', fontWeight: 600, marginTop: '5px' }}>
                      ✓ Found Table {cartCheckoutTableValidation.matched.table_number}
                    </div>
                  )}
                </div>
              )}

              <button
                className="accordion-add-action-btn"
                onClick={onPlaceOrder}
                disabled={
                  isPlacingOrder ||
                  (tableRequired && !cartCheckoutTableValidation.matched)
                }
                style={{ width: '100%', margin: 0, padding: '12px 16px', fontSize: '0.92rem' }}
              >
                {isPlacingOrder ? 'Initiating Payment...' : `💳 Pay ₹${(cartGrandTotalPaise / 100).toFixed(0)} & Send to Kitchen`}
              </button>
              <div style={{ textAlign: 'center', fontSize: '0.72rem', color: '#94a3b8', marginTop: '6px' }}>
                🔒 Dishes stay in your cart until payment is confirmed.
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default CartDrawer;
