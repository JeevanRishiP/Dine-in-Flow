'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { customerApiFetch, DEFAULT_DEV_OUTLET_ID } from '../../app/lib/guest-session';
import {
  type AvailableTableOption,
  type AvailabilityResult,
  type SlotOption,
  generateTimeSlots,
  formatAvailabilityMessage,
} from './booking-utils';

export interface BookingFlowModalProps {
  isOpen: boolean;
  onClose: () => void;
  showToast?: (msg: string) => void;
  outletId?: string;
  onNavigateMenu?: () => void;
}

export {
  type AvailableTableOption,
  type AvailabilityResult,
  type SlotOption,
  generateTimeSlots,
  formatAvailabilityMessage,
};

export function BookingFlowModal({
  isOpen,
  onClose,
  showToast = (msg: string) => console.log(msg),
  outletId,
  onNavigateMenu,
}: BookingFlowModalProps) {
  const currentOrderType = useOrderStore((s) => s.orderType);
  const currentScheduledFor = useOrderStore((s) => s.scheduledFor);
  const currentGuestCount = useOrderStore((s) => s.guestCount);
  const storeSelectedTable = useOrderStore((s) => s.selectedTable);
  const activeOutletId = useOrderStore((s) => s.activeOutletId);

  const setBookingDetails = useOrderStore((s) => s.setBookingDetails);
  const clearBookingDetails = useOrderStore((s) => s.clearBookingDetails);

  // Local form state
  const [activeTab, setActiveTab] = useState<'DINE_IN' | 'PRE_BOOK_DINE_IN' | 'TAKEAWAY'>(
    currentOrderType || 'DINE_IN',
  );

  // Sync tab with store when opened
  useEffect(() => {
    if (isOpen) {
      setActiveTab(currentOrderType || 'DINE_IN');
    }
  }, [isOpen, currentOrderType]);

  // Pre-Book state
  const [guestCount, setGuestCountState] = useState<number>(currentGuestCount || 2);
  const [selectedDay, setSelectedDay] = useState<'today' | 'tomorrow'>('today');

  const targetDate = useMemo(() => {
    const d = new Date();
    if (selectedDay === 'tomorrow') {
      d.setDate(d.getDate() + 1);
    }
    return d;
  }, [selectedDay]);

  const availableSlots = useMemo(() => {
    return generateTimeSlots(targetDate, 30);
  }, [targetDate]);

  const [selectedSlotIso, setSelectedSlotIso] = useState<string>('');

  // Default to first slot if current is invalid
  useEffect(() => {
    if (availableSlots.length > 0) {
      if (!selectedSlotIso || !availableSlots.some((s) => s.iso === selectedSlotIso)) {
        setSelectedSlotIso(availableSlots[0]!.iso);
      }
    } else {
      setSelectedSlotIso('');
    }
  }, [availableSlots, selectedSlotIso]);

  // Table availability state
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [availabilityResult, setAvailabilityResult] = useState<AvailabilityResult | null>(null);

  const effectiveOutlet = outletId || activeOutletId || DEFAULT_DEV_OUTLET_ID;

  // Query table availability
  const checkTableAvailability = useCallback(
    async (iso: string, count: number) => {
      if (!iso || !effectiveOutlet) return;
      setIsCheckingAvailability(true);
      try {
        const res = await customerApiFetch('/api/v1/customer/reservations/check-availability', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outlet_id: effectiveOutlet,
            guest_count: count,
            reserved_for: iso,
            duration_minutes: 90,
          }),
        });
        if (res.ok) {
          const data: AvailabilityResult = await res.json();
          setAvailabilityResult(data);
        } else {
          setAvailabilityResult({
            available: false,
            tables: [],
            total_capacity: 0,
            guest_count: count,
            reserved_for: iso,
          });
        }
      } catch (err) {
        console.error('Error checking availability:', err);
        setAvailabilityResult(null);
      } finally {
        setIsCheckingAvailability(false);
      }
    },
    [effectiveOutlet],
  );

  useEffect(() => {
    if (isOpen && activeTab === 'PRE_BOOK_DINE_IN' && selectedSlotIso) {
      const timer = setTimeout(() => {
        void checkTableAvailability(selectedSlotIso, guestCount);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [isOpen, activeTab, selectedSlotIso, guestCount, checkTableAvailability]);

  // Takeaway Timing state
  const [takeawayTiming, setTakeawayTiming] = useState<'ASAP' | 'SCHEDULED'>('ASAP');
  const takeawaySlots = useMemo(() => {
    return generateTimeSlots(new Date(), 25);
  }, []);
  const [takeawayScheduledIso, setTakeawayScheduledIso] = useState<string>(
    takeawaySlots[0]?.iso || '',
  );

  if (!isOpen) return null;

  // Handle confirm actions
  const handleConfirmDineIn = () => {
    clearBookingDetails();
    showToast(`Dine-In active for Table ${storeSelectedTable}! 🍽️`);
    onClose();
  };

  const handleConfirmPreBook = () => {
    if (!availabilityResult?.available || availabilityResult.tables.length === 0) {
      showToast('Please select a time slot with an available table.');
      return;
    }
    const tableNumbers = availabilityResult.tables.map((t) => t.table_number);
    setBookingDetails({
      orderType: 'PRE_BOOK_DINE_IN',
      scheduledFor: selectedSlotIso,
      guestCount,
      allocatedTableNumbers: tableNumbers,
    });
    const timeFormatted = new Date(selectedSlotIso).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    showToast(`Table ${tableNumbers.join('+')} reserved for ${timeFormatted}! Pre-order dishes now 📅`);
    onClose();
    onNavigateMenu?.();
  };

  const handleConfirmTakeaway = () => {
    const isAsap = takeawayTiming === 'ASAP';
    const scheduledFor = isAsap ? null : takeawayScheduledIso;
    setBookingDetails({
      orderType: 'TAKEAWAY',
      scheduledFor,
      guestCount: 1,
      allocatedTableNumbers: [],
    });
    if (isAsap) {
      showToast('Takeaway (ASAP ~25 mins) selected! Order dishes for quick pickup 🛍️');
    } else {
      const timeFormatted = new Date(takeawayScheduledIso).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      showToast(`Takeaway scheduled for ${timeFormatted}! Order dishes for pickup 🛍️`);
    }
    onClose();
    onNavigateMenu?.();
  };

  const availFeedback = formatAvailabilityMessage(availabilityResult, guestCount);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-modal-title"
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
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '480px',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#0f172a',
          border: '1px solid rgba(251, 191, 36, 0.35)',
          borderRadius: '20px',
          padding: '24px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), 0 0 25px rgba(251, 191, 36, 0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          color: '#f8fafc',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Close */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 id="booking-modal-title" style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: '#fbbf24' }}>
              How would you like to dine?
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '0.82rem', color: '#94a3b8' }}>
              Dine-in at your table, book ahead, or pack to go.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.4rem',
              cursor: 'pointer',
              lineHeight: 1,
              padding: '4px 8px',
            }}
          >
            ✕
          </button>
        </div>

        {/* Omnichannel Mode Switcher Pill Bar */}
        <div
          role="tablist"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '6px',
            background: 'rgba(255, 255, 255, 0.04)',
            padding: '4px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <button
            role="tab"
            type="button"
            aria-selected={activeTab === 'DINE_IN'}
            onClick={() => setActiveTab('DINE_IN')}
            style={{
              padding: '10px 6px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.80rem',
              fontWeight: 700,
              cursor: 'pointer',
              background: activeTab === 'DINE_IN' ? 'linear-gradient(135deg, #10b981, #059669)' : 'transparent',
              color: activeTab === 'DINE_IN' ? '#000' : '#94a3b8',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>🪑</span>
            <span>Dine-In</span>
          </button>

          <button
            role="tab"
            type="button"
            aria-selected={activeTab === 'PRE_BOOK_DINE_IN'}
            onClick={() => setActiveTab('PRE_BOOK_DINE_IN')}
            style={{
              padding: '10px 6px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.80rem',
              fontWeight: 700,
              cursor: 'pointer',
              background: activeTab === 'PRE_BOOK_DINE_IN' ? 'linear-gradient(135deg, #fbbf24, #d97706)' : 'transparent',
              color: activeTab === 'PRE_BOOK_DINE_IN' ? '#000' : '#94a3b8',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>📅</span>
            <span>Pre-Book</span>
          </button>

          <button
            role="tab"
            type="button"
            aria-selected={activeTab === 'TAKEAWAY'}
            onClick={() => setActiveTab('TAKEAWAY')}
            style={{
              padding: '10px 6px',
              borderRadius: '8px',
              border: 'none',
              fontSize: '0.80rem',
              fontWeight: 700,
              cursor: 'pointer',
              background: activeTab === 'TAKEAWAY' ? 'linear-gradient(135deg, #38bdf8, #0284c7)' : 'transparent',
              color: activeTab === 'TAKEAWAY' ? '#000' : '#94a3b8',
              transition: 'all 0.15s ease',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span style={{ fontSize: '1.1rem' }}>🛍️</span>
            <span>Takeaway</span>
          </button>
        </div>

        {/* ── TAB 1: DINE IN NOW ── */}
        {activeTab === 'DINE_IN' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div
              style={{
                background: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.25)',
                borderRadius: '12px',
                padding: '16px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}
            >
              <span style={{ fontSize: '1.8rem' }}>🍽️</span>
              <div>
                <div style={{ fontSize: '0.90rem', fontWeight: 800, color: '#34d399' }}>
                  Live Dine-In at Table {storeSelectedTable}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>
                  Orders are prepared immediately in kitchen courses and served straight to your table.
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={handleConfirmDineIn}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                color: '#000',
                fontWeight: 800,
                fontSize: '0.95rem',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
              }}
            >
              Confirm Dine-In at Table {storeSelectedTable} →
            </button>
          </div>
        )}

        {/* ── TAB 2: PRE-BOOK & PRE-ORDER ── */}
        {activeTab === 'PRE_BOOK_DINE_IN' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Guest Count */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#e2e8f0' }}>Party Size</span>
                <span style={{ fontSize: '0.82rem', fontWeight: 800, color: '#fbbf24' }}>
                  {guestCount} {guestCount === 1 ? 'Guest' : 'Guests'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr) auto', gap: '6px' }}>
                {[2, 4, 6, 8].map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setGuestCountState(count)}
                    style={{
                      padding: '8px 4px',
                      borderRadius: '8px',
                      border: guestCount === count ? '1px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.1)',
                      background: guestCount === count ? 'rgba(251, 191, 36, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      color: guestCount === count ? '#fbbf24' : '#94a3b8',
                      fontSize: '0.78rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {count} Pax
                  </button>
                ))}
                {/* Stepper +/- */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <button
                    type="button"
                    onClick={() => setGuestCountState((c) => Math.max(1, c - 1))}
                    aria-label="Decrease guest count"
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: 'none',
                      color: '#fff',
                      fontSize: '1rem',
                      cursor: 'pointer',
                    }}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    onClick={() => setGuestCountState((c) => Math.min(24, c + 1))}
                    aria-label="Increase guest count"
                    style={{
                      width: '32px',
                      height: '32px',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: 'none',
                      color: '#fff',
                      fontSize: '1rem',
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Date Selection */}
            <div>
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: '8px' }}>
                Date & Time
              </span>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <button
                  type="button"
                  onClick={() => setSelectedDay('today')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: selectedDay === 'today' ? '1px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.1)',
                    background: selectedDay === 'today' ? 'rgba(251, 191, 36, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    color: selectedDay === 'today' ? '#fbbf24' : '#94a3b8',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDay('tomorrow')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: '8px',
                    border: selectedDay === 'tomorrow' ? '1px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.1)',
                    background: selectedDay === 'tomorrow' ? 'rgba(251, 191, 36, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    color: selectedDay === 'tomorrow' ? '#fbbf24' : '#94a3b8',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Tomorrow
                </button>
              </div>

              {/* Time Slots Chips (Horizontal scroll or wrapped grid) */}
              <div
                style={{
                  display: 'flex',
                  gap: '6px',
                  overflowX: 'auto',
                  paddingBottom: '6px',
                  scrollbarWidth: 'thin',
                }}
              >
                {availableSlots.length === 0 ? (
                  <div style={{ fontSize: '0.78rem', color: '#94a3b8', padding: '10px 0' }}>
                    No slots remaining for today. Please select tomorrow.
                  </div>
                ) : (
                  availableSlots.map((slot) => {
                    const isSelected = selectedSlotIso === slot.iso;
                    return (
                      <button
                        key={slot.iso}
                        type="button"
                        onClick={() => setSelectedSlotIso(slot.iso)}
                        style={{
                          flexShrink: 0,
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid #fbbf24' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: isSelected ? 'rgba(251, 191, 36, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                          color: isSelected ? '#fbbf24' : '#cbd5e1',
                          fontSize: '0.78rem',
                          fontWeight: isSelected ? 800 : 600,
                          cursor: 'pointer',
                        }}
                      >
                        {slot.label}
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {/* Live Availability Feedback Banner */}
            <div
              style={{
                background: isCheckingAvailability
                  ? 'rgba(255, 255, 255, 0.03)'
                  : availFeedback.isSuccess
                  ? 'rgba(16, 185, 129, 0.1)'
                  : 'rgba(239, 68, 68, 0.1)',
                border: isCheckingAvailability
                  ? '1px solid rgba(255, 255, 255, 0.1)'
                  : availFeedback.isSuccess
                  ? '1px solid rgba(16, 185, 129, 0.3)'
                  : '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '10px',
                padding: '10px 14px',
                fontSize: '0.80rem',
                color: isCheckingAvailability ? '#94a3b8' : availFeedback.isSuccess ? '#34d399' : '#f87171',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <span>{isCheckingAvailability ? '⏳' : availFeedback.isSuccess ? '✅' : '⚠️'}</span>
              <span>{isCheckingAvailability ? 'Checking live table availability...' : availFeedback.text}</span>
            </div>

            {/* Action CTA */}
            <button
              type="button"
              disabled={isCheckingAvailability || !availabilityResult?.available}
              onClick={handleConfirmPreBook}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background:
                  !availabilityResult?.available || isCheckingAvailability
                    ? 'rgba(255, 255, 255, 0.08)'
                    : 'linear-gradient(135deg, #fbbf24, #d97706)',
                color: !availabilityResult?.available || isCheckingAvailability ? '#64748b' : '#000',
                fontWeight: 800,
                fontSize: '0.95rem',
                border: 'none',
                cursor: !availabilityResult?.available || isCheckingAvailability ? 'not-allowed' : 'pointer',
                boxShadow: availabilityResult?.available ? '0 4px 14px rgba(251, 191, 36, 0.3)' : 'none',
              }}
            >
              Reserve & Pre-Order Menu →
            </button>
          </div>
        )}

        {/* ── TAB 3: TAKEAWAY ── */}
        {activeTab === 'TAKEAWAY' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {/* Takeaway Info Strip */}
            <div
              style={{
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '12px',
                padding: '14px',
                fontSize: '0.80rem',
                color: '#38bdf8',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
              }}
            >
              <span style={{ fontSize: '1.4rem' }}>🛍️</span>
              <div>
                <div style={{ fontWeight: 800 }}>Express Counter Pickup</div>
                <div style={{ color: '#94a3b8', fontSize: '0.74rem', marginTop: '2px' }}>
                  No table required. Your feast will be packed hot and ready at the front desk.
                </div>
              </div>
            </div>

            {/* Timing Options */}
            <div>
              <span style={{ fontSize: '0.84rem', fontWeight: 700, color: '#e2e8f0', display: 'block', marginBottom: '8px' }}>
                Pickup Time
              </span>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                <button
                  type="button"
                  onClick={() => setTakeawayTiming('ASAP')}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: takeawayTiming === 'ASAP' ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                    background: takeawayTiming === 'ASAP' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    color: takeawayTiming === 'ASAP' ? '#38bdf8' : '#94a3b8',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ⚡ ASAP (~25 mins)
                </button>
                <button
                  type="button"
                  onClick={() => setTakeawayTiming('SCHEDULED')}
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    borderRadius: '8px',
                    border: takeawayTiming === 'SCHEDULED' ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                    background: takeawayTiming === 'SCHEDULED' ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                    color: takeawayTiming === 'SCHEDULED' ? '#38bdf8' : '#94a3b8',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  ⏰ Schedule Pickup
                </button>
              </div>

              {/* Slot picker if SCHEDULED */}
              {takeawayTiming === 'SCHEDULED' && (
                <div
                  style={{
                    display: 'flex',
                    gap: '6px',
                    overflowX: 'auto',
                    paddingBottom: '6px',
                    scrollbarWidth: 'thin',
                  }}
                >
                  {takeawaySlots.map((slot) => {
                    const isSelected = takeawayScheduledIso === slot.iso;
                    return (
                      <button
                        key={slot.iso}
                        type="button"
                        onClick={() => setTakeawayScheduledIso(slot.iso)}
                        style={{
                          flexShrink: 0,
                          padding: '6px 12px',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid #38bdf8' : '1px solid rgba(255, 255, 255, 0.1)',
                          background: isSelected ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.03)',
                          color: isSelected ? '#38bdf8' : '#cbd5e1',
                          fontSize: '0.78rem',
                          fontWeight: isSelected ? 800 : 600,
                          cursor: 'pointer',
                        }}
                      >
                        {slot.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Action CTA */}
            <button
              type="button"
              onClick={handleConfirmTakeaway}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #38bdf8, #0284c7)',
                color: '#000',
                fontWeight: 800,
                fontSize: '0.95rem',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(56, 189, 248, 0.3)',
              }}
            >
              Continue to Takeaway Menu →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default BookingFlowModal;
