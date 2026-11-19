'use client';

import React, { useState, useEffect } from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { formatProfileInitials } from './layout-utils';

export interface TopNavBarProps {
  view?: 'home' | 'menu';
  restaurantName?: string;
  onNavigateView?: (view: 'home' | 'menu') => void;
  onOpenTableModal?: () => void;
  onOpenBookingModal?: () => void;
  onOpenFilterSheet?: () => void;
  onOpenOrdersHistory?: () => void;
  onOpenProfile?: () => void;
  onOpenCart?: () => void;
  activeFilterCount?: number;
  customerToken?: string | null;
  customerDisplayName?: string | null;
  cartPulse?: boolean;
  cartIconRef?: React.RefObject<HTMLButtonElement | null>;
  showToast?: (message: string) => void;
}

export const TopNavBar: React.FC<TopNavBarProps> = ({
  view = 'home',
  restaurantName = 'Royal Spice Bistro',
  onNavigateView,
  onOpenTableModal,
  onOpenBookingModal,
  onOpenFilterSheet,
  onOpenOrdersHistory,
  onOpenProfile,
  onOpenCart,
  activeFilterCount = 0,
  customerToken,
  customerDisplayName,
  cartPulse = false,
  cartIconRef,
  showToast,
}) => {
  // Read strictly from Zustand store
  const storeSelectedTable = useOrderStore((s) => s.selectedTable);
  const storeIsTableVerified = useOrderStore((s) => s.isTableVerified);
  const storeCartLines = useOrderStore((s) => s.cartLines);
  const storeCartItemCount = useOrderStore((s) => s.getCartItemCount());
  const storeActiveOrderCount = useOrderStore((s) => s.activeOrderCount);
  const storeOrderType = useOrderStore((s) => s.orderType);
  const storeAllocatedTables = useOrderStore((s) => s.allocatedTableNumbers);

  // Dispatchers from Zustand store
  const storeSetIsTableModalOpen = useOrderStore((s) => s.setIsTableModalOpen);
  const storeSetIsBookingModalOpen = useOrderStore((s) => s.setIsBookingModalOpen);
  const storeSetIsCartOpen = useOrderStore((s) => s.setIsCartOpen);
  const storeSetIsOrdersHistoryOpen = useOrderStore((s) => s.setIsOrdersHistoryOpen);
  const storeSetIsAuthModalOpen = useOrderStore((s) => s.setIsAuthModalOpen);

  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleBookingClick = () => {
    if (onOpenBookingModal) {
      onOpenBookingModal();
    } else {
      storeSetIsBookingModalOpen(true);
    }
  };

  const handleTableClick = () => {
    if (onOpenTableModal) {
      onOpenTableModal();
    } else {
      storeSetIsTableModalOpen(true);
    }
  };

  const handleCartClick = () => {
    if (onOpenCart) {
      onOpenCart();
    } else {
      storeSetIsCartOpen(true);
    }
  };

  const handleOrdersClick = () => {
    if (onOpenOrdersHistory) {
      onOpenOrdersHistory();
    } else {
      storeSetIsOrdersHistoryOpen(true);
    }
  };

  const handleProfileClick = () => {
    if (onOpenProfile) {
      onOpenProfile();
    } else {
      // If signed in or profile available, open profile; otherwise open auth
      storeSetIsAuthModalOpen(true);
    }
  };

  const handleBackToHome = () => {
    if (onNavigateView) {
      onNavigateView('home');
    }
  };

  // Safe display count (integer only)
  const cartItemCount = isMounted
    ? storeCartItemCount ?? storeCartLines.reduce((acc, c) => acc + c.quantity, 0)
    : 0;

  if (view === 'menu') {
    return (
      <header className="menu-top-nav-bar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            className="menu-back-btn"
            onClick={handleBackToHome}
            title="Return to Home Discovery Feed"
            aria-label="Back to home"
          >
            ←
          </button>
          <div>
            <div className="brand-title">{restaurantName}</div>
          </div>
        </div>

        <div className="nav-right-actions">
          {/* Filter Funnel Icon with Active Badge */}
          {onOpenFilterSheet && (
            <button
              type="button"
              className={`filter-funnel-btn ${activeFilterCount > 0 ? 'active' : ''}`}
              onClick={onOpenFilterSheet}
              title="Filter Menu Options"
              aria-label="Filter menu items"
            >
              <span>🌪️</span>
              {activeFilterCount > 0 && <span className="filter-funnel-badge">{activeFilterCount}</span>}
            </button>
          )}

          {/* Orders History Icon - Only shows badge for active dishes */}
          <button
            type="button"
            className="nav-icon-btn"
            onClick={handleOrdersClick}
            title="View Table Orders"
            aria-label="View active table orders"
          >
            <span>📋</span>
            {storeActiveOrderCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-3px',
                  right: '-3px',
                  background: '#10b981',
                  color: '#000',
                  borderRadius: '50%',
                  width: '16px',
                  height: '16px',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {storeActiveOrderCount}
              </span>
            )}
          </button>

          {/* Profile Icon */}
          <button
            type="button"
            className="nav-icon-btn"
            onClick={handleProfileClick}
            title={customerToken ? 'My Account & Preferences' : 'Dining Profiles & Sign In'}
            aria-label="My Account"
          >
            {customerToken ? (
              <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fbbf24' }}>
                {formatProfileInitials(customerDisplayName)}
              </span>
            ) : (
              <span>👤</span>
            )}
          </button>

          {/* Cart Icon (ALWAYS visible) */}
          <button
            ref={cartIconRef}
            type="button"
            className={`nav-icon-btn nav-cart-btn ${cartPulse ? 'cart-icon-pulse' : ''}`}
            onClick={handleCartClick}
            title="Shopping Cart"
            aria-label="View cart"
            suppressHydrationWarning
          >
            <span>🛒</span>
            {isMounted && cartItemCount > 0 && (
              <span className="cart-count-badge" suppressHydrationWarning>
                {cartItemCount}
              </span>
            )}
          </button>
        </div>
      </header>
    );
  }

  // Default 'home' view header
  return (
    <header className="top-nav-bar" style={{ margin: '0 -16px', padding: '10px 16px' }}>
      <div className="nav-left-brand">
        <div style={{ fontSize: '1.4rem' }}>👑</div>
        <div>
          <div className="brand-title">{restaurantName}</div>
        </div>
      </div>

      <div className="nav-right-actions">
        {/* Orders History Icon - Badge shows active placed plates */}
        <button
          type="button"
          className="nav-icon-btn"
          onClick={handleOrdersClick}
          title="View Table Orders"
          aria-label="View active table orders"
        >
          <span>📋</span>
          {storeActiveOrderCount > 0 && (
            <span
              style={{
                position: 'absolute',
                top: '-3px',
                right: '-3px',
                background: '#10b981',
                color: '#000',
                borderRadius: '50%',
                width: '16px',
                height: '16px',
                fontSize: '0.65rem',
                fontWeight: 800,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {storeActiveOrderCount}
            </span>
          )}
        </button>

        {/* Profile Icon */}
        <button
          type="button"
          className="nav-icon-btn"
          onClick={handleProfileClick}
          title={customerToken ? 'My Account & Preferences' : 'Dining Profiles & Sign In'}
          aria-label="My Account"
        >
          {customerToken ? (
            <span style={{ fontSize: '0.78rem', fontWeight: 800, color: '#fbbf24' }}>
              {customerDisplayName ? customerDisplayName.slice(0, 2).toUpperCase() : 'ME'}
            </span>
          ) : (
            <span>👤</span>
          )}
        </button>

        {/* Cart Icon (ALWAYS visible, independent of cart bar) */}
        <button
          ref={cartIconRef}
          type="button"
          className={`nav-icon-btn nav-cart-btn ${cartPulse ? 'cart-icon-pulse' : ''}`}
          onClick={handleCartClick}
          title="View Shopping Cart"
          aria-label="View cart"
          suppressHydrationWarning
        >
          <span>🛒</span>
          {isMounted && cartItemCount > 0 && (
            <span className="cart-count-badge" suppressHydrationWarning>
              {cartItemCount}
            </span>
          )}
        </button>
      </div>
    </header>
  );
};
