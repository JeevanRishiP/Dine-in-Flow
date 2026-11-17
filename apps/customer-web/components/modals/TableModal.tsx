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

  const handleClearSession = () => {
    clearGuestSession();
    setIsTableVerified(false);
    setSessionDetails({
      sessionId: '',
      tableId: '',
    });
    setSelectedTable('--');
    setTableNumberInput('');
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
              🪑 Select Your Table Number
            </h3>
            <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '3px 0 0' }}>
              {isTableVerified
                ? `Currently seated at Table ${selectedTable}. Type a new table number below or tap outside to close.`
                : 'Enter the numeric table number printed on your table (digits only).'}
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
