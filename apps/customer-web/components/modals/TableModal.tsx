'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import {
  DEFAULT_DEV_OUTLET_ID,
  DEFAULT_DEV_ORG_ID,
  sanitizeTableDigits,
  resolveTenantIds,
  loadGuestSession,
  clearGuestSession,
  openManualTableSession,
  openSignedTableSession,
  buildSignedQrTokenFromSearch,
  customerApiFetch,
  type OutletTableInfo,
  type GuestSessionState,
} from '../../app/lib/guest-session';
import {
  getLiveTableValidation,
  type TableValidationResult,
} from './table-modal-utils';

export { getLiveTableValidation, type TableValidationResult };

export interface TableModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  onTableConfirmed?: (session: GuestSessionState) => void;
  outletTables?: OutletTableInfo[];
  outletTablesLoaded?: boolean;
  activeOutletId?: string | null;
  onLoadTables?: (outletId?: string, slug?: string) => Promise<unknown> | void;
  showToast?: (message: string) => void;
  activeSlug?: string;
}

export const TableModal: React.FC<TableModalProps> = ({
  isOpen,
  onClose,
  onTableConfirmed,
  outletTables: propOutletTables,
  outletTablesLoaded: propOutletTablesLoaded,
  activeOutletId: propActiveOutletId,
  onLoadTables,
  showToast,
  activeSlug,
}) => {
  const storeIsOpen = useOrderStore((s) => s.isTableModalOpen);
  const storeSetIsOpen = useOrderStore((s) => s.setIsTableModalOpen);
  const selectedTable = useOrderStore((s) => s.selectedTable);
  const setSelectedTable = useOrderStore((s) => s.setSelectedTable);
  const isTableVerified = useOrderStore((s) => s.isTableVerified);
  const setIsTableVerified = useOrderStore((s) => s.setIsTableVerified);
  const tablePax = useOrderStore((s) => s.tablePax);
  const storeActiveOutletId = useOrderStore((s) => s.activeOutletId);
  const storeActiveOrgId = useOrderStore((s) => s.activeOrgId);
  const setSessionDetails = useOrderStore((s) => s.setSessionDetails);

  const activeIsOpen = isOpen !== undefined ? isOpen : storeIsOpen;

  const [isClosing, setIsClosing] = useState(false);
  const [tableNumberInput, setTableNumberInput] = useState('');
  const [manualQrInput, setManualQrInput] = useState('');
  const [tableSubmitLoading, setTableSubmitLoading] = useState(false);

  // ── Mode selection: 'DINE_IN' (instant seating) vs 'PRE_BOOK' (reservation & advance order) ──
  const [modalMode, setModalMode] = useState<'DINE_IN' | 'PRE_BOOK'>('DINE_IN');
  const [preBookGuests, setPreBookGuests] = useState<number>(2);
  const [preBookDate, setPreBookDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().split('T')[0] || '';
  });
  const [preBookTime, setPreBookTime] = useState<string>('19:30');
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityResult, setAvailabilityResult] = useState<{
    available: boolean;
    tables: Array<{ id: string; table_number: string; capacity: number }>;
    total_capacity: number;
    guest_count: number;
    reserved_for: string;
  } | null>(null);
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const effectiveTables = propOutletTables ?? [];
  const effectiveTablesLoaded = propOutletTablesLoaded ?? true;
  const currentOutletId = propActiveOutletId ?? storeActiveOutletId ?? null;

  // Gracefully initialize session & load outlet tables on open/mount
  useEffect(() => {
    if (activeIsOpen) {
      setIsClosing(false);
      setTableNumberInput((prev) => prev || (selectedTable !== '--' ? sanitizeTableDigits(selectedTable) : ''));

      const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
      let effectiveOutlet = currentOutletId;

      if ((!effectiveOutlet || effectiveOutlet === null) && isDev) {
        effectiveOutlet = DEFAULT_DEV_OUTLET_ID;
        setSessionDetails({
          outletId: DEFAULT_DEV_OUTLET_ID,
          orgId: storeActiveOrgId || DEFAULT_DEV_ORG_ID,
        });
      }

      if ((!effectiveTablesLoaded || effectiveTables.length === 0) && onLoadTables) {
        void onLoadTables(effectiveOutlet || undefined, activeSlug);
      }
    }
  }, [
    activeIsOpen,
    activeSlug,
    currentOutletId,
    effectiveTables.length,
    effectiveTablesLoaded,
    onLoadTables,
    selectedTable,
    setSessionDetails,
    storeActiveOrgId,
  ]);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      if (onClose) {
        onClose();
      }
      storeSetIsOpen(false);
      setIsClosing(false);
    }, 280);
  }, [isClosing, onClose, storeSetIsOpen]);

  const onDevFallback = useCallback(
    (devOutletId: string) => {
      setSessionDetails({
        outletId: devOutletId,
        orgId: storeActiveOrgId || DEFAULT_DEV_ORG_ID,
      });
      if (onLoadTables) {
        void onLoadTables(devOutletId, activeSlug);
      }
    },
    [activeSlug, onLoadTables, setSessionDetails, storeActiveOrgId],
  );

  const validation = useMemo(
    () =>
      getLiveTableValidation(
        tableNumberInput,
        effectiveTables,
        effectiveTablesLoaded,
        currentOutletId,
        onDevFallback,
      ),
    [currentOutletId, effectiveTables, effectiveTablesLoaded, onDevFallback, tableNumberInput],
  );

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validation.matched || tableSubmitLoading) return;

    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
    const tenant = resolveTenantIds(loadGuestSession());
    const targetOutlet =
      currentOutletId ||
      tenant.outletId ||
      (isDev ? DEFAULT_DEV_OUTLET_ID : undefined);

    setTableSubmitLoading(true);
    try {
      const res = await openManualTableSession(
        targetOutlet,
        validation.matched.table_number,
        tablePax,
        activeSlug,
      );

      if (!res.ok) {
        showToast?.(res.error);
        return;
      }

      setSessionDetails({
        sessionId: res.session.sessionId,
        tableId: res.session.tableId,
        orgId: res.session.orgId,
        outletId: res.session.outletId,
      });
      setSelectedTable(res.session.tableNumber || validation.matched.table_number);
      setIsTableVerified(true);
      if (onLoadTables) {
        void onLoadTables(res.session.outletId, activeSlug);
      }
      setTableNumberInput('');
      handleClose();
      showToast?.(`Table ${res.session.tableNumber || validation.matched.table_number} confirmed!`);
      onTableConfirmed?.(res.session);
    } finally {
      setTableSubmitLoading(false);
    }
  };

  const handleQrSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = manualQrInput.trim();
    if (!raw) return;

    let parsedToken = raw;
    if (raw.includes('?')) {
      try {
        const url = raw.startsWith('http')
          ? new URL(raw)
          : new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
        const extracted = buildSignedQrTokenFromSearch(url.searchParams);
        if (extracted) parsedToken = extracted;
      } catch {
        // Keep raw string as token
      }
    }

    const res = await openSignedTableSession(parsedToken, tablePax);
    if (!res.ok) {
      setIsTableVerified(false);
      showToast?.(res.error);
      return;
    }

    setSessionDetails({
      sessionId: res.session.sessionId,
      tableId: res.session.tableId,
      orgId: res.session.orgId,
      outletId: res.session.outletId,
    });
    if (res.session.tableNumber) {
      setSelectedTable(res.session.tableNumber);
    }
    setIsTableVerified(true);
    if (onLoadTables) {
      void onLoadTables(res.session.outletId, activeSlug);
    }
    setManualQrInput('');
    handleClose();
    showToast?.(`Verified Table ${res.session.tableNumber || 'session'}!`);
    onTableConfirmed?.(res.session);
  };

  const handleCheckAvailability = async () => {
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
    const tenant = resolveTenantIds(loadGuestSession());
    const targetOutlet =
      currentOutletId ||
      tenant.outletId ||
      (isDev ? DEFAULT_DEV_OUTLET_ID : undefined);

    if (!targetOutlet) {
      setAvailabilityError('Please select or specify an outlet to check reservations.');
      return;
    }

    setAvailabilityLoading(true);
    setAvailabilityError(null);
    setAvailabilityResult(null);
    try {
      const reservedFor = new Date(`${preBookDate}T${preBookTime}:00`).toISOString();
      const res = await customerApiFetch('/api/v1/customer/reservations/check-availability', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          outlet_id: targetOutlet,
          guest_count: preBookGuests,
          reserved_for: reservedFor,
          duration_minutes: 90,
        }),
      });

      if (!res.ok) {
        setAvailabilityError('Failed to check table availability. Please try again.');
        return;
      }

      const data = await res.json();
      setAvailabilityResult(data);
    } catch {
      setAvailabilityError('Network error checking table availability.');
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const handleConfirmPreBooking = async () => {
    if (!availabilityResult || !availabilityResult.available || availabilityResult.tables.length === 0) return;
    const isDev = process.env.NODE_ENV === 'development' || process.env.NODE_ENV !== 'production';
    const tenant = resolveTenantIds(loadGuestSession());
    const targetOutlet =
      currentOutletId ||
      tenant.outletId ||
      (isDev ? DEFAULT_DEV_OUTLET_ID : undefined);

    setTableSubmitLoading(true);
    try {
      const primaryTable = availabilityResult.tables[0];
      const tableNum = primaryTable ? primaryTable.table_number : 'T1';
      const res = await openManualTableSession(
        targetOutlet,
        tableNum,
        preBookGuests,
        activeSlug,
      );

      if (!res.ok) {
        showToast?.(res.error);
        return;
      }

      const reservedForIso = new Date(`${preBookDate}T${preBookTime}:00`).toISOString();

      setSessionDetails({
        sessionId: res.session.sessionId,
        tableId: res.session.tableId,
        orgId: res.session.orgId,
        outletId: res.session.outletId,
      });
      setSelectedTable(res.session.tableNumber || tableNum);
      setIsTableVerified(true);

      // Set reservation & scheduling state in store
      useOrderStore.getState().setOrderType('PRE_BOOK_DINE_IN');
      useOrderStore.getState().setScheduledFor(reservedForIso);
      useOrderStore.getState().setGuestCount(preBookGuests);

      if (onLoadTables) {
        void onLoadTables(res.session.outletId, activeSlug);
      }

      handleClose();
      showToast?.(`Table ${tableNum} pre-booked for ${preBookGuests} guests at ${preBookTime}!`);
      onTableConfirmed?.(res.session);
    } finally {
      setTableSubmitLoading(false);
    }
  };

  const handleClearSession = () => {
    clearGuestSession();
    setIsTableVerified(false);
    setSessionDetails({
      sessionId: '',
      tableId: '',
    });
    setSelectedTable('--');
    setTableNumberInput('');
    useOrderStore.getState().setOrderType('DINE_IN');
    useOrderStore.getState().setScheduledFor(null);
    handleClose();
    showToast?.('Current table session cleared');
  };

  if (!activeIsOpen) return null;

  return (
    <div
      className={`top-table-overlay ${isClosing ? 'closing' : ''}`}
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="table-modal-title"
    >
      <div
        className={`top-table-sheet ${isClosing ? 'closing-to-badge' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
          }}
        >
          <div>
            <h3
              id="table-modal-title"
              style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff', margin: 0 }}
            >
              {modalMode === 'DINE_IN' ? '🪑 Select Your Table Number' : '📅 Pre-Book Table & Schedule'}
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '3px 0 0' }}>
              {modalMode === 'DINE_IN'
                ? isTableVerified
                  ? `Currently seated at Table ${selectedTable}. Type a new table number below or tap outside to close.`
                  : 'Enter the numeric table number printed on your table (digits only).'
                : 'Reserve your dining table ahead of time and have your dishes prepared fresh for your arrival.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            style={{ color: '#94a3b8', fontSize: '1.1rem', padding: '4px 8px', cursor: 'pointer' }}
            aria-label="Close table drawer"
          >
            ✕
          </button>
        </div>

        {/* Mode Switcher */}
        <div
          style={{
            display: 'flex',
            background: 'rgba(255, 255, 255, 0.05)',
            borderRadius: '10px',
            padding: '3px',
            marginBottom: '12px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            type="button"
            onClick={() => setModalMode('DINE_IN')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: 'none',
              background: modalMode === 'DINE_IN' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'transparent',
              color: modalMode === 'DINE_IN' ? '#000' : '#94a3b8',
              fontWeight: 800,
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            🍽️ Seated Now (Dine-In)
          </button>
          <button
            type="button"
            onClick={() => setModalMode('PRE_BOOK')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: '8px',
              border: 'none',
              background: modalMode === 'PRE_BOOK' ? 'linear-gradient(135deg, #8b5cf6, #7c3aed)' : 'transparent',
              color: modalMode === 'PRE_BOOK' ? '#fff' : '#94a3b8',
              fontWeight: 800,
              fontSize: '0.82rem',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            📅 Pre-Book Table
          </button>
        </div>

        {modalMode === 'DINE_IN' ? (
          <>
            <form onSubmit={handleManualSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoFocus
                  placeholder="Enter table digits (e.g. 4)"
                  value={tableNumberInput}
                  onChange={(e) => setTableNumberInput(sanitizeTableDigits(e.target.value))}
                  aria-label="Table number input"
                  style={{
                    flex: 1,
                    padding: '11px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.07)',
                    border: validation.error
                      ? '1.5px solid #ef4444'
                      : validation.matched
                      ? '1.5px solid #10b981'
                      : '1px solid rgba(255, 255, 255, 0.16)',
                    color: '#fff',
                    fontSize: '1rem',
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                />
                <button
                  type="submit"
                  className="accordion-add-action-btn"
                  disabled={!validation.matched || tableSubmitLoading}
                  style={{
                    width: 'auto',
                    minWidth: '116px',
                    margin: 0,
                    padding: '11px 16px',
                    opacity: !validation.matched || tableSubmitLoading ? 0.45 : 1,
                    cursor: !validation.matched || tableSubmitLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {tableSubmitLoading ? 'Saving...' : 'Confirm ✓'}
                </button>
              </div>

              {validation.error && (
                <div style={{ color: '#f87171', fontSize: '0.79rem', fontWeight: 600 }}>
                  ⚠️ {validation.error}
                </div>
              )}

              {validation.matched && (
                <div style={{ color: '#34d399', fontSize: '0.79rem', fontWeight: 600 }}>
                  ✓ Verified hotel table: Table {validation.matched.table_number}
                  {validation.matched.section ? ` (${validation.matched.section})` : ''}
                </div>
              )}

              {!effectiveTablesLoaded && (
                <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Loading hotel tables...</div>
              )}

              {effectiveTablesLoaded && effectiveTables.length === 0 && (
                <div style={{ color: '#fbbf24', fontSize: '0.75rem' }}>
                  Tap your table&apos;s NFC tag / QR code, or open with <code>?outlet=&lt;id&gt;</code>, to load hotel tables.
                </div>
              )}
            </form>

            <details style={{ marginTop: '10px', fontSize: '0.75rem', color: '#94a3b8' }}>
              <summary style={{ cursor: 'pointer', userSelect: 'none' }}>Or paste a signed QR token / link</summary>
              <form onSubmit={handleQrSubmit} style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <input
                  type="text"
                  placeholder="Paste signed QR link or token"
                  value={manualQrInput}
                  onChange={(e) => setManualQrInput(e.target.value)}
                  aria-label="Paste signed QR token"
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.14)',
                    color: '#fff',
                    fontSize: '0.78rem',
                  }}
                />
                <button
                  type="submit"
                  className="filter-clear-btn"
                  style={{ padding: '7px 12px', fontSize: '0.76rem' }}
                >
                  Verify QR
                </button>
              </form>
            </details>
          </>
        ) : (
          /* PRE_BOOK MODE */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Party Size Selector */}
            <div>
              <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                👥 Party Size (Guests)
              </label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[2, 4, 6, 8, 10].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setPreBookGuests(count)}
                    style={{
                      padding: '7px 14px',
                      borderRadius: '8px',
                      border: preBookGuests === count ? '1.5px solid #a855f7' : '1px solid rgba(255, 255, 255, 0.12)',
                      background: preBookGuests === count ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                      color: preBookGuests === count ? '#c084fc' : '#94a3b8',
                      fontWeight: 800,
                      fontSize: '0.84rem',
                      cursor: 'pointer',
                    }}
                  >
                    {count} Guests
                  </button>
                ))}
              </div>
            </div>

            {/* Date & Time Picker */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                  📅 Reservation Date
                </label>
                <input
                  type="date"
                  value={preBookDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setPreBookDate(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'rgba(255, 255, 255, 0.07)',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    color: '#fff',
                    fontSize: '0.84rem',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.78rem', fontWeight: 700, color: '#cbd5e1', marginBottom: '6px' }}>
                  ⏰ Dining Time
                </label>
                <select
                  value={preBookTime}
                  onChange={(e) => setPreBookTime(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: '8px',
                    background: 'rgba(30, 41, 59, 0.9)',
                    border: '1px solid rgba(255, 255, 255, 0.16)',
                    color: '#fff',
                    fontSize: '0.84rem',
                  }}
                >
                  {['12:30', '13:00', '13:30', '14:00', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'].map((time) => (
                    <option key={time} value={time}>
                      {time} ({Number(time.split(':')[0]) >= 12 ? `${Number(time.split(':')[0]) === 12 ? 12 : Number(time.split(':')[0]) - 12}:${time.split(':')[1]} PM` : `${time} AM`})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Check Availability CTA */}
            <button
              type="button"
              onClick={handleCheckAvailability}
              disabled={availabilityLoading}
              style={{
                width: '100%',
                padding: '11px',
                borderRadius: '10px',
                border: 'none',
                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                color: '#fff',
                fontWeight: 800,
                fontSize: '0.88rem',
                cursor: availabilityLoading ? 'not-allowed' : 'pointer',
                opacity: availabilityLoading ? 0.7 : 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
              }}
            >
              <span>{availabilityLoading ? 'Checking Availability…' : '🔍 Check Table Availability'}</span>
            </button>

            {/* Availability Error */}
            {availabilityError && (
              <div style={{ color: '#f87171', fontSize: '0.8rem', fontWeight: 600 }}>
                ⚠️ {availabilityError}
              </div>
            )}

            {/* Availability Result Card */}
            {availabilityResult && (
              <div
                style={{
                  background: availabilityResult.available ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                  border: availabilityResult.available ? '1px solid rgba(16, 185, 129, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
                  borderRadius: '10px',
                  padding: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                {availabilityResult.available ? (
                  <>
                    <div style={{ color: '#34d399', fontWeight: 800, fontSize: '0.88rem' }}>
                      ✅ Table(s) Available!
                    </div>
                    <div style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
                      Assigned: <strong>Table {availabilityResult.tables.map((t) => t.table_number).join(' + ')}</strong> (Seats up to {availabilityResult.total_capacity} guests)
                    </div>
                    <button
                      type="button"
                      onClick={handleConfirmPreBooking}
                      disabled={tableSubmitLoading}
                      style={{
                        width: '100%',
                        padding: '11px',
                        borderRadius: '8px',
                        border: 'none',
                        background: 'linear-gradient(135deg, #10b981, #059669)',
                        color: '#fff',
                        fontWeight: 900,
                        fontSize: '0.88rem',
                        cursor: tableSubmitLoading ? 'not-allowed' : 'pointer',
                        marginTop: '4px',
                      }}
                    >
                      {tableSubmitLoading ? 'Reserving…' : '✨ Reserve & Start Pre-Ordering dishes →'}
                    </button>
                  </>
                ) : (
                  <div style={{ color: '#f87171', fontSize: '0.82rem', fontWeight: 600 }}>
                    ❌ No tables available for {preBookGuests} guests during this time slot. All tables are currently reserved. Please choose another time.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {isTableVerified && (
          <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleClearSession}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#f87171',
                fontSize: '0.75rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Clear Current Table Session
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
