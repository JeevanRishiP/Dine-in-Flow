'use client';

import React from 'react';
import { useOrderStore } from '../../store/useOrderStore';
import { formatOrderTrackerSubtitle } from './layout-utils';

export interface OrderTrackerBannerProps {
  count?: number;
  tableNumber?: string;
  onViewOrders?: () => void;
  alwaysShow?: boolean;
  variant?: 'banner' | 'card';
  style?: React.CSSProperties;
}

export const OrderTrackerBanner: React.FC<OrderTrackerBannerProps> = ({
  count: propCount,
  tableNumber: propTable,
  onViewOrders,
  alwaysShow = false,
  variant = 'banner',
  style,
}) => {
  const storeTable = useOrderStore((s) => s.selectedTable);
  const storeActiveOrderCount = useOrderStore((s) => s.activeOrderCount);
  const storeSetIsOrdersHistoryOpen = useOrderStore((s) => s.setIsOrdersHistoryOpen);

  const effectiveCount = propCount !== undefined ? propCount : storeActiveOrderCount;
  const effectiveTable = propTable || storeTable;

  if (effectiveCount <= 0 && !alwaysShow) {
    return null;
  }

  const handleClick = () => {
    if (onViewOrders) {
      onViewOrders();
    } else {
      storeSetIsOrdersHistoryOpen(true);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  const isCardVariant = variant === 'card';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className="active-order-tracker-banner"
      aria-label={`View active orders for Table ${effectiveTable}: ${effectiveCount} items cooking or served`}
      style={{
        background: isCardVariant
          ? 'linear-gradient(135deg, rgba(255, 255, 255, 0.04), rgba(255, 255, 255, 0.02))'
          : 'linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(5, 150, 105, 0.08) 100%)',
        border: isCardVariant
          ? '1px solid rgba(255, 255, 255, 0.09)'
          : '1px solid rgba(16, 185, 129, 0.35)',
        borderRadius: '14px',
        padding: isCardVariant ? '14px 16px' : '12px 14px',
        margin: isCardVariant ? '0' : '10px 0 14px 0',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: isCardVariant ? 'none' : '0 4px 16px rgba(16, 185, 129, 0.12)',
        ...style,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'rgba(16, 185, 129, 0.22)',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            flexShrink: 0,
          }}
        >
          {effectiveCount > 0 ? '🍳' : '📋'}
        </div>
        <div>
          <div
            style={{
              fontSize: '0.88rem',
              fontWeight: 800,
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <span>Table {effectiveTable} Orders</span>
            {effectiveCount > 0 && (
              <span
                style={{
                  display: 'inline-block',
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: '#10b981',
                  boxShadow: '0 0 8px #10b981',
                }}
              />
            )}
          </div>
          <div style={{ fontSize: '0.74rem', color: effectiveCount > 0 ? '#34d399' : '#94a3b8', fontWeight: 600 }}>
            {formatOrderTrackerSubtitle(effectiveCount)}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {effectiveCount > 0 && (
          <span
            style={{
              background: '#10b981',
              color: '#000',
              borderRadius: '999px',
              padding: '2px 8px',
              fontSize: '0.72rem',
              fontWeight: 800,
              boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
            }}
          >
            {effectiveCount}
          </span>
        )}
        <span style={{ color: '#94a3b8', fontSize: '1.1rem' }}>→</span>
      </div>
    </div>
  );
};
