'use client';

import React, { useState, useMemo } from 'react';
import type { TableOrderRecord, FlattenedPlateItem } from '../../types';
import { useOrderStore } from '../../store/useOrderStore';
import {
  formatOrderDateTime,
  flattenPlates,
  filterPlatesByTab,
  getCourseBadge,
  getCourseSequenceLabel,
  getDishStatusBadge,
  type OrdersFilterTab,
} from './orders-utils';
import type { OutletTableInfo } from '../../app/lib/guest-session';
import { sanitizeTableDigits, matchHotelTable } from '../../app/lib/guest-session';

// ============================================================================
// Types
// ============================================================================

export interface OrdersHistoryViewProps {
  isOpen?: boolean;
  onClose?: () => void;
  sessionOrders?: TableOrderRecord[];
  flattenedPlates?: FlattenedPlateItem[];
  selectedTable?: string;
  onRefreshOrders?: () => Promise<void> | void;
  onCallWaiter?: (reason: string) => Promise<void> | void;
  onReviewOrder?: (order: TableOrderRecord) => void;
  onOrderMore?: () => void;
  outletTables?: OutletTableInfo[];
  releasedHoldPlateKeys?: Record<string, boolean>;
  onReleaseHold?: (plateKeys: string[], itemName?: string) => Promise<void> | void;
  onMoveOrderPlateTable?: (
    plate: FlattenedPlateItem,
    targetTable: OutletTableInfo
  ) => Promise<void> | void;
}

// ============================================================================
// Component Implementation
// ============================================================================

export function OrdersHistoryView({
  isOpen: propIsOpen,
  onClose: propOnClose,
  sessionOrders = [],
  flattenedPlates: propFlattenedPlates,
  selectedTable: propSelectedTable,
  onRefreshOrders,
  onCallWaiter,
  onReviewOrder,
  onOrderMore,
  outletTables = [],
  releasedHoldPlateKeys = {},
  onReleaseHold,
  onMoveOrderPlateTable,
}: OrdersHistoryViewProps) {
  // Store subscriptions
  const storeIsOpen = useOrderStore((s) => s.isOrdersHistoryOpen);
  const setStoreIsOpen = useOrderStore((s) => s.setIsOrdersHistoryOpen);
  const storeSelectedTable = useOrderStore((s) => s.selectedTable);
  const cartLines = useOrderStore((s) => s.cartLines);
  const cartItemCount = useOrderStore((s) => s.getCartItemCount());
  const setIsCartOpen = useOrderStore((s) => s.setIsCartOpen);

  const isOpen = propIsOpen !== undefined ? propIsOpen : storeIsOpen;
  const selectedTable = propSelectedTable || storeSelectedTable || '--';

  const handleClose = () => {
    if (propOnClose) {
      propOnClose();
    } else {
      setStoreIsOpen(false);
    }
  };

  // ── State ──
  const [ordersFilterTab, setOrdersFilterTab] = useState<OrdersFilterTab>('PREPARING');
  const [expandedPlateKeys, setExpandedPlateKeys] = useState<Record<string, boolean>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isReleasingHold, setIsReleasingHold] = useState(false);

  const handleReleaseHoldClick = async (plateKeys: string[], itemName?: string) => {
    if (isReleasingHold || !onReleaseHold) return;
    setIsReleasingHold(true);
    try {
      await onReleaseHold(plateKeys, itemName);
    } finally {
      setIsReleasingHold(false);
    }
  };

  // Table Move inline editing state
  const [editingOrderPlateKey, setEditingOrderPlateKey] = useState<string | null>(null);
  const [editingOrderPlateDigits, setEditingOrderPlateDigits] = useState('');
  const [editingOrderPlateLoading, setEditingOrderPlateLoading] = useState(false);

  // Call Waiter modal / action state
  const [isCallingWaiter, setIsCallingWaiter] = useState(false);
  const [waiterCallStatus, setWaiterCallStatus] = useState<string | null>(null);
  const [showWaiterReasonPicker, setShowWaiterReasonPicker] = useState(false);

  // ── Flattened Plates Derivation ──
  const flattenedPlates = useMemo(() => {
    if (propFlattenedPlates) return propFlattenedPlates;
    return flattenPlates(sessionOrders, selectedTable, releasedHoldPlateKeys);
  }, [propFlattenedPlates, sessionOrders, selectedTable, releasedHoldPlateKeys]);

  // Tab filtered plate sets
  const preparingPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'PREPARING'),
    [flattenedPlates]
  );
  const onHoldPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'ON_HOLD'),
    [flattenedPlates]
  );
  const servedPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'SERVED'),
    [flattenedPlates]
  );
  const cancelledPlates = useMemo(
    () => filterPlatesByTab(flattenedPlates, 'CANCELLED'),
    [flattenedPlates]
  );

  const displayPlates = useMemo(() => {
    return filterPlatesByTab(flattenedPlates, ordersFilterTab);
  }, [flattenedPlates, ordersFilterTab]);

  // Expand / Collapse Handlers
  const togglePlateExpanded = (plateKey: string) => {
    setExpandedPlateKeys((prev) => ({
      ...prev,
      [plateKey]: !prev[plateKey],
    }));
  };

  const handleToggleExpandAllPlates = (platesToToggle: FlattenedPlateItem[]) => {
    const allExpanded =
      platesToToggle.length > 0 && platesToToggle.every((p) => expandedPlateKeys[p.plateKey]);
    const nextState: Record<string, boolean> = { ...expandedPlateKeys };
    platesToToggle.forEach((p) => {
      nextState[p.plateKey] = !allExpanded;
    });
    setExpandedPlateKeys(nextState);
  };

  // Table Move Validation
  const orderPlateValidation = useMemo(() => {
    if (!editingOrderPlateDigits.trim()) {
      return { matched: null, error: null };
    }
    const cleanDigits = sanitizeTableDigits(editingOrderPlateDigits);
    const matched = matchHotelTable(cleanDigits, outletTables);
    if (!matched) {
      return { matched: null, error: `Table "${cleanDigits}" not found in restaurant directory` };
    }
    return { matched, error: null };
  }, [editingOrderPlateDigits, outletTables]);

  const handleConfirmMoveTable = async (plate: FlattenedPlateItem, targetTable: OutletTableInfo) => {
    if (editingOrderPlateLoading) return;
    setEditingOrderPlateLoading(true);
    try {
      if (onMoveOrderPlateTable) {
        await onMoveOrderPlateTable(plate, targetTable);
      }
      setEditingOrderPlateKey(null);
      setEditingOrderPlateDigits('');
    } finally {
      setEditingOrderPlateLoading(false);
    }
  };

  // Manual Refresh Handler
  const handleRefresh = async () => {
    if (isRefreshing || !onRefreshOrders) return;
    setIsRefreshing(true);
    try {
      await onRefreshOrders();
    } finally {
      setIsRefreshing(false);
    }
  };

  // Call Waiter Dispatch Handler
  const handleTriggerCallWaiter = async (reason: string = 'General Assistance') => {
    setIsCallingWaiter(true);
    setShowWaiterReasonPicker(false);
    try {
      if (onCallWaiter) {
        await onCallWaiter(reason);
      }
      setWaiterCallStatus(`🔔 Staff notified for Table ${selectedTable} (${reason}). A server will assist you shortly!`);
      setTimeout(() => setWaiterCallStatus(null), 5000);
    } catch {
      setWaiterCallStatus(`⚠️ Unable to reach staff. Please flag your server directly.`);
      setTimeout(() => setWaiterCallStatus(null), 5000);
    } finally {
      setIsCallingWaiter(false);
    }
  };

  if (!isOpen) return null;

  const totalDisplayPaise = displayPlates.reduce((sum, p) => sum + p.plateTotalPaise, 0);
  const allExpanded = displayPlates.length > 0 && displayPlates.every((p) => expandedPlateKeys[p.plateKey]);

  return (
    <div className="side-drawer-wrap" onClick={handleClose}>
      <div
        className="side-drawer-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Table ${selectedTable} Paid Orders`}
      >
        {/* 1. Drawer Header */}
        <div
          className="drawer-header"
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '1.3rem' }} aria-hidden="true">
              📋
            </span>
            <div>
              <div
                className="drawer-title"
                style={{ fontSize: '1.05rem', fontWeight: 800, color: '#fff' }}
              >
                Table {selectedTable} Paid Orders
              </div>
              <div style={{ fontSize: '0.74rem', color: '#94a3b8' }}>
                {preparingPlates.length} preparing · {servedPlates.length} served ·{' '}
                {cancelledPlates.length} cancelled
                {flattenedPlates[0]?.orderCreatedAt && (
                  <span> · Latest: {formatOrderDateTime(flattenedPlates[0].orderCreatedAt)}</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {onRefreshOrders && (
              <button
                type="button"
                onClick={handleRefresh}
                disabled={isRefreshing}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '8px',
                  color: isRefreshing ? '#fbbf24' : '#94a3b8',
                  fontSize: '0.82rem',
                  padding: '6px 10px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  cursor: isRefreshing ? 'wait' : 'pointer',
                }}
                title="Refresh order statuses"
              >
                <span style={{ display: 'inline-block', transform: isRefreshing ? 'rotate(180deg)' : 'none', transition: 'transform 0.4s ease' }}>
                  🔄
                </span>
                <span style={{ fontSize: '0.72rem', fontWeight: 700 }}>
                  {isRefreshing ? 'Refreshing...' : 'Refresh'}
                </span>
              </button>
            )}

            <button
              type="button"
              onClick={handleClose}
              style={{
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: '8px',
                color: '#94a3b8',
                fontSize: '1rem',
                width: '32px',
                height: '32px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
              aria-label="Close orders drawer"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Waiter Status Notification Toast */}
        {waiterCallStatus && (
          <div
            style={{
              padding: '10px 16px',
              background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.25))',
              borderBottom: '1px solid rgba(245, 158, 11, 0.4)',
              color: '#fbbf24',
              fontSize: '0.8rem',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>{waiterCallStatus}</span>
            <button
              type="button"
              onClick={() => setWaiterCallStatus(null)}
              style={{ background: 'transparent', border: 'none', color: '#fbbf24', cursor: 'pointer', fontSize: '0.9rem' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* 2. Filter Tabs: Preparing | Serve Later (On Hold) | Served | Cancelled */}
        <div
          style={{
            display: 'flex',
            gap: '6px',
            padding: '10px 14px',
            background: 'rgba(0, 0, 0, 0.25)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            overflowX: 'auto',
          }}
        >
          <button
            type="button"
            onClick={() => setOrdersFilterTab('PREPARING')}
            style={{
              flex: 1,
              padding: '9px 6px',
              borderRadius: '8px',
              fontSize: '0.74rem',
              fontWeight: ordersFilterTab === 'PREPARING' ? 800 : 600,
              cursor: 'pointer',
              background:
                ordersFilterTab === 'PREPARING'
                  ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                  : 'rgba(255, 255, 255, 0.04)',
              color: ordersFilterTab === 'PREPARING' ? '#000' : '#94a3b8',
              border:
                ordersFilterTab === 'PREPARING'
                  ? '1px solid #f59e0b'
                  : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>🍳 Preparing</span>
            <span
              style={{
                background:
                  ordersFilterTab === 'PREPARING'
                    ? 'rgba(0, 0, 0, 0.25)'
                    : 'rgba(255, 255, 255, 0.1)',
                padding: '1px 5px',
                borderRadius: '999px',
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              {preparingPlates.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setOrdersFilterTab('ON_HOLD')}
            style={{
              flex: 1,
              padding: '9px 6px',
              borderRadius: '8px',
              fontSize: '0.74rem',
              fontWeight: ordersFilterTab === 'ON_HOLD' ? 800 : 600,
              cursor: 'pointer',
              background:
                ordersFilterTab === 'ON_HOLD'
                  ? 'linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)'
                  : 'rgba(255, 255, 255, 0.04)',
              color: ordersFilterTab === 'ON_HOLD' ? '#000' : '#94a3b8',
              border:
                ordersFilterTab === 'ON_HOLD'
                  ? '1px solid #06b6d4'
                  : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>🍨 Serve Later</span>
            <span
              style={{
                background:
                  ordersFilterTab === 'ON_HOLD'
                    ? 'rgba(0, 0, 0, 0.25)'
                    : 'rgba(255, 255, 255, 0.1)',
                padding: '1px 5px',
                borderRadius: '999px',
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              {onHoldPlates.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setOrdersFilterTab('SERVED')}
            style={{
              flex: 1,
              padding: '9px 6px',
              borderRadius: '8px',
              fontSize: '0.74rem',
              fontWeight: ordersFilterTab === 'SERVED' ? 800 : 600,
              cursor: 'pointer',
              background:
                ordersFilterTab === 'SERVED'
                  ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                  : 'rgba(255, 255, 255, 0.04)',
              color: ordersFilterTab === 'SERVED' ? '#fff' : '#94a3b8',
              border:
                ordersFilterTab === 'SERVED'
                  ? '1px solid #10b981'
                  : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>🍽️ Served</span>
            <span
              style={{
                background:
                  ordersFilterTab === 'SERVED'
                    ? 'rgba(0, 0, 0, 0.25)'
                    : 'rgba(255, 255, 255, 0.1)',
                padding: '1px 5px',
                borderRadius: '999px',
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              {servedPlates.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setOrdersFilterTab('CANCELLED')}
            style={{
              flex: 1,
              padding: '9px 6px',
              borderRadius: '8px',
              fontSize: '0.74rem',
              fontWeight: ordersFilterTab === 'CANCELLED' ? 800 : 600,
              cursor: 'pointer',
              background:
                ordersFilterTab === 'CANCELLED'
                  ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)'
                  : 'rgba(255, 255, 255, 0.04)',
              color: ordersFilterTab === 'CANCELLED' ? '#fff' : '#94a3b8',
              border:
                ordersFilterTab === 'CANCELLED'
                  ? '1px solid #ef4444'
                  : '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            <span>✕ Cancel</span>
            <span
              style={{
                background:
                  ordersFilterTab === 'CANCELLED'
                    ? 'rgba(0, 0, 0, 0.25)'
                    : 'rgba(255, 255, 255, 0.1)',
                padding: '1px 5px',
                borderRadius: '999px',
                fontSize: '0.7rem',
                fontWeight: 800,
              }}
            >
              {cancelledPlates.length}
            </span>
          </button>
        </div>

        {/* 3. Drawer Body: Plate-level breakdown */}
        <div className="drawer-body" style={{ padding: '16px' }}>
          {/* Empty State: No Paid Orders */}
          {flattenedPlates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#94a3b8' }}>
              <div style={{ fontSize: '3rem', marginBottom: '14px' }}>📋</div>
              <h4 style={{ color: '#fff', marginBottom: '6px' }}>No paid orders yet</h4>
              <p style={{ fontSize: '0.85rem', lineHeight: 1.5, marginBottom: '16px' }}>
                Dishes stay in your cart until paid. Once paid, track their cooking and delivery
                status here!
              </p>
              <button
                type="button"
                onClick={() => {
                  handleClose();
                  if (cartLines.length > 0) setIsCartOpen(true);
                }}
                className="accordion-add-action-btn"
                style={{ margin: '0 auto', fontSize: '0.82rem', padding: '8px 16px' }}
              >
                {cartLines.length > 0
                  ? `View Cart (${cartItemCount} Pending)`
                  : 'Browse Menu & Order'}
              </button>
            </div>
          ) : displayPlates.length === 0 ? (
            /* Empty State: Selected Tab has no dishes */
            <div style={{ textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>
                {ordersFilterTab === 'PREPARING'
                  ? '🍳'
                  : ordersFilterTab === 'ON_HOLD'
                  ? '🍨'
                  : ordersFilterTab === 'SERVED'
                  ? '🍽️'
                  : '✨'}
              </div>
              <h4 style={{ color: '#fff', marginBottom: '6px' }}>
                {ordersFilterTab === 'PREPARING'
                  ? 'No dishes preparing'
                  : ordersFilterTab === 'ON_HOLD'
                  ? 'No items held for later'
                  : ordersFilterTab === 'SERVED'
                  ? 'No dishes served yet'
                  : 'No cancelled dishes'}
              </h4>
              <p style={{ fontSize: '0.82rem', marginBottom: '16px', lineHeight: 1.5 }}>
                {ordersFilterTab === 'PREPARING'
                  ? 'All dishes placed at this table have either been served or completed.'
                  : ordersFilterTab === 'ON_HOLD'
                  ? 'Post-meal items like desserts and hot beverages will appear here once ordered. Release them to the kitchen whenever you are ready!'
                  : ordersFilterTab === 'SERVED'
                  ? 'The kitchen is preparing your dishes. Once served to your table, they will appear here!'
                  : 'None of your table orders have been cancelled.'}
              </p>
            </div>
          ) : (
            /* Dishes List */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {/* Sub-header controls: Count & Expand All */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  fontSize: '0.78rem',
                  color: '#94a3b8',
                  paddingBottom: '4px',
                }}
              >
                <span style={{ fontWeight: 600 }}>
                  {ordersFilterTab === 'PREPARING' && '🍳 '}
                  {ordersFilterTab === 'ON_HOLD' && '🍨 '}
                  {ordersFilterTab === 'SERVED' && '🍽️ '}
                  {ordersFilterTab === 'CANCELLED' && '✕ '}
                  {displayPlates.length} {ordersFilterTab === 'ON_HOLD' ? 'item' : 'dish'}
                  {displayPlates.length === 1 ? '' : 'es'} · Total ₹
                  {(totalDisplayPaise / 100).toFixed(0)}
                </span>
                <button
                  type="button"
                  onClick={() => handleToggleExpandAllPlates(displayPlates)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#fbbf24',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: '2px 4px',
                  }}
                >
                  {allExpanded ? 'Collapse All ▲' : 'Expand All ▼'}
                </button>
              </div>

              {/* Special Grouped Render for ON_HOLD Tab */}
              {ordersFilterTab === 'ON_HOLD' ? (
                (() => {
                  const groupedByItem: Record<string, FlattenedPlateItem[]> = {};
                  onHoldPlates.forEach((plate) => {
                    const existing = groupedByItem[plate.itemId];
                    if (!existing) {
                      groupedByItem[plate.itemId] = [plate];
                    } else {
                      existing.push(plate);
                    }
                  });

                  return Object.entries(groupedByItem).map(([itemId, itemPlates]) => {
                    const firstPlate = itemPlates[0];
                    if (!firstPlate) return null;
                    const totalQty = itemPlates.length;
                    const totalPaise = itemPlates.reduce((s, p) => s + p.plateTotalPaise, 0);
                    const allPlateKeys = itemPlates.map((p) => p.plateKey);

                    const name = firstPlate.itemName.toLowerCase();
                    const emoji =
                      name.includes('coffee') || name.includes('chai') || name.includes('tea')
                        ? '☕'
                        : name.includes('ice cream') || name.includes('kulfi')
                        ? '🍦'
                        : name.includes('gulab') ||
                          name.includes('rasgulla') ||
                          name.includes('halwa') ||
                          name.includes('sweet')
                        ? '🍮'
                        : '🍨';

                    const courseBadge = getCourseBadge(firstPlate.courseSequence);
                    const isScheduledWait = firstPlate.holdStatus === 'SCHEDULED_WAIT';

                    return (
                      <div
                        key={itemId}
                        style={{
                          background: 'rgba(139, 92, 246, 0.07)',
                          border: '1.5px solid rgba(139, 92, 246, 0.35)',
                          borderRadius: '14px',
                          padding: '16px',
                          transition: 'all 0.2s ease',
                        }}
                      >
                        {/* Header */}
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'flex-start',
                            marginBottom: '10px',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span style={{ fontSize: '1.6rem' }}>{emoji}</span>
                            <div>
                              <div
                                style={{
                                  fontWeight: 800,
                                  fontSize: '0.95rem',
                                  color: '#f8fafc',
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '6px',
                                  flexWrap: 'wrap',
                                }}
                              >
                                <span>
                                  {totalQty > 1 ? `${totalQty}× ` : ''}
                                  {firstPlate.itemName}
                                </span>
                                <span
                                  style={{
                                    background: courseBadge.bg,
                                    color: courseBadge.color,
                                    border: `1px solid ${courseBadge.border}`,
                                    fontSize: '0.68rem',
                                    fontWeight: 800,
                                    padding: '1px 6px',
                                    borderRadius: '6px',
                                  }}
                                >
                                  {courseBadge.emoji} {courseBadge.code} {courseBadge.label}
                                </span>
                              </div>
                              <div
                                style={{
                                  fontSize: '0.74rem',
                                  color: isScheduledWait ? '#38bdf8' : '#a78bfa',
                                  marginTop: '2px',
                                  fontWeight: 600,
                                }}
                              >
                                {isScheduledWait
                                  ? `⏰ Scheduled fire for ${formatOrderDateTime(firstPlate.targetFireAt || firstPlate.scheduledFor)}`
                                  : `⏳ On Hold — Chef will start cooking fresh when you tap below (~${firstPlate.prepTimeMinutes ?? 15}m prep)`}
                              </div>
                              <div
                                style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '3px' }}
                              >
                                🕒{' '}
                                {formatOrderDateTime(
                                  firstPlate.itemCreatedAt || firstPlate.orderCreatedAt
                                )}{' '}
                                · Order #{firstPlate.orderNumber}
                              </div>
                            </div>
                          </div>
                          <span
                            style={{
                              fontWeight: 800,
                              color: '#a78bfa',
                              fontSize: '0.9rem',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            ₹{(totalPaise / 100).toFixed(0)}
                          </span>
                        </div>

                        {/* Breakdown per plate if multiple */}
                        {itemPlates.length > 1 && (
                          <div
                            style={{
                              background: 'rgba(139, 92, 246, 0.06)',
                              borderRadius: '8px',
                              padding: '8px 10px',
                              marginBottom: '12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            {itemPlates.map((plate, idx) => {
                              const plateNote = plate.rawNotes || plate.kitchenNote;
                              return (
                                <div
                                  key={plate.plateKey}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    fontSize: '0.8rem',
                                    gap: '8px',
                                  }}
                                >
                                  <span style={{ color: '#c4b5fd' }}>
                                    Plate {idx + 1}
                                    {plate.portion === 'HALF' ? ' · Half Plate' : ''}
                                    {plateNote ? ` · Note: ${plateNote}` : ''}
                                    <span
                                      style={{
                                        display: 'block',
                                        fontSize: '0.7rem',
                                        color: '#94a3b8',
                                      }}
                                    >
                                      🕒{' '}
                                      {formatOrderDateTime(
                                        plate.itemCreatedAt || plate.orderCreatedAt
                                      )}
                                    </span>
                                  </span>
                                  {onReleaseHold && (
                                    <button
                                      type="button"
                                      disabled={isReleasingHold}
                                      onClick={() =>
                                        void handleReleaseHoldClick([plate.plateKey], firstPlate.itemName)
                                      }
                                      style={{
                                        background: isReleasingHold ? 'rgba(139, 92, 246, 0.1)' : 'rgba(139, 92, 246, 0.2)',
                                        border: '1px solid rgba(139, 92, 246, 0.5)',
                                        borderRadius: '6px',
                                        color: isReleasingHold ? '#8b5cf6' : '#c4b5fd',
                                        fontSize: '0.72rem',
                                        fontWeight: 700,
                                        padding: '3px 8px',
                                        cursor: isReleasingHold ? 'not-allowed' : 'pointer',
                                      }}
                                    >
                                      {isReleasingHold ? 'Firing...' : isScheduledWait ? 'Fire Ahead →' : 'Bring This Plate →'}
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Primary Release CTA */}
                        {onReleaseHold && (
                          <button
                            type="button"
                            disabled={isReleasingHold}
                            onClick={() => void handleReleaseHoldClick(allPlateKeys, firstPlate.itemName)}
                            style={{
                              width: '100%',
                              background: isReleasingHold
                                ? 'rgba(109, 40, 217, 0.4)'
                                : isScheduledWait
                                ? 'linear-gradient(135deg, #0284c7, #0369a1)'
                                : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                              color: '#fff',
                              border: 'none',
                              borderRadius: '10px',
                              padding: '12px 16px',
                              fontWeight: 900,
                              fontSize: '0.9rem',
                              cursor: isReleasingHold ? 'not-allowed' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '8px',
                              boxShadow: isScheduledWait
                                ? '0 4px 14px rgba(3, 105, 161, 0.4)'
                                : '0 4px 14px rgba(109, 40, 217, 0.4)',
                            }}
                          >
                            <span>
                              {isReleasingHold
                                ? '⏳ Firing to Kitchen...'
                                : isScheduledWait
                                ? '⚡ Fire to Kitchen Ahead of Schedule'
                                : '🍳 Fire to Kitchen Now'}
                            </span>
                            {totalQty > 1 && (
                              <span style={{ opacity: 0.8, fontSize: '0.8rem' }}>
                                ({totalQty} plates)
                              </span>
                            )}
                          </button>
                        )}
                      </div>
                    );
                  });
                })()
              ) : (
                /* Standard Plates List */
                displayPlates.map((plate) => {
                  const isExpanded = Boolean(expandedPlateKeys[plate.plateKey]);
                  const statusBadge = getDishStatusBadge(plate.itemStatus, plate.holdStatus);
                  const isPlateServed = plate.itemStatus === 'SERVED';
                  const displayOrderNumber = plate.displayId || `ORD-${String(plate.orderNumber).padStart(4, '0')}`;

                  return (
                    <div
                      key={plate.plateKey}
                      style={{
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: isExpanded
                          ? '1px solid rgba(245, 158, 11, 0.4)'
                          : '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: '12px',
                        padding: '14px',
                        transition: 'all 0.2s ease',
                        boxShadow: isExpanded ? '0 4px 16px rgba(0, 0, 0, 0.3)' : 'none',
                      }}
                    >
                      {/* Plate Header */}
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: '8px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flexWrap: 'wrap',
                          }}
                        >
                          <span
                            style={{
                              background:
                                'linear-gradient(135deg, rgba(245, 158, 11, 0.25) 0%, rgba(217, 119, 6, 0.18) 100%)',
                              border: '1px solid rgba(245, 158, 11, 0.45)',
                              color: '#fbbf24',
                              fontSize: '0.76rem',
                              fontWeight: 800,
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                            }}
                          >
                            🍽️ {plate.plateName}
                          </span>
                          {plate.courseSequence && (
                            <span
                              style={{
                                background: getCourseBadge(plate.courseSequence).bg,
                                border: `1px solid ${getCourseBadge(plate.courseSequence).border}`,
                                color: getCourseBadge(plate.courseSequence).color,
                                fontSize: '0.68rem',
                                fontWeight: 800,
                                padding: '2px 6px',
                                borderRadius: '9999px',
                              }}
                            >
                              {getCourseBadge(plate.courseSequence).emoji} {getCourseBadge(plate.courseSequence).code}
                            </span>
                          )}
                          {plate.portion === 'HALF' && (
                            <span
                              style={{
                                background: 'rgba(59, 130, 246, 0.15)',
                                border: '1px solid rgba(59, 130, 246, 0.35)',
                                color: '#60a5fa',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: '9999px',
                              }}
                            >
                              Half Plate
                            </span>
                          )}
                          {plate.spiceLevel && (
                            <span
                              style={{
                                background: 'rgba(239, 68, 68, 0.12)',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                color: '#f87171',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                padding: '2px 6px',
                                borderRadius: '9999px',
                              }}
                            >
                              {plate.spiceLevel === 'HOT'
                                ? '🌶️ Hot'
                                : plate.spiceLevel === 'MEDIUM'
                                ? '🌶️ Medium'
                                : 'Mild'}
                            </span>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            className="status-badge"
                            style={{
                              background: statusBadge.bg,
                              color: statusBadge.color,
                              border: `1px solid ${statusBadge.border}`,
                              fontWeight: 800,
                              fontSize: '0.74rem',
                              padding: '2px 8px',
                              borderRadius: '9999px',
                            }}
                          >
                            {statusBadge.label}
                          </span>
                          {isPlateServed && onReviewOrder && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                const parentOrder = sessionOrders.find(
                                  (o) => o.id === plate.orderId
                                );
                                if (parentOrder) {
                                  onReviewOrder(parentOrder);
                                }
                              }}
                              style={{
                                background: 'rgba(245, 158, 11, 0.18)',
                                border: '1px solid rgba(245, 158, 11, 0.5)',
                                borderRadius: '6px',
                                color: '#fbbf24',
                                fontSize: '0.72rem',
                                fontWeight: 800,
                                padding: '2px 8px',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                              }}
                            >
                              ⭐ Rate Dish
                            </button>
                          )}
                          <span
                            style={{ fontWeight: 800, color: '#fbbf24', fontSize: '0.92rem' }}
                          >
                            ₹{(plate.plateTotalPaise / 100).toFixed(0)}
                          </span>
                        </div>
                      </div>

                      {/* Clickable Dish Name */}
                      <div
                        onClick={() => togglePlateExpanded(plate.plateKey)}
                        style={{
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 0',
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            togglePlateExpanded(plate.plateKey);
                          }
                        }}
                      >
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: '0.94rem',
                            color: '#f8fafc',
                            textDecoration: isExpanded ? 'none' : 'underline',
                            textDecorationColor: '#f59e0b',
                            textUnderlineOffset: '3px',
                          }}
                        >
                          {plate.itemName}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            togglePlateExpanded(plate.plateKey);
                          }}
                          style={{
                            background: isExpanded
                              ? 'rgba(245, 158, 11, 0.2)'
                              : 'rgba(255, 255, 255, 0.06)',
                            border: isExpanded
                              ? '1px solid #f59e0b'
                              : '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: '6px',
                            color: isExpanded ? '#fbbf24' : '#94a3b8',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            padding: '3px 8px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            cursor: 'pointer',
                          }}
                        >
                          {isExpanded ? '▲ Hide Details' : '▼ Details'}
                        </button>
                      </div>

                      {/* Metadata Row: Timestamp, Order #, Table # */}
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: '#94a3b8',
                          marginTop: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span>
                          🕒 {formatOrderDateTime(plate.itemCreatedAt || plate.orderCreatedAt)}
                        </span>
                        <span>·</span>
                        <span style={{ fontWeight: 700, color: '#e2e8f0' }}>{displayOrderNumber}</span>
                        {plate.dinerLabel && (
                          <>
                            <span>·</span>
                            <span
                              style={{
                                color: '#38bdf8',
                                fontWeight: 700,
                                background: 'rgba(56, 189, 248, 0.12)',
                                border: '1px solid rgba(56, 189, 248, 0.3)',
                                borderRadius: '999px',
                                padding: '1px 7px',
                              }}
                            >
                              👤 {plate.dinerLabel}
                            </span>
                          </>
                        )}
                        <span>·</span>
                        <span
                          style={{
                            color: '#fbbf24',
                            fontWeight: 700,
                            background: 'rgba(245, 158, 11, 0.12)',
                            border: '1px solid rgba(245, 158, 11, 0.28)',
                            borderRadius: '999px',
                            padding: '1px 7px',
                          }}
                        >
                          🪑 Table {plate.tableNumber}
                        </span>
                        {plate.orderStatus !== 'CANCELLED' && onMoveOrderPlateTable && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (editingOrderPlateKey === plate.plateKey) {
                                setEditingOrderPlateKey(null);
                                setEditingOrderPlateDigits('');
                              } else {
                                setEditingOrderPlateKey(plate.plateKey);
                                setEditingOrderPlateDigits(
                                  sanitizeTableDigits(plate.tableNumber)
                                );
                              }
                            }}
                            style={{
                              background: 'rgba(255,255,255,0.06)',
                              border: '1px solid rgba(255,255,255,0.16)',
                              borderRadius: '999px',
                              color: '#e2e8f0',
                              fontSize: '0.68rem',
                              fontWeight: 700,
                              padding: '1px 7px',
                              cursor: 'pointer',
                            }}
                          >
                            Move Table
                          </button>
                        )}
                      </div>

                      {/* Inline Move Table Form */}
                      {editingOrderPlateKey === plate.plateKey && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            marginTop: '6px',
                            padding: '8px 10px',
                            borderRadius: '8px',
                            background: 'rgba(15, 23, 42, 0.9)',
                            border: '1px solid rgba(245, 158, 11, 0.35)',
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
                              value={editingOrderPlateDigits}
                              onChange={(e) =>
                                setEditingOrderPlateDigits(sanitizeTableDigits(e.target.value))
                              }
                              style={{
                                width: '88px',
                                padding: '5px 8px',
                                borderRadius: '6px',
                                background: 'rgba(255,255,255,0.08)',
                                border: orderPlateValidation.error
                                  ? '1px solid #ef4444'
                                  : '1px solid rgba(255,255,255,0.18)',
                                color: '#fff',
                                fontSize: '0.8rem',
                                fontWeight: 700,
                              }}
                            />
                            <button
                              type="button"
                              disabled={!orderPlateValidation.matched || editingOrderPlateLoading}
                              onClick={() => {
                                if (orderPlateValidation.matched) {
                                  void handleConfirmMoveTable(
                                    plate,
                                    orderPlateValidation.matched
                                  );
                                }
                              }}
                              style={{
                                padding: '5px 10px',
                                borderRadius: '6px',
                                border: 'none',
                                background: orderPlateValidation.matched
                                  ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                                  : 'rgba(255,255,255,0.08)',
                                color: orderPlateValidation.matched ? '#000' : '#64748b',
                                fontSize: '0.74rem',
                                fontWeight: 800,
                                cursor: orderPlateValidation.matched ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {editingOrderPlateLoading ? 'Saving...' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingOrderPlateKey(null);
                                setEditingOrderPlateDigits('');
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
                          {orderPlateValidation.error && (
                            <div
                              style={{
                                fontSize: '0.72rem',
                                color: '#f87171',
                                fontWeight: 600,
                              }}
                            >
                              {orderPlateValidation.error}
                            </div>
                          )}
                          {orderPlateValidation.matched && (
                            <div
                              style={{
                                fontSize: '0.72rem',
                                color: '#34d399',
                                fontWeight: 600,
                              }}
                            >
                              ✓ Moving plate to Table {orderPlateValidation.matched.table_number}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Collapsed Hint */}
                      {!isExpanded && (
                        <div
                          onClick={() => togglePlateExpanded(plate.plateKey)}
                          style={{
                            fontSize: '0.75rem',
                            color: '#94a3b8',
                            marginTop: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            flexWrap: 'wrap',
                          }}
                        >
                          {plate.kitchenNote ? (
                            <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>
                              👨‍🍳 &ldquo;{plate.kitchenNote}&rdquo;
                            </span>
                          ) : plate.modifiers.length > 0 ? (
                            <span style={{ color: '#93c5fd' }}>
                              {plate.modifiers.length} customisation
                              {plate.modifiers.length > 1 ? 's' : ''} added
                            </span>
                          ) : (
                            <span style={{ color: '#64748b' }}>
                              Standard preparation · Tap to view breakdown
                            </span>
                          )}
                        </div>
                      )}

                      {/* Expanded View */}
                      {isExpanded && (
                        <div
                          style={{
                            marginTop: '12px',
                            paddingTop: '12px',
                            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '10px',
                            animation: 'fadeIn 0.2s ease',
                          }}
                        >
                          {/* 1. Note to the Kitchen */}
                          <div
                            style={{
                              background: 'rgba(245, 158, 11, 0.08)',
                              border: '1px solid rgba(245, 158, 11, 0.25)',
                              borderRadius: '8px',
                              padding: '10px 12px',
                            }}
                          >
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                marginBottom: '4px',
                              }}
                            >
                              <span style={{ fontSize: '0.9rem' }}>👨‍🍳</span>
                              <span
                                style={{
                                  fontSize: '0.74rem',
                                  fontWeight: 800,
                                  color: '#fbbf24',
                                  textTransform: 'uppercase',
                                  letterSpacing: '0.04em',
                                }}
                              >
                                Note to the Kitchen
                              </span>
                            </div>
                            <p
                              style={{
                                margin: 0,
                                fontSize: '0.84rem',
                                color: '#f1f5f9',
                                fontStyle: 'italic',
                              }}
                            >
                              &ldquo;
                              {plate.kitchenNote ||
                                'Standard chef preparation · No special instructions'}
                              &rdquo;
                            </p>
                          </div>

                          {/* 2. Customisations & Price Breakdown */}
                          <div
                            style={{
                              background: 'rgba(0, 0, 0, 0.3)',
                              border: '1px solid rgba(255, 255, 255, 0.08)',
                              borderRadius: '8px',
                              padding: '10px 12px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '6px',
                            }}
                          >
                            <div
                              style={{
                                fontSize: '0.74rem',
                                fontWeight: 800,
                                color: '#94a3b8',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                              }}
                            >
                              Customisations & Price Breakdown
                            </div>

                            {/* Base Price */}
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.82rem',
                                color: '#cbd5e1',
                              }}
                            >
                              <span>
                                {plate.portion === 'HALF'
                                  ? 'Half Plate Base Price'
                                  : 'Base Dish Price'}
                              </span>
                              <span style={{ fontWeight: 600 }}>
                                ₹{(plate.basePricePaise / 100).toFixed(0)}
                              </span>
                            </div>

                            {/* Modifiers */}
                            {plate.modifiers.length > 0 ? (
                              plate.modifiers.map((mod, mIdx) => (
                                <div
                                  key={mIdx}
                                  style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    fontSize: '0.82rem',
                                    color: '#93c5fd',
                                  }}
                                >
                                  <span>+ {mod.name}</span>
                                  <span style={{ fontWeight: 600 }}>
                                    {mod.price_paise > 0
                                      ? `+₹${(mod.price_paise / 100).toFixed(0)}`
                                      : 'Included'}
                                  </span>
                                </div>
                              ))
                            ) : (
                              <div
                                style={{
                                  fontSize: '0.78rem',
                                  color: '#64748b',
                                  fontStyle: 'italic',
                                }}
                              >
                                No extra add-ons selected
                              </div>
                            )}

                            {/* Spice level */}
                            {plate.spiceLevel && (
                              <div
                                style={{
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  fontSize: '0.82rem',
                                  color: '#f87171',
                                }}
                              >
                                <span>
                                  Spice Preference ({plate.spiceLevel}{' '}
                                  {plate.spiceLevel === 'HOT'
                                    ? '🌶️🌶️🌶️'
                                    : plate.spiceLevel === 'MEDIUM'
                                    ? '🌶️🌶️'
                                    : '🌶️'}
                                  )
                                </span>
                                <span style={{ fontWeight: 600, color: '#94a3b8' }}>
                                  Included (+₹0)
                                </span>
                              </div>
                            )}

                            {/* Total for this plate */}
                            <div
                              style={{
                                borderTop: '1px dashed rgba(255, 255, 255, 0.12)',
                                paddingTop: '6px',
                                marginTop: '3px',
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.86rem',
                                fontWeight: 800,
                                color: '#fbbf24',
                              }}
                            >
                              <span>Plate Total</span>
                              <span>₹{(plate.plateTotalPaise / 100).toFixed(0)}</span>
                            </div>
                          </div>

                          {/* 3. Order & Payment Metadata */}
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: '0.74rem',
                              color: '#64748b',
                              padding: '2px 4px',
                            }}
                          >
                            <span>
                              Order #{plate.orderNumber} · Table {plate.tableNumber} ·{' '}
                              {formatOrderDateTime(plate.orderCreatedAt)}
                            </span>
                            <span style={{ color: '#10b981', fontWeight: 700 }}>
                              Paid via {plate.paymentMethod || 'UPI'} ✅
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* 4. Drawer Footer */}
        {flattenedPlates.length > 0 && (
          <div
            className="drawer-footer"
            style={{ padding: '16px', borderTop: '1px solid rgba(255, 255, 255, 0.08)' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {servedPlates.length > 0 && onReviewOrder ? (
                <button
                  type="button"
                  onClick={() => {
                    const servedOrderIds = new Set(servedPlates.map((p) => p.orderId));
                    const orderToReview = sessionOrders.find((o) => servedOrderIds.has(o.id));
                    if (orderToReview) {
                      onReviewOrder(orderToReview);
                    }
                  }}
                  style={{
                    width: '100%',
                    padding: '11px 16px',
                    borderRadius: '10px',
                    background:
                      'linear-gradient(135deg, rgba(245, 158, 11, 0.22), rgba(217, 119, 6, 0.22))',
                    border: '1.5px solid rgba(245, 158, 11, 0.5)',
                    color: '#fbbf24',
                    fontWeight: 800,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.15)',
                  }}
                >
                  ⭐ Rate & Review Served Food (+₹10 Reward)
                </button>
              ) : (
                <div
                  style={{
                    padding: '10px 14px',
                    borderRadius: '10px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#94a3b8',
                    fontSize: '0.78rem',
                    textAlign: 'center',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  <span>⏳</span>
                  <span>Dishes are cooking in the kitchen! Rating unlocks once served to your table 🍽️</span>
                </div>
              )}

              {/* Order More Dishes CTA */}
              <button
                type="button"
                className="accordion-add-action-btn"
                onClick={() => {
                  if (onOrderMore) {
                    onOrderMore();
                  } else {
                    handleClose();
                  }
                }}
                style={{ width: '100%', margin: 0 }}
              >
                🍽️ Order More Dishes
              </button>

              {/* Dedicated "Call Waiter / Service Assistance" Interactive Section */}
              <div style={{ marginTop: '2px' }}>
                {showWaiterReasonPicker ? (
                  <div
                    style={{
                      background: 'rgba(15, 23, 42, 0.95)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: '10px',
                      padding: '10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <div
                      style={{
                        fontSize: '0.74rem',
                        fontWeight: 800,
                        color: '#fbbf24',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <span>🔔 SELECT SERVICE REQUEST:</span>
                      <button
                        type="button"
                        onClick={() => setShowWaiterReasonPicker(false)}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.76rem' }}
                      >
                        Cancel
                      </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px' }}>
                      <button
                        type="button"
                        onClick={() => handleTriggerCallWaiter('Water')}
                        style={{
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#fff',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        💧 Water
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTriggerCallWaiter('Cutlery')}
                        style={{
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#fff',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        🍴 Cutlery / Plates
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTriggerCallWaiter('Clean Table')}
                        style={{
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#fff',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        🧹 Clean Table
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTriggerCallWaiter('Bill / Settlement')}
                        style={{
                          padding: '7px 8px',
                          borderRadius: '6px',
                          background: 'rgba(255, 255, 255, 0.06)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#fff',
                          fontSize: '0.75rem',
                          cursor: 'pointer',
                          fontWeight: 600,
                        }}
                      >
                        🧾 Bill Assistance
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowWaiterReasonPicker(true)}
                    disabled={isCallingWaiter}
                    style={{
                      width: '100%',
                      padding: '9px 14px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      border: '1px solid rgba(255, 255, 255, 0.14)',
                      color: '#e2e8f0',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: isCallingWaiter ? 'wait' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '6px',
                    }}
                  >
                    <span>🔔</span>
                    <span>{isCallingWaiter ? 'Calling Server...' : 'Call Waiter / Request Staff Assistance'}</span>
                  </button>
                )}
              </div>

              <div
                style={{
                  textAlign: 'center',
                  fontSize: '0.74rem',
                  color: '#64748b',
                  marginTop: '2px',
                }}
              >
                ✅ All dishes above are paid & tracked in kitchen. Need assistance? Tap &ldquo;Call Waiter&rdquo;.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
