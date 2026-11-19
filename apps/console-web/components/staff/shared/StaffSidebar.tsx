'use client';

import React from 'react';
import {
  useStaffStore,
  ROLE_CONFIGS,
  type StaffDashboardView,
  type StaffTab,
} from '../../../store/useStaffStore';
import type { StaffMember } from '../../../app/lib/restaurant-db';

export interface StaffSidebarProps {
  currentRole?: StaffMember['role'];
  allowedTabs?: StaffTab[];
  allowedViews?: StaffDashboardView[];
  className?: string;
  style?: React.CSSProperties;
  /**
   * Layout format:
   * - 'bar': Tablet / handheld persistent navigation bar (.staff-bottom-nav)
   * - 'sidebar': Desktop vertical sidebar navigation panel
   */
  layout?: 'bar' | 'sidebar';
}

interface NavItemDef {
  id: StaffDashboardView;
  tabId: StaffTab;
  label: string;
  emoji: string;
  badge?: number | null;
  pulseBadge?: boolean;
}

export function StaffSidebar({
  currentRole: propRole,
  allowedTabs: propAllowedTabs,
  allowedViews: propAllowedViews,
  className,
  style,
  layout = 'bar',
}: StaffSidebarProps = {}) {
  const activeView = useStaffStore((s) => s.activeView);
  const activeTab = useStaffStore((s) => s.activeTab);
  const setActiveView = useStaffStore((s) => s.setActiveView);
  const storeRole = useStaffStore((s) => s.currentRole);

  const orders = useStaffStore((s) => s.orders);
  const tables = useStaffStore((s) => s.tables);
  const stock = useStaffStore((s) => s.stock);
  const calls = useStaffStore((s) => s.calls);

  // Compute live station alerts & queues
  const pendingOrdersCount = orders.filter(
    (o) => o.status === 'CONFIRMED' || o.status === 'PENDING_APPROVAL',
  ).length;
  const readyOrdersCount = orders.reduce(
    (sum, o) => sum + o.items.filter((it) => it.status === 'READY').length,
    0,
  );
  const stockOffCount = stock.filter((i) => !i.isAvailable).length;
  const pendingCallsCount = calls.filter((c) => c.status === 'PENDING').length;

  const effectiveRole = propRole || storeRole || 'CAPTAIN';
  const roleConfig = ROLE_CONFIGS[effectiveRole] || ROLE_CONFIGS.CAPTAIN;
  const effectiveAllowedTabs = propAllowedTabs || roleConfig.allowedTabs;

  const isTabAllowed = (tab: StaffTab, view: StaffDashboardView): boolean => {
    if (propAllowedViews && propAllowedViews.includes(view)) return true;
    return effectiveAllowedTabs.includes(tab);
  };

  const navItems: NavItemDef[] = [
    {
      id: 'KDS',
      tabId: 'ORDERS',
      label: 'Kitchen KDS',
      emoji: '🍳',
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : null,
      pulseBadge: false,
    },
    {
      id: 'FLOOR',
      tabId: 'TABLES',
      label: `Tables (${tables.length})`,
      emoji: '🪑',
    },
    {
      id: 'WAITER',
      tabId: 'PASS',
      label: `Food Pass${readyOrdersCount > 0 ? ` (${readyOrdersCount})` : ''}`,
      emoji: '🍽️',
      badge: readyOrdersCount > 0 ? readyOrdersCount : null,
      pulseBadge: true,
    },
    {
      id: 'STOCK',
      tabId: 'STOCK',
      label: `86 Stock (${stockOffCount} off)`,
      emoji: '📋',
    },
    {
      id: 'MENU',
      tabId: 'MENU',
      label: 'Menu Editor',
      emoji: '🍴',
    },
    {
      id: 'CALLS',
      tabId: 'CALLS',
      label: 'Bells',
      emoji: '🔔',
      badge: pendingCallsCount > 0 ? pendingCallsCount : null,
      pulseBadge: true,
    },
    {
      id: 'CASHIER',
      tabId: 'POS',
      label: 'Cashier / POS',
      emoji: '💳',
    },
  ];

  const visibleItems = navItems.filter((item) => isTabAllowed(item.tabId, item.id));

  const isItemActive = (item: NavItemDef): boolean => {
    if (item.id === 'CASHIER') {
      return (
        activeView === 'CASHIER' ||
        activeTab === 'POS' ||
        activeTab === 'MORE'
      );
    }
    return activeView === item.id || activeTab === item.tabId;
  };

  if (layout === 'sidebar') {
    return (
      <aside
        className={`staff-sidebar-nav ${className || ''}`}
        style={{
          width: '240px',
          background: 'rgba(15, 23, 42, 0.96)',
          borderRight: '1px solid var(--border-light)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          padding: '16px 12px',
          height: '100%',
          overflowY: 'auto',
          ...style,
        }}
        aria-label="Staff Workstation Navigation"
      >
        <div style={{ padding: '8px 10px 14px', borderBottom: '1px solid var(--border-light)', marginBottom: '8px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 800, color: 'var(--accent-cyan)', letterSpacing: '0.04em' }}>
            {roleConfig.stationBadge}
          </div>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f8fafc', marginTop: '2px' }}>
            {roleConfig.stationTitle}
          </div>
        </div>

        {visibleItems.map((item) => {
          const active = isItemActive(item);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveView(item.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px 14px',
                borderRadius: 'var(--radius-sm)',
                border: active ? '1px solid rgba(6, 182, 212, 0.4)' : '1px solid transparent',
                background: active ? 'rgba(6, 182, 212, 0.12)' : 'transparent',
                color: active ? 'var(--accent-cyan)' : 'var(--text-secondary)',
                fontWeight: active ? 800 : 600,
                fontSize: '0.86rem',
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
                position: 'relative',
                transition: 'all 0.15s ease',
              }}
            >
              <span style={{ fontSize: '18px' }}>{item.emoji}</span>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge !== null && item.badge !== undefined && (
                <span
                  className={`nav-badge-count ${item.pulseBadge ? 'pulse-glow' : ''}`}
                  style={{ position: 'static' }}
                >
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </aside>
    );
  }

  return (
    <nav
      className={`staff-bottom-nav ${className || ''}`}
      style={style}
      aria-label="Staff Workstation Navigation"
    >
      {visibleItems.map((item) => {
        const active = isItemActive(item);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveView(item.id)}
            className={`staff-nav-item ${active ? 'active' : ''}`}
          >
            <span style={{ fontSize: '20px', position: 'relative' }}>
              {item.emoji}
              {item.badge !== null && item.badge !== undefined && (
                <span className={`nav-badge-count ${item.pulseBadge ? 'pulse-glow' : ''}`}>
                  {item.badge}
                </span>
              )}
            </span>
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export default StaffSidebar;
