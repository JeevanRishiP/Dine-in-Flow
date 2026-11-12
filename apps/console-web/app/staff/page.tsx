'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  OUTLETS,
  ALL_STAFF_MEMBERS,
  getStoredOutlets,
  getStoredStaff,
  getBranchData,
  formatPaise,
  formatOrderDateTime,
  deriveOrderStatusFromItems,
  getLoggedInUser,
  type Outlet,
  type StaffMember,
  type Order,
  type OrderItem,
  type Table,
  type TableSession,
  type MenuItem,
  type ServiceCall,
} from '../lib/restaurant-db';
import {
  getConsoleAuthState,
  loginStaffRemote,
  verifyStaffMfaRemote,
  logoutStaffRemote,
  consoleAuthFetch,
  isAuthStateExpired,
} from '../lib/auth-client';

type StaffTab = 'ORDERS' | 'TABLES' | 'PASS' | 'STOCK' | 'CALLS' | 'POS' | 'MORE';

interface RoleWorkstationConfig {
  defaultTab: StaffTab;
  allowedTabs: StaffTab[];
  stationTitle: string;
  stationBadge: string;
  stationEmoji: string;
  stationDescription: string;
}

const ROLE_CONFIGS: Record<StaffMember['role'], RoleWorkstationConfig> = {
  KITCHEN: {
    defaultTab: 'ORDERS',
    allowedTabs: ['ORDERS', 'STOCK'],
    stationTitle: 'Kitchen Display System (KDS)',
    stationBadge: '🍳 KITCHEN WORKSTATION',
    stationEmoji: '🍳',
    stationDescription: 'Live ticket prep queue & 86 stock availability',
  },
  CAPTAIN: {
    defaultTab: 'TABLES',
    allowedTabs: ['TABLES', 'PASS', 'CALLS'],
    stationTitle: 'Floor Captain & Seating Station',
    stationBadge: '🪑 FLOOR & SERVICE',
    stationEmoji: '👨‍💼',
    stationDescription: 'Table seating map, guest sessions & service bells',
  },
  WAITER: {
    defaultTab: 'PASS',
    allowedTabs: ['PASS', 'TABLES', 'CALLS'],
    stationTitle: 'Food Pass & Table Delivery',
    stationBadge: '🤵 TABLE SERVER',
    stationEmoji: '🤵',
    stationDescription: 'Pick up ready dishes, deliver to tables & attend bells',
  },
  CASHIER: {
    defaultTab: 'POS',
    allowedTabs: ['POS', 'TABLES'],
    stationTitle: 'Cashier Register & Billing Station',
    stationBadge: '💳 FINANCE & POS',
    stationEmoji: '👩‍💼',
    stationDescription: 'Payment collection (UPI/Cash/Card), GST invoices & settlement',
  },
  MANAGER: {
    defaultTab: 'TABLES',
    allowedTabs: ['ORDERS', 'TABLES', 'PASS', 'STOCK', 'CALLS', 'POS'],
    stationTitle: 'Floor Operations Cockpit',
    stationBadge: '👔 GENERAL MANAGER',
    stationEmoji: '👔',
    stationDescription: 'Full multi-station access across Kitchen, Floor, Pass, and POS',
  },
  OWNER: {
    defaultTab: 'TABLES',
    allowedTabs: ['ORDERS', 'TABLES', 'PASS', 'STOCK', 'CALLS', 'POS'],
    stationTitle: 'Executive Floor Operations',
    stationBadge: '👑 GROUP OWNER',
    stationEmoji: '👑',
    stationDescription: 'Complete organizational oversight across all floor stations',
  },
};

export default function StaffWebApp() {
  const router = useRouter();

  // Outlet Selection State (Stored & dynamically created by Owner)
  const [outletsList, setOutletsList] = useState<Outlet[]>(() =>
    typeof window !== 'undefined' ? getStoredOutlets() : OUTLETS
  );
  const [selectedOutletId, setSelectedOutletId] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const stored = getStoredOutlets();
      return stored[0]?.id ?? OUTLETS[0]!.id;
    }
    return OUTLETS[0]!.id;
  });
  const currentOutlet = outletsList.find((o) => o.id === selectedOutletId) ?? outletsList[0] ?? OUTLETS[0]!;

  // Staff User State (Stored & dynamically assigned by Owner)
  const [staffList, setStaffList] = useState<StaffMember[]>(() =>
    typeof window !== 'undefined' ? getStoredStaff() : ALL_STAFF_MEMBERS
  );
  const branchData = getBranchData(selectedOutletId);

  const [currentUser, setCurrentUser] = useState<StaffMember | null>(() => {
    if (typeof window !== 'undefined') {
      const state = getConsoleAuthState();
      if (state && !isAuthStateExpired(state, 0)) {
        return getLoggedInUser();
      }
    }
    return null;
  });

  const [isOwnerMode, setIsOwnerMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return getConsoleAuthState()?.user.role === 'OWNER';
    }
    return false;
  });

  const [ownerViewRole, setOwnerViewRole] = useState<StaffMember['role'] | null>(null);

  // Authentication Guard: Ensure a valid server-issued JWT session exists (never accept ?role= bypass)
  useEffect(() => {
    const state = getConsoleAuthState();
    const user = getLoggedInUser();
    if (!state || !user) {
      router.push('/');
      return;
    }
    setCurrentUser(user);
    setIsOwnerMode(state.user.role === 'OWNER');
    if (user.outletId) {
      setSelectedOutletId(user.outletId);
    }
  }, [router]);

  const [isLocked, setIsLocked] = useState(false);
  const [lockMfaToken, setLockMfaToken] = useState('');
  const [lockMfaCode, setLockMfaCode] = useState('');
  const [pinError, setPinError] = useState('');
  const [staffLoginUser, setStaffLoginUser] = useState('');
  const [staffLoginPass, setStaffLoginPass] = useState('');
  const [showStaffPass, setShowStaffPass] = useState(false);
  const [showSwitchUserModal, setShowSwitchUserModal] = useState(false);

  // Active Role Configuration (Owners may preview station views within their own OWNER JWT)
  const currentRole =
    isOwnerMode && ownerViewRole ? ownerViewRole : currentUser?.role || 'CAPTAIN';
  const roleConfig = ROLE_CONFIGS[currentRole] || ROLE_CONFIGS.CAPTAIN;

  // Sync stored outlets and staff when updated by Owner
  useEffect(() => {
    const handleDataSync = () => {
      setOutletsList(getStoredOutlets());
      setStaffList(getStoredStaff());
    };
    window.addEventListener('dineflow-data-updated', handleDataSync);
    window.addEventListener('storage', handleDataSync);
    return () => {
      window.removeEventListener('dineflow-data-updated', handleDataSync);
      window.removeEventListener('storage', handleDataSync);
    };
  }, []);

  // Connection & Sync State
  const [connectionStatus, setConnectionStatus] = useState<'live' | 'degraded' | 'offline'>('live');

  // Navigation Tabs: ORDERS (KDS), TABLES (Floor Map), PASS (Food Pass), STOCK (86 Item Toggles), CALLS (Bells), POS (Cashier / POS)
  const [activeTab, setActiveTab] = useState<StaffTab>(() => {
    const role = currentUser?.role || 'CAPTAIN';
    return (ROLE_CONFIGS[role] || ROLE_CONFIGS.CAPTAIN).defaultTab;
  });

  // Guard active tab to ensure the staff member only views allowed stations for their role
  useEffect(() => {
    if (!currentUser) return;
    const config = ROLE_CONFIGS[currentRole] || ROLE_CONFIGS.CAPTAIN;
    if (!config.allowedTabs.includes(activeTab)) {
      setActiveTab(config.defaultTab);
    }
  }, [currentRole, currentUser?.id]);

  const [moreSubTab, setMoreSubTab] = useState<'PAYMENTS' | 'STAFF' | 'SETTINGS'>('PAYMENTS');

  // Branch Live State (Initialized from restaurant-db for the selected branch)
  const [orders, setOrders] = useState<Order[]>(branchData.activeOrders);
  const [tables, setTables] = useState<Table[]>(branchData.tables);
  const [sessions, setSessions] = useState<TableSession[]>(branchData.sessions);
  const [stock, setStock] = useState<MenuItem[]>(branchData.menuItems);
  const [calls, setCalls] = useState<ServiceCall[]>(branchData.serviceCalls);

  // Live Database Orders Sync
  const fetchLiveOrders = async () => {
    try {
      const res = await consoleAuthFetch(
        `/api/v1/console/orders?outlet_id=${encodeURIComponent(selectedOutletId)}`,
      );
      if (res.status === 401) {
        setConnectionStatus('offline');
        setIsLocked(true);
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const defaultActive = getBranchData(selectedOutletId).activeOrders;
        const liveOrders: Order[] = (Array.isArray(data) ? data : []).map((d: any) => {
          const frontendStatus: Order['status'] =
            d.status === 'PENDING' ? 'PENDING_APPROVAL' : (d.status as Order['status']);
          return {
            id: d.id,
            displayId: 'ORD-#' + d.id.slice(-4).toUpperCase(),
            outletId: d.outlet_id || selectedOutletId,
            tableNumber: d.table_number || 'T04',
            sessionId: d.session_id,
            status: frontendStatus,
            subtotalPaise: d.subtotal_paise,
            taxPaise: d.tax_paise,
            discountPaise: d.discount_paise || 0,
            totalPaise: d.total_paise,
            createdAt: formatOrderDateTime(d.created_at),
            items: (d.items || []).map((it: any) => ({
              id: it.id,
              orderId: d.id,
              itemId: it.menu_item_id,
              name: it.name_snapshot,
              pricePaise: it.unit_price_paise,
              quantity: it.quantity,
              status: it.status,
              notes: it.notes,
              createdAt: formatOrderDateTime(it.created_at || d.created_at),
            })),
            events: [
              {
                id: 'evt-init-' + d.id,
                orderId: d.id,
                previousStatus: 'CREATED',
                newStatus: d.status,
                actorName: 'Guest / Kitchen',
                createdAt: formatOrderDateTime(d.created_at),
              },
            ],
            needsAck: d.status === 'PENDING',
            specialInstructions: d.notes || d.items?.find((i: any) => i.notes)?.notes,
            paymentMethod: 'UPI',
          };
        });

        const combined = [
          ...liveOrders,
          ...defaultActive.filter((bo) => !liveOrders.some((lo) => lo.id === bo.id)),
        ];

        const ordersWithOverrides = combined.map((o) => {
          const itemOverrides = localItemStatusOverrides.current[o.id];
          const updatedItems = o.items.map((it) => {
            const ov = itemOverrides?.[it.id];
            return {
              ...it,
              status: ov ?? it.status,
              createdAt: it.createdAt || o.createdAt,
            };
          });
          const statusOverride = localStatusOverrides.current[o.id];
          const derived = itemOverrides
            ? deriveOrderStatusFromItems(updatedItems, statusOverride ?? o.status)
            : statusOverride ?? o.status;
          return { ...o, status: derived, items: updatedItems };
        });

        setOrders(ordersWithOverrides);
        setConnectionStatus('live');
      }
    } catch {
      setConnectionStatus('degraded');
    }
  };

  // Sync state whenever outlet switches & poll live orders feed every 3 seconds
  useEffect(() => {
    const data = getBranchData(selectedOutletId);
    setOrders(data.activeOrders);
    setTables(data.tables);
    setSessions(data.sessions);
    setStock(data.menuItems);
    setCalls(data.serviceCalls);

    fetchLiveOrders();
    const interval = setInterval(fetchLiveOrders, 3000);
    return () => clearInterval(interval);
  }, [selectedOutletId]);

  // Filters & Views
  const [selectedSection, setSelectedSection] = useState<'ALL' | 'Main Dining Hall' | 'Verandah / Terrace' | 'Family Lounge'>('ALL');
  const [stockSearch, setStockSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'MY_TABLES'>('ALL');

  // Modals & Drawers
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [collectPaymentOrder, setCollectPaymentOrder] = useState<Order | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'DIRECT_UPI' | 'CASH' | 'CARD'>('DIRECT_UPI');
  const [cashGiven, setCashGiven] = useState('');
  const [directUpiRef, setDirectUpiRef] = useState('');

  // Audio state - Muted by default so NO ping/chime sound on login
  const [isSoundMuted, setIsSoundMuted] = useState(true);
  const isInitialMount = useRef(true);
  const localStatusOverrides = useRef<Record<string, Order['status']>>({});
  const localItemStatusOverrides = useRef<Record<string, Record<string, OrderItem['status']>>>({});

  // Audio synthesize chime for orders and service bells
  const playAlertChime = () => {
    if (isSoundMuted) return;
    try {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioContextClass();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.65);
    } catch {
      // Audio autoplay policy fallback
    }
  };

  // Sound repeat alert loop for unacknowledged orders or bells (NEVER fires on login/mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (isSoundMuted) return;

    const unackedCount = orders.filter((o) => o.needsAck).length + calls.filter((c) => c.status === 'PENDING').length;
    if (unackedCount > 0) {
      playAlertChime();
      const interval = setInterval(() => {
        playAlertChime();
      }, 15000);
      return () => clearInterval(interval);
    }
  }, [orders, calls, isSoundMuted]);

  // Auto-lock idle timer (3 minutes)
  const lastActiveRef = useRef<number>(Date.now());
  useEffect(() => {
    const handleTouch = () => {
      lastActiveRef.current = Date.now();
    };
    window.addEventListener('touchstart', handleTouch);
    window.addEventListener('mousedown', handleTouch);
    window.addEventListener('keydown', handleTouch);

    const lockInterval = setInterval(() => {
      if (!isLocked && Date.now() - lastActiveRef.current > 180000) {
        setIsLocked(true);
      }
    }, 15000);

    return () => {
      window.removeEventListener('touchstart', handleTouch);
      window.removeEventListener('mousedown', handleTouch);
      window.removeEventListener('keydown', handleTouch);
      clearInterval(lockInterval);
    };
  }, [isLocked]);

  // Sign out handler: Clears server session + local state and redirects to common login
  const handleSignOut = async () => {
    await logoutStaffRemote();
    router.push('/');
  };

  // Owner station view preview (keeps real OWNER JWT; never spoofs another user's token)
  const handleOwnerSwitchUser = (targetStaff: StaffMember) => {
    if (!isOwnerMode) return;
    setOwnerViewRole(targetStaff.role);
    if (targetStaff.outletId) {
      setSelectedOutletId(targetStaff.outletId);
    }
    const uConfig = ROLE_CONFIGS[targetStaff.role] || ROLE_CONFIGS.CAPTAIN;
    setActiveTab(uConfig.defaultTab);
    setShowSwitchUserModal(false);
    setPinError('');
  };

  // Handle server-verified Staff Email + Password (+ MFA) unlock on Lock Screen
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const state = getConsoleAuthState();
    const orgSlug = state?.user.orgSlug || '';
    const emailToVerify = (staffLoginUser || state?.user.email || '').trim().toLowerCase();

    if (!orgSlug) {
      await logoutStaffRemote();
      router.push('/');
      return;
    }

    if (lockMfaToken) {
      const mfaResult = await verifyStaffMfaRemote({
        preMfaToken: lockMfaToken,
        code: lockMfaCode,
        orgSlug,
        email: emailToVerify,
      });
      if (!mfaResult.ok || !mfaResult.session) {
        setPinError(mfaResult.error || 'Invalid authenticator code.');
        return;
      }
      setIsLocked(false);
      setLockMfaToken('');
      setLockMfaCode('');
      setStaffLoginPass('');
      setPinError('');
      return;
    }

    if (!emailToVerify || !staffLoginPass) {
      setPinError('Please enter your staff email and password.');
      return;
    }

    // Prevent switching accounts from a locked non-owner terminal without explicit Sign Out
    if (!isOwnerMode && state?.user.email && emailToVerify !== state.user.email.toLowerCase()) {
      setPinError(`Please unlock as ${state.user.email} or Sign Out to switch staff.`);
      return;
    }

    const authResult = await loginStaffRemote({
      orgSlug,
      email: emailToVerify,
      password: staffLoginPass,
    });
    if (!authResult.ok) {
      setPinError(authResult.error || 'Invalid email or password.');
      return;
    }
    if (authResult.requiresMfa && authResult.preMfaToken) {
      setLockMfaToken(authResult.preMfaToken);
      setLockMfaCode('');
      setPinError('');
      return;
    }

    const updated = getLoggedInUser();
    if (updated) {
      setCurrentUser(updated);
      setIsOwnerMode(authResult.session?.user.role === 'OWNER');
      if (updated.outletId) {
        setSelectedOutletId(updated.outletId);
      }
    }
    setIsLocked(false);
    setPinError('');
    setStaffLoginPass('');
  };

  // Order state transitions with PostgreSQL DB Persistence
  const transitionOrder = async (orderId: string, nextStatus: Order['status'], customReason?: string) => {
    // Record in local overrides to ensure immediate persistent state during live polling
    localStatusOverrides.current[orderId] = nextStatus;

    // 1. Optimistic UI update
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === orderId) {
          const updatedItems =
            nextStatus === 'PREPARING' || nextStatus === 'READY' || nextStatus === 'SERVED'
              ? o.items.map((it) => (it.status === 'CANCELLED' ? it : { ...it, status: nextStatus }))
              : o.items;
          return {
            ...o,
            status: nextStatus,
            items: updatedItems,
            needsAck: false,
            events: [
              ...o.events,
              {
                id: 'evt-' + Date.now(),
                orderId: o.id,
                previousStatus: o.status,
                newStatus: nextStatus,
                actorName: currentUser ? `${currentUser.name} (${currentUser.role})` : 'Staff',
                createdAt: 'Just now',
              },
            ],
          };
        }
        return o;
      })
    );
    if (selectedOrder?.id === orderId) {
      setSelectedOrder((prev) => (prev ? { ...prev, status: nextStatus, needsAck: false } : null));
    }

    // 2. Persist directly to PostgreSQL database via authenticated backend API
    try {
      const apiStatus = nextStatus === 'PENDING_APPROVAL' ? 'PENDING' : nextStatus;
      const res = await consoleAuthFetch(`/api/v1/console/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: apiStatus,
          reason: customReason || (nextStatus === 'CANCELLED' ? 'Order cancelled' : undefined),
        }),
      });
      if (res.ok) {
        delete localStatusOverrides.current[orderId];
        delete localItemStatusOverrides.current[orderId];
        fetchLiveOrders();
      } else if (res.status === 401) {
        setIsLocked(true);
      } else if (res.status !== 404) {
        delete localStatusOverrides.current[orderId];
        fetchLiveOrders();
      }
    } catch (err) {
      console.error('Failed to persist status transition in database:', err);
    }
  };

  // Item-wise KDS transition: moves a single order_item to the next status without touching other items.
  const transitionItem = async (orderId: string, itemId: string, nextStatus: 'PREPARING' | 'READY' | 'SERVED') => {
    const existingOrder = orders.find((o) => o.id === orderId);
    const updatedOrderItems = existingOrder
      ? existingOrder.items.map((it) => (it.id === itemId ? { ...it, status: nextStatus } : it))
      : [];
    const nextDerivedStatus = existingOrder
      ? deriveOrderStatusFromItems(updatedOrderItems, existingOrder.status)
      : undefined;

    localItemStatusOverrides.current[orderId] = {
      ...(localItemStatusOverrides.current[orderId] ?? {}),
      [itemId]: nextStatus,
    };
    if (nextDerivedStatus) {
      localStatusOverrides.current[orderId] = nextDerivedStatus;
    }

    // Optimistic UI: update just the specific item's status inside the matching order
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updatedItems = o.items.map((it) =>
          it.id === itemId ? { ...it, status: nextStatus } : it
        );
        const derivedStatus = deriveOrderStatusFromItems(updatedItems, o.status);
        return { ...o, status: derivedStatus, items: updatedItems };
      })
    );
    // Persist to DB via authenticated item-status endpoint
    try {
      const res = await consoleAuthFetch(`/api/v1/console/orders/${orderId}/items/${itemId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        if (localItemStatusOverrides.current[orderId]) {
          delete localItemStatusOverrides.current[orderId]![itemId];
          if (Object.keys(localItemStatusOverrides.current[orderId]!).length === 0) {
            delete localItemStatusOverrides.current[orderId];
            delete localStatusOverrides.current[orderId];
          }
        }
        fetchLiveOrders();
      } else if (res.status === 401) {
        setIsLocked(true);
      } else if (res.status !== 404) {
        // Real DB failure (e.g. invalid transition): revert optimistic override
        if (localItemStatusOverrides.current[orderId]) {
          delete localItemStatusOverrides.current[orderId]![itemId];
        }
        delete localStatusOverrides.current[orderId];
        console.error('Item transition failed with status:', res.status);
        fetchLiveOrders();
      }
    } catch (err) {
      console.error('Failed to persist item status transition:', err);
    }
  };

  // Shared per-item row renderer: puts the proceed button directly next to each item name
  const renderKdsOrderItems = (order: Order, qtyColor = 'var(--accent-cyan)') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
      {order.items.map((item) => {
        const isPendingOrConfirmed = !item.status || item.status === 'PENDING' || item.status === 'CONFIRMED';
        const isPreparing = item.status === 'PREPARING';
        const isReady = item.status === 'READY';
        const isServed = item.status === 'SERVED';

        return (
          <div
            key={item.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px',
              padding: '8px 10px',
              borderRadius: '8px',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.07)',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap', fontSize: '0.88rem' }}>
                <span style={{ fontWeight: 800, color: qtyColor }}>
                  {item.quantity}×
                </span>
                <span style={{ fontWeight: 700 }}>{item.name}</span>
                {currentUser?.role !== 'KITCHEN' && (
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                    ({formatPaise(item.pricePaise * item.quantity)})
                  </span>
                )}
              </div>
              {item.notes && (
                <div style={{ fontSize: '0.74rem', color: 'var(--accent-amber)', marginTop: '2px' }}>
                  ↳ Note: {item.notes}
                </div>
              )}
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '3px' }}>
                🕒 {item.createdAt || order.createdAt}
              </div>
            </div>

            <div style={{ flexShrink: 0 }}>
              {isPendingOrConfirmed && (
                <button
                  type="button"
                  onClick={() => transitionItem(order.id, item.id, 'PREPARING')}
                  className="btn-primary"
                  style={{
                    padding: '6px 10px',
                    fontSize: '0.76rem',
                    fontWeight: 800,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                  }}
                >
                  <span>🍳 Start Cooking</span>
                  <span>→</span>
                </button>
              )}

              {isPreparing && (
                <button
                  type="button"
                  onClick={() => transitionItem(order.id, item.id, 'READY')}
                  style={{
                    background: 'linear-gradient(135deg, #10b981, #059669)',
                    color: '#fff',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    fontWeight: 800,
                    fontSize: '0.76rem',
                    border: 'none',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span>🍽️ Plated &amp; Ready</span>
                  <span>→</span>
                </button>
              )}

              {isReady && (
                currentUser?.role === 'KITCHEN' ? (
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '5px 8px',
                      borderRadius: '6px',
                      background: 'rgba(16, 185, 129, 0.14)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#10b981',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    ✓ On Pass
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => transitionItem(order.id, item.id, 'SERVED')}
                    className="btn-success"
                    style={{
                      padding: '6px 10px',
                      fontSize: '0.76rem',
                      fontWeight: 800,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>🏃 Served</span>
                    <span>✓</span>
                  </button>
                )
              )}

              {isServed && (
                <span
                  style={{
                    display: 'inline-block',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    background: 'rgba(16, 185, 129, 0.15)',
                    color: '#10b981',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ✓ Served
                </span>
              )}

              {item.status === 'CANCELLED' && (
                <span
                  style={{
                    display: 'inline-block',
                    padding: '5px 8px',
                    borderRadius: '6px',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#f87171',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    whiteSpace: 'nowrap',
                  }}
                >
                  ✕ Cancelled
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  // Stock availability toggle
  const toggleStockItem = (itemId: string) => {
    setStock((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, isAvailable: !item.isAvailable } : item))
    );
  };

  // Waiter Call actions
  const acknowledgeCall = (callId: string) => {
    setCalls((prev) =>
      prev.map((c) => (c.id === callId ? { ...c, status: 'ACKNOWLEDGED' } : c))
    );
  };

  const resolveCall = (callId: string) => {
    setCalls((prev) => prev.filter((c) => c.id !== callId));
  };

  // Unread badge counts
  const pendingOrdersCount = orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'PENDING_APPROVAL').length;
  const readyOrdersCount = orders.filter((o) => o.status === 'READY').length;
  const pendingCallsCount = calls.filter((c) => c.status === 'PENDING').length;

  return (
    <div className="staff-shell">
      {/* ========================================================
          PERSISTENT TOP APP BAR
          ======================================================== */}
      <header className="staff-topbar">
        {/* Left: Brand & Branch Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Link
            href="/"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div
              style={{
                width: '36px',
                height: '36px',
                background: 'linear-gradient(135deg, #06b6d4, #3b82f6)',
                borderRadius: '10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                boxShadow: 'var(--shadow-cyan)',
              }}
            >
              ⚡
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1rem', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '6px' }}>
                DineFlow <span style={{ color: 'var(--accent-cyan)', fontSize: '0.75rem', fontWeight: 700, background: 'rgba(6,182,212,0.15)', padding: '2px 6px', borderRadius: '4px' }}>FLOOR</span>
              </div>
            </div>
          </Link>

          {/* OUTLET / BRANCH SWITCHER DROPDOWN */}
          <div style={{ position: 'relative' }}>
            <select
              value={selectedOutletId}
              onChange={(e) => setSelectedOutletId(e.target.value)}
              style={{
                background: 'rgba(15, 23, 42, 0.85)',
                color: '#f8fafc',
                border: '1px solid rgba(6, 182, 212, 0.4)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              {outletsList.map((outlet) => (
                <option key={outlet.id} value={outlet.id} style={{ background: '#0f172a', color: '#f8fafc' }}>
                  📍 {outlet.shortName || outlet.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Center: Live Station Indicators & Workstation Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
          {/* Active Workstation Badge */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'rgba(6, 182, 212, 0.1)',
              border: '1px solid rgba(6, 182, 212, 0.35)',
              padding: '4px 12px',
              borderRadius: '999px',
            }}
          >
            <span style={{ fontSize: '14px' }}>{roleConfig.stationEmoji}</span>
            <span style={{ fontSize: '0.76rem', fontWeight: 800, color: 'var(--accent-cyan)', letterSpacing: '0.02em' }}>
              {roleConfig.stationBadge}
            </span>
          </div>

          {/* Manager / Owner Station Switcher Pill */}
          {(currentUser?.role === 'MANAGER' || currentUser?.role === 'OWNER') && (
            <div
              style={{
                display: 'flex',
                gap: '2px',
                background: 'rgba(255, 255, 255, 0.05)',
                padding: '3px',
                borderRadius: '8px',
                border: '1px solid var(--border-light)',
              }}
            >
              {[
                { id: 'ORDERS', label: '🍳 Kitchen' },
                { id: 'TABLES', label: '🪑 Floor' },
                { id: 'PASS', label: `🍽️ Pass${readyOrdersCount > 0 ? ` (${readyOrdersCount})` : ''}` },
                { id: 'STOCK', label: '📋 Stock' },
                { id: 'CALLS', label: '🔔 Bells' },
                { id: 'POS', label: '💳 POS' },
              ].map((st) => (
                <button
                  key={st.id}
                  onClick={() => setActiveTab(st.id as StaffTab)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    border: 'none',
                    fontSize: '0.72rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    background: activeTab === st.id ? 'var(--accent-cyan)' : 'transparent',
                    color: activeTab === st.id ? '#000' : 'var(--text-secondary)',
                  }}
                >
                  {st.label}
                </button>
              ))}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '7px',
              background: 'rgba(255, 255, 255, 0.04)',
              padding: '5px 12px',
              borderRadius: '999px',
              border: '1px solid var(--border-light)',
            }}
          >
            <div className={`connection-dot ${connectionStatus}`} />
            <span style={{ fontSize: '0.76rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
              {connectionStatus === 'live' ? 'WebSocket Live' : 'Polling Sync'}
            </span>
          </div>

          {/* Sound Mute/Unmute Toggle Button */}
          <button
            onClick={() => setIsSoundMuted((prev) => !prev)}
            title={isSoundMuted ? 'Sound is Muted. Click to enable sound alerts' : 'Sound is Active. Click to mute'}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: isSoundMuted ? 'rgba(255, 255, 255, 0.05)' : 'rgba(16, 185, 129, 0.15)',
              border: `1px solid ${isSoundMuted ? 'var(--border-light)' : 'rgba(16, 185, 129, 0.3)'}`,
              borderRadius: '999px',
              padding: '4px 10px',
              color: isSoundMuted ? 'var(--text-secondary)' : '#10b981',
              fontSize: '0.76rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <span>{isSoundMuted ? '🔕 Muted' : '🔔 Sound'}</span>
          </button>

          {/* Food Pass alert pill for Captain / Waiter */}
          {readyOrdersCount > 0 && roleConfig.allowedTabs.includes('PASS') && (
            <button
              onClick={() => setActiveTab('PASS')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(16, 185, 129, 0.2)',
                border: '1px solid #10b981',
                color: '#fff',
                padding: '4px 10px',
                borderRadius: '999px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              className="pulse-glow"
            >
              🍽️ {readyOrdersCount} on Pass
            </button>
          )}

          {calls.length > 0 && roleConfig.allowedTabs.includes('CALLS') && (
            <button
              onClick={() => setActiveTab('CALLS')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: 'rgba(244, 63, 94, 0.2)',
                border: '1px solid var(--accent-rose)',
                color: '#fff',
                padding: '4px 12px',
                borderRadius: '999px',
                fontSize: '0.78rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
              className="pulse-glow"
            >
              🔔 {calls.length} Table Bell{calls.length > 1 ? 's' : ''}
            </button>
          )}
        </div>

        {/* Right: Staff Identity & PIN Quick-Lock */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isOwnerMode ? (
            <button
              onClick={() => setShowSwitchUserModal(true)}
              title="Executive Owner: Click to switch staff accounts without logging out"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(245, 158, 11, 0.12)',
                border: '1.5px solid #f59e0b',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                color: '#f8fafc',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontSize: '18px' }}>{currentUser?.avatar || '👤'}</span>
              <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 800 }}>{currentUser?.name || 'Staff User'}</div>
                <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700 }}>
                  👑 OWNER · {currentUser?.role || 'CAPTAIN'}
                </div>
              </div>
              <span style={{ fontSize: '10px', color: '#f59e0b' }}>▼</span>
            </button>
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid var(--border-light)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 12px',
                color: '#f8fafc',
              }}
            >
              <span style={{ fontSize: '18px' }}>{currentUser?.avatar || '👤'}</span>
              <div style={{ textAlign: 'left', lineHeight: 1.2 }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 700 }}>{currentUser?.name || 'Staff User'}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--accent-cyan)', fontWeight: 600 }}>
                  {currentUser?.role || 'CAPTAIN'}
                </div>
              </div>
            </div>
          )}

          {isOwnerMode && (
            <Link
              href="/owner"
              title="Return to Owner Executive Cockpit"
              style={{
                background: 'rgba(6, 182, 212, 0.12)',
                border: '1px solid rgba(6, 182, 212, 0.3)',
                borderRadius: 'var(--radius-sm)',
                padding: '7px 11px',
                color: 'var(--accent-cyan)',
                fontSize: '12px',
                fontWeight: 700,
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              👑 Owner Portal
            </Link>
          )}

          <button
            onClick={() => setIsLocked(true)}
            title="Lock Console (Require PIN)"
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid var(--border-light)',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 11px',
              color: 'var(--text-secondary)',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            🔒 Lock
          </button>

          <button
            onClick={handleSignOut}
            title="Sign Out of Station"
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: 'var(--radius-sm)',
              padding: '7px 11px',
              color: '#f87171',
              fontSize: '13px',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
            }}
          >
            🚪 Sign Out
          </button>
        </div>
      </header>

      {/* ========================================================
          MAIN APP CONTENT CONTAINER
          ======================================================== */}
      <main style={{ paddingBottom: '80px', minHeight: 'calc(100vh - 64px)' }}>
        {/* Branch 2 & 3 Blank Outlet Banner */}
        {!branchData.isPopulated && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.12)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.3)',
              padding: '12px 24px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              color: '#fcd34d',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>ℹ️</span>
              <div>
                <strong>Blank Restaurant Branch: {currentOutlet.name}</strong>
                <div style={{ fontSize: '0.8rem', color: '#fef3c7' }}>
                  This outlet has blank child tables. Switch to <strong>Indiranagar Flagship</strong> to view populated tables, orders, and sessions.
                </div>
              </div>
            </div>
            <button
              onClick={() => setSelectedOutletId('b0000000-0000-0000-0000-000000000001')}
              style={{
                background: 'var(--accent-amber)',
                color: '#000',
                padding: '6px 14px',
                borderRadius: 'var(--radius-sm)',
                fontWeight: 700,
                fontSize: '0.82rem',
              }}
            >
              Switch to Indiranagar Flagship
            </button>
          </div>
        )}

        {/* TAB 1: KITCHEN DISPLAY SYSTEM (KDS) */}
        {activeTab === 'ORDERS' && (
          <div style={{ padding: '20px 24px' }}>
            {/* Top Toolbar */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                  Kitchen Display & Order Management
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Live tickets for {currentOutlet.shortName} · Auto-sorted by urgency
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div
                  style={{
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px',
                    display: 'flex',
                    gap: '4px',
                  }}
                >
                  <button
                    onClick={() => setOrderFilter('ALL')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '4px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      background: orderFilter === 'ALL' ? 'var(--accent-cyan)' : 'transparent',
                      color: orderFilter === 'ALL' ? '#000' : 'var(--text-secondary)',
                    }}
                  >
                    All Orders ({orders.length})
                  </button>
                  <button
                    onClick={() => setOrderFilter('MY_TABLES')}
                    style={{
                      padding: '6px 14px',
                      borderRadius: '4px',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      background: orderFilter === 'MY_TABLES' ? 'var(--accent-cyan)' : 'transparent',
                      color: orderFilter === 'MY_TABLES' ? '#000' : 'var(--text-secondary)',
                    }}
                  >
                    Captain Assigned
                  </button>
                </div>
              </div>
            </div>

            {/* Empty State for Blank Branches */}
            {orders.length === 0 ? (
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1.5px dashed var(--border-light)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '60px 20px',
                  textAlign: 'center',
                  maxWidth: '600px',
                  margin: '40px auto',
                }}
              >
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🍳</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
                  No Active Orders in {currentOutlet.shortName}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>
                  Orders placed by customers at table QR codes will appear in real-time on this kitchen screen with audio chimes.
                </p>
                <button
                  onClick={() => setSelectedOutletId('b0000000-0000-0000-0000-000000000001')}
                  className="btn-primary"
                >
                  View Active Orders in Indiranagar Flagship
                </button>
              </div>
            ) : (
              /* KDS Columns: CONFIRMED / PENDING -> PREPARING -> READY -> RECENTLY SERVED */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: '20px',
                }}
              >
                {/* Column 1: New / Confirmed Orders */}
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-light)',
                    padding: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '14px',
                      paddingBottom: '8px',
                      borderBottom: '1px solid var(--border-light)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#3b82f6' }} />
                      <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>NEW / CONFIRMED</span>
                    </div>
                    <span className="status-chip chip-blue">
                      {orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'PENDING_APPROVAL').length}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {orders
                      .filter((o) => o.status === 'CONFIRMED' || o.status === 'PENDING_APPROVAL')
                      .map((order) => (
                        <div
                          key={order.id}
                          className="kds-order-ticket"
                          style={{
                            borderLeft: order.unverifiedGuest ? '4px solid var(--accent-amber)' : '4px solid #3b82f6',
                          }}
                        >
                          {/* Ticket Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                style={{
                                  background: 'var(--accent-cyan)',
                                  color: '#000',
                                  fontWeight: 900,
                                  fontSize: '0.9rem',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                }}
                              >
                                {order.tableNumber}
                              </span>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{order.displayId}</span>
                            </div>
                            <span style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>🕒 {order.createdAt}</span>
                          </div>

                          {/* Unverified Guest Alert Banner */}
                          {order.unverifiedGuest && (
                            <div
                              style={{
                                background: 'rgba(245, 158, 11, 0.15)',
                                border: '1px solid rgba(245, 158, 11, 0.3)',
                                borderRadius: '6px',
                                padding: '6px 10px',
                                marginBottom: '10px',
                                fontSize: '0.75rem',
                                color: '#fcd34d',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                              }}
                            >
                              ⚠️ Unverified walk-in guest — Captain confirm table
                            </div>
                          )}

                          {/* Line Items with inline Proceed buttons */}
                          {renderKdsOrderItems(order, 'var(--accent-cyan)')}

                          {/* Special Instructions */}
                          {order.specialInstructions && (
                            <div
                              style={{
                                fontSize: '0.76rem',
                                background: 'rgba(255, 255, 255, 0.04)',
                                padding: '6px 8px',
                                borderRadius: '4px',
                                color: 'var(--text-secondary)',
                              }}
                            >
                              💬 &quot;{order.specialInstructions}&quot;
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>

                {/* Column 2: In Kitchen / Preparing */}
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-light)',
                    padding: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '14px',
                      paddingBottom: '8px',
                      borderBottom: '1px solid var(--border-light)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: 'var(--accent-amber)' }} />
                      <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>PREPARING IN KITCHEN</span>
                    </div>
                    <span className="status-chip chip-amber">
                      {orders.filter((o) => o.status === 'PREPARING' || o.items.some((it) => it.status === 'PREPARING')).length}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {orders
                      .filter((o) => o.status === 'PREPARING' || o.items.some((it) => it.status === 'PREPARING'))
                      .map((order) => (
                        <div
                          key={order.id}
                          className="kds-order-ticket"
                          style={{ borderLeft: '4px solid var(--accent-amber)' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                style={{
                                  background: 'var(--accent-amber)',
                                  color: '#000',
                                  fontWeight: 900,
                                  fontSize: '0.9rem',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                }}
                              >
                                {order.tableNumber}
                              </span>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{order.displayId}</span>
                            </div>
                            <span style={{ fontSize: '0.73rem', color: 'var(--accent-amber)', fontWeight: 700 }}>
                              🔥 Cooking · 🕒 {order.createdAt}
                            </span>
                          </div>

                          {renderKdsOrderItems(order, 'var(--accent-cyan)')}
                        </div>
                      ))}
                  </div>
                </div>

                {/* Column 3: Ready on Pass */}
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-light)',
                    padding: '16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: '14px',
                      paddingBottom: '8px',
                      borderBottom: '1px solid var(--border-light)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
                      <span style={{ fontWeight: 800, fontSize: '0.95rem' }}>READY ON PASS</span>
                    </div>
                    <span className="status-chip chip-green">
                      {orders.filter((o) => o.status === 'READY').length}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                    {orders
                      .filter((o) => o.status === 'READY')
                      .map((order) => (
                        <div
                          key={order.id}
                          className="kds-order-ticket pulse-glow"
                          style={{ borderLeft: '4px solid #10b981' }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span
                                style={{
                                  background: '#10b981',
                                  color: '#000',
                                  fontWeight: 900,
                                  fontSize: '0.9rem',
                                  padding: '2px 8px',
                                  borderRadius: '6px',
                                }}
                              >
                                {order.tableNumber}
                              </span>
                              <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{order.displayId}</span>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                              <div style={{ fontSize: '0.73rem', color: '#10b981', fontWeight: 800 }}>
                                ✓ PLATED &amp; HOT
                              </div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                🕒 {order.createdAt}
                              </div>
                            </div>
                          </div>

                          {renderKdsOrderItems(order, '#10b981')}

                          {/* Role footer: Kitchen waits for runner; floor roles can bulk-serve or settle */}
                          {currentUser?.role === 'KITCHEN' ? (
                            <div
                              style={{
                                width: '100%',
                                padding: '10px 12px',
                                background: 'rgba(16, 185, 129, 0.15)',
                                border: '1px solid rgba(16, 185, 129, 0.3)',
                                borderRadius: 'var(--radius-sm)',
                                color: '#10b981',
                                fontSize: '0.82rem',
                                fontWeight: 700,
                                textAlign: 'center',
                              }}
                            >
                              ✓ Plated on Pass · Waiting for Runner
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                              {order.items.filter((it) => it.status === 'READY').length === 0 && (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <button
                                    onClick={() => transitionOrder(order.id, 'SERVED')}
                                    className="btn-success"
                                    style={{ flex: 1, padding: '9px 12px', fontSize: '0.82rem' }}
                                  >
                                    🏃 All Delivered & Served
                                  </button>
                                  <button
                                    onClick={() => { setCollectPaymentOrder(order); }}
                                    style={{
                                      background: 'rgba(6, 182, 212, 0.15)',
                                      color: 'var(--accent-cyan)',
                                      border: '1px solid rgba(6, 182, 212, 0.4)',
                                      borderRadius: 'var(--radius-sm)',
                                      padding: '9px 12px',
                                      fontSize: '0.82rem',
                                      fontWeight: 700,
                                    }}
                                  >
                                    💳 Settle
                                  </button>
                                </div>
                              )}
                              {order.items.filter((it) => it.status === 'READY').length > 0 && (
                                <button
                                  onClick={() => { setCollectPaymentOrder(order); }}
                                  style={{
                                    background: 'rgba(6, 182, 212, 0.1)',
                                    color: 'var(--accent-cyan)',
                                    border: '1px solid rgba(6, 182, 212, 0.3)',
                                    borderRadius: 'var(--radius-sm)',
                                    padding: '7px 12px',
                                    fontSize: '0.78rem',
                                    fontWeight: 700,
                                    width: '100%',
                                    cursor: 'pointer',
                                  }}
                                >
                                  💳 Collect Payment
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB: FOOD PASS & EXPEDITER (CAPTAIN & WAITER SERVICE) */}
        {activeTab === 'PASS' && (
          <div style={{ padding: '20px 24px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '20px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🍽️ Food Pass &amp; Expediter Station
                </h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Dishes plated &amp; hot from kitchen · Pick up and deliver to guests at tables
                </p>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <span
                  style={{
                    background: readyOrdersCount > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: readyOrdersCount > 0 ? '#10b981' : 'var(--text-muted)',
                    border: `1px solid ${readyOrdersCount > 0 ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-light)'}`,
                    padding: '6px 14px',
                    borderRadius: '999px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                  }}
                  className={readyOrdersCount > 0 ? 'pulse-glow' : ''}
                >
                  ⚡ {readyOrdersCount} Ticket{readyOrdersCount === 1 ? '' : 's'} Waiting on Pass
                </span>
              </div>
            </div>

            {/* Ready Tickets Grid */}
            {readyOrdersCount === 0 ? (
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1.5px dashed var(--border-light)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '50px 20px',
                  textAlign: 'center',
                  maxWidth: '560px',
                  margin: '30px auto',
                }}
              >
                <div style={{ fontSize: '44px', marginBottom: '14px' }}>✨</div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '6px' }}>
                  Food Pass is Clear
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.86rem' }}>
                  All prepared dishes have been delivered to guests. As soon as the kitchen marks an order &quot;Ready for Pickup&quot;, it will appear right here with destination table details.
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                  gap: '20px',
                  marginBottom: '32px',
                }}
              >
                {orders
                  .filter((o) => o.status === 'READY')
                  .map((order) => (
                    <div
                      key={order.id}
                      className="kds-order-ticket pulse-glow"
                      style={{
                        borderLeft: '5px solid #10b981',
                        background: 'rgba(15, 23, 42, 0.85)',
                        boxShadow: '0 8px 24px rgba(16, 185, 129, 0.15)',
                      }}
                    >
                      {/* Ticket Header */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span
                            style={{
                              background: '#10b981',
                              color: '#000',
                              fontWeight: 900,
                              fontSize: '1rem',
                              padding: '3px 10px',
                              borderRadius: '6px',
                            }}
                          >
                            Table {order.tableNumber}
                          </span>
                          <span style={{ fontWeight: 800, fontSize: '0.9rem' }}>{order.displayId}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.76rem', color: '#10b981', fontWeight: 800 }}>
                            🔥 PLATED &amp; HOT
                          </div>
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                            🕒 {order.createdAt}
                          </div>
                        </div>
                      </div>

                      {/* Items to Deliver with inline Served buttons */}
                      {renderKdsOrderItems(order, '#10b981')}

                      {/* Special instructions */}
                      {order.specialInstructions && (
                        <div
                          style={{
                            fontSize: '0.76rem',
                            background: 'rgba(255, 255, 255, 0.04)',
                            padding: '6px 8px',
                            borderRadius: '4px',
                            marginBottom: '14px',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          💬 &quot;{order.specialInstructions}&quot;
                        </div>
                      )}

                      {/* Bulk fallback if order is READY with no individual READY items */}
                      {order.items.filter((it) => it.status === 'READY').length === 0 && (
                        <button
                          onClick={() => transitionOrder(order.id, 'SERVED')}
                          style={{
                            width: '100%',
                            background: 'linear-gradient(135deg, #10b981, #059669)',
                            color: '#fff',
                            padding: '12px',
                            borderRadius: 'var(--radius-sm)',
                            fontWeight: 900,
                            fontSize: '0.92rem',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                          }}
                        >
                          🏃 All Delivered & Served to Table {order.tableNumber}
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}

            {/* Recently Served Section */}
            {orders.filter((o) => o.status === 'SERVED').length > 0 && (
              <div style={{ marginTop: '20px' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 800, marginBottom: '12px', color: 'var(--text-secondary)' }}>
                  ✅ Recently Served Orders
                </h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                  {orders
                    .filter((o) => o.status === 'SERVED')
                    .slice(0, 6)
                    .map((o) => (
                      <div
                        key={o.id}
                        style={{
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid var(--border-light)',
                          borderRadius: '8px',
                          padding: '12px 14px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: '10px',
                        }}
                      >
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>{o.tableNumber}</span>
                            <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{o.displayId}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>🕒 {o.createdAt}</span>
                          </div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                            {o.items.map((it) => `${it.quantity}× ${it.name}`).join(', ')}
                          </div>
                        </div>
                        <span className="status-chip chip-green" style={{ fontSize: '0.7rem' }}>
                          SERVED
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TABLE FLOOR MAP */}
        {activeTab === 'TABLES' && (
          <div style={{ padding: '20px 24px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Restaurant Floor Plan</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  {currentOutlet.name} · {tables.length} Tables Configured
                </p>
              </div>

              {/* Section Filters */}
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {(['ALL', 'Main Dining Hall', 'Verandah / Terrace', 'Family Lounge'] as const).map((sec) => (
                  <button
                    key={sec}
                    onClick={() => setSelectedSection(sec)}
                    style={{
                      padding: '6px 14px',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      background: selectedSection === sec ? 'var(--accent-cyan)' : 'var(--bg-surface)',
                      color: selectedSection === sec ? '#000' : 'var(--text-secondary)',
                      border: '1px solid var(--border-light)',
                    }}
                  >
                    {sec === 'ALL' ? 'All Sections' : sec}
                  </button>
                ))}
              </div>
            </div>

            {tables.length === 0 ? (
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1.5px dashed var(--border-light)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '60px 20px',
                  textAlign: 'center',
                  maxWidth: '600px',
                  margin: '40px auto',
                }}
              >
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>🪑</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
                  No Tables Configured in {currentOutlet.shortName}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>
                  This branch has zero tables in the database. Use the Owner Cockpit to add dining zones, table numbers, and generate QR codes.
                </p>
                <button
                  onClick={() => setSelectedOutletId('b0000000-0000-0000-0000-000000000001')}
                  className="btn-primary"
                >
                  View Floor Map in Indiranagar Flagship
                </button>
              </div>
            ) : (
              /* Floor Grid of 12 Tables */
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                  gap: '16px',
                }}
              >
                {tables
                  .filter((t) => selectedSection === 'ALL' || t.section === selectedSection)
                  .map((table) => {
                    const session = sessions.find((s) => s.tableId === table.id && s.status === 'OPEN');
                    const activeOrder = orders.find((o) => o.tableNumber === table.number);
                    const isOccupied = !!session;

                    return (
                      <div
                        key={table.id}
                        onClick={() => setSelectedTable(table)}
                        style={{
                          background: isOccupied ? 'rgba(30, 41, 59, 0.9)' : 'var(--bg-card)',
                          border: isOccupied ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-card)',
                          borderRadius: 'var(--radius-md)',
                          padding: '18px',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          minHeight: '160px',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div>
                            <span
                              style={{
                                fontSize: '1.3rem',
                                fontWeight: 900,
                                color: isOccupied ? 'var(--accent-cyan)' : '#f8fafc',
                              }}
                            >
                              {table.number}
                            </span>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                              {table.section} · Cap {table.capacity}
                            </div>
                          </div>
                          <span
                            className={`status-chip ${
                              activeOrder?.status === 'READY'
                                ? 'chip-green'
                                : isOccupied
                                ? 'chip-blue'
                                : 'chip-purple'
                            }`}
                          >
                            {activeOrder?.status === 'READY'
                              ? 'READY'
                              : isOccupied
                              ? `${session.guestCount} GUESTS`
                              : 'AVAILABLE'}
                          </span>
                        </div>

                        {session ? (
                          <div style={{ marginTop: '12px' }}>
                            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                              ⏱ Seated {session.openedAt}
                            </div>
                            {activeOrder && (
                              <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--accent-amber)', marginTop: '4px' }}>
                                Order {activeOrder.displayId} · {formatPaise(activeOrder.totalPaise)}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '12px' }}>
                            Ready for walk-in or QR scan
                          </div>
                        )}

                        <div
                          style={{
                            marginTop: '14px',
                            paddingTop: '10px',
                            borderTop: '1px solid var(--border-light)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            Token v{table.qrTokenVersion}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--accent-cyan)', fontWeight: 700 }}>
                            Manage Table →
                          </span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: 86 STOCK AVAILABILITY MANAGEMENT */}
        {activeTab === 'STOCK' && (
          <div style={{ padding: '20px 24px' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '18px',
                flexWrap: 'wrap',
                gap: '12px',
              }}
            >
              <div>
                <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>86 Item & Stock Availability</h2>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                  Instantly toggle items out-of-stock across customer QR digital menus
                </p>
              </div>

              <input
                type="text"
                placeholder="Search dishes or categories..."
                value={stockSearch}
                onChange={(e) => setStockSearch(e.target.value)}
                style={{
                  background: 'var(--bg-surface)',
                  color: '#fff',
                  border: '1px solid var(--border-light)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '8px 14px',
                  width: '260px',
                  fontSize: '0.85rem',
                }}
              />
            </div>

            {stock.length === 0 ? (
              <div
                style={{
                  background: 'var(--bg-card)',
                  border: '1.5px dashed var(--border-light)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '60px 20px',
                  textAlign: 'center',
                  maxWidth: '600px',
                  margin: '40px auto',
                }}
              >
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>📋</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '8px' }}>
                  No Menu Configured in {currentOutlet.shortName}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '24px' }}>
                  Menu items can be created or cloned from Indiranagar Flagship in the Owner Cockpit.
                </p>
                <button
                  onClick={() => setSelectedOutletId('b0000000-0000-0000-0000-000000000001')}
                  className="btn-primary"
                >
                  Manage Stock in Indiranagar Flagship
                </button>
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: '16px',
                }}
              >
                {stock
                  .filter(
                    (item) =>
                      stockSearch === '' ||
                      item.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
                      item.categoryName.toLowerCase().includes(stockSearch.toLowerCase())
                  )
                  .map((item) => (
                    <div
                      key={item.id}
                      style={{
                        background: item.isAvailable ? 'var(--bg-card)' : 'rgba(244, 63, 94, 0.08)',
                        border: item.isAvailable ? '1px solid var(--border-card)' : '1.5px solid var(--accent-rose)',
                        borderRadius: 'var(--radius-md)',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <span
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              color: item.vegType === 'VEG' ? '#10b981' : item.vegType === 'VEGAN' ? '#06b6d4' : '#f43f5e',
                            }}
                          >
                            ● {item.vegType}
                          </span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{item.categoryName}</span>
                        </div>

                        <div style={{ fontWeight: 800, fontSize: '0.98rem', marginTop: '6px' }}>{item.name}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{item.nameHindi}</div>
                        <div style={{ fontSize: '0.95rem', fontWeight: 800, color: 'var(--accent-cyan)', marginTop: '8px' }}>
                          {formatPaise(item.pricePaise)}
                        </div>
                      </div>

                      <div
                        style={{
                          marginTop: '16px',
                          paddingTop: '12px',
                          borderTop: '1px solid var(--border-light)',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: item.isAvailable ? '#10b981' : 'var(--accent-rose)' }}>
                          {item.isAvailable ? `In Stock (${item.stockCount ?? '∞'})` : '86 OUT OF STOCK'}
                        </span>

                        <button
                          onClick={() => toggleStockItem(item.id)}
                          style={{
                            background: item.isAvailable ? 'rgba(244, 63, 94, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                            color: item.isAvailable ? 'var(--accent-rose)' : '#10b981',
                            border: `1px solid ${item.isAvailable ? 'var(--accent-rose)' : '#10b981'}`,
                            padding: '6px 12px',
                            borderRadius: 'var(--radius-sm)',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                          }}
                        >
                          {item.isAvailable ? 'Mark 86' : 'Restore Item'}
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: TABLE CALL BELLS */}
        {activeTab === 'CALLS' && (
          <div style={{ padding: '20px 24px', maxWidth: '800px', margin: '0 auto' }}>
            <div style={{ marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Table Service Requests</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                Audible table call requests from guests dining in {currentOutlet.shortName}
              </p>
            </div>

            {calls.length === 0 ? (
              <div
                style={{
                  background: 'var(--bg-card)',
                  borderRadius: 'var(--radius-lg)',
                  padding: '60px 20px',
                  textAlign: 'center',
                  border: '1px solid var(--border-card)',
                }}
              >
                <div style={{ fontSize: '48px', marginBottom: '16px' }}>✨</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '6px' }}>All Tables Attended</h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  No pending waiter calls or payment requests right now.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {calls.map((call) => (
                  <div
                    key={call.id}
                    style={{
                      background: 'var(--bg-card)',
                      border: '1.5px solid var(--accent-rose)',
                      borderRadius: 'var(--radius-md)',
                      padding: '18px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      boxShadow: 'var(--shadow-glow)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div
                        style={{
                          width: '48px',
                          height: '48px',
                          background: 'rgba(244, 63, 94, 0.2)',
                          color: 'var(--accent-rose)',
                          borderRadius: '12px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 900,
                          fontSize: '1.2rem',
                        }}
                      >
                        {call.table}
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{call.reason}</div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                          Alerted 4 mins ago · Table in {tables.find((t) => t.number === call.table)?.section || 'Dining Room'}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      {call.status === 'PENDING' ? (
                        <button
                          onClick={() => acknowledgeCall(call.id)}
                          style={{
                            background: 'var(--accent-amber)',
                            color: '#000',
                            padding: '8px 16px',
                            borderRadius: 'var(--radius-sm)',
                            fontWeight: 800,
                            fontSize: '0.82rem',
                          }}
                        >
                          Acknowledge
                        </button>
                      ) : (
                        <button
                          onClick={() => resolveCall(call.id)}
                          className="btn-success"
                          style={{ padding: '8px 16px', fontSize: '0.82rem' }}
                        >
                          ✓ Resolve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: MORE / CASHIER & POS SETTLEMENT */}
        {(activeTab === 'POS' || activeTab === 'MORE') && (
          <div style={{ padding: '20px 24px', maxWidth: '1000px', margin: '0 auto' }}>
            {/* Sub-nav */}
            <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
              {(['PAYMENTS', 'STAFF', 'SETTINGS'] as const).map((sub) => (
                <button
                  key={sub}
                  onClick={() => setMoreSubTab(sub)}
                  style={{
                    padding: '8px 18px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    fontWeight: 800,
                    background: moreSubTab === sub ? 'var(--accent-cyan)' : 'var(--bg-surface)',
                    color: moreSubTab === sub ? '#000' : 'var(--text-secondary)',
                    border: '1px solid var(--border-light)',
                  }}
                >
                  {sub === 'PAYMENTS' ? '💳 Cashier & POS Settle' : sub === 'STAFF' ? '👥 Staff Directory' : '⚙️ Station Settings'}
                </button>
              ))}
            </div>

            {moreSubTab === 'PAYMENTS' && (
              <div>
                <div style={{ marginBottom: '20px' }}>
                  <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Daily Cashier Settle & Reconciliation</h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                    Record payments for {currentOutlet.name}
                  </p>
                </div>

                <div className="owner-metric-grid" style={{ marginBottom: '24px' }}>
                  <div className="owner-metric-card">
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                      TODAY&apos;S BILLED SALES
                    </span>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--accent-cyan)', marginTop: '4px' }}>
                      {formatPaise(branchData.payments.reduce((acc, p) => acc + p.amountPaise, 0))}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      {branchData.payments.length} settled transactions
                    </span>
                  </div>

                  <div className="owner-metric-card">
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                      UPI DIRECT TO RESTAURANT
                    </span>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: '#10b981', marginTop: '4px' }}>
                      {formatPaise(branchData.payments.filter((p) => p.method === 'UPI' || p.method === 'DIRECT_UPI_STAFF').reduce((acc, p) => acc + p.amountPaise, 0))}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: '#10b981', marginTop: '4px' }}>
                      Zero gateway MDR deduction
                    </span>
                  </div>

                  <div className="owner-metric-card">
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', fontWeight: 700 }}>
                      CASH DRAWER TILL
                    </span>
                    <div style={{ fontSize: '1.8rem', fontWeight: 900, color: 'var(--accent-amber)', marginTop: '4px' }}>
                      {formatPaise(branchData.payments.filter((p) => p.method === 'CASH').reduce((acc, p) => acc + p.amountPaise, 0))}
                    </div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                      Ready for shift closing count
                    </span>
                  </div>
                </div>

                {/* Settle Table list */}
                <div className="data-table-container">
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', fontWeight: 800 }}>
                    Settled Transactions Log (Today)
                  </div>
                  {branchData.payments.length === 0 ? (
                    <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
                      No payments recorded yet for this outlet today.
                    </div>
                  ) : (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Order ID</th>
                          <th>Table</th>
                          <th>Customer</th>
                          <th>Method</th>
                          <th>Amount</th>
                          <th>Time</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {branchData.payments.map((p) => (
                          <tr key={p.id}>
                            <td style={{ fontWeight: 700 }}>{p.displayId}</td>
                            <td>
                              <span style={{ fontWeight: 800, color: 'var(--accent-cyan)' }}>{p.tableNumber}</span>
                            </td>
                            <td>{p.customerName}</td>
                            <td>
                              <span className="status-chip chip-blue">{p.method}</span>
                            </td>
                            <td style={{ fontWeight: 800, color: '#10b981' }}>{formatPaise(p.amountPaise)}</td>
                            <td style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{p.timestamp}</td>
                            <td>
                              <button
                                style={{
                                  background: 'rgba(255, 255, 255, 0.06)',
                                  border: '1px solid var(--border-light)',
                                  padding: '4px 10px',
                                  borderRadius: '4px',
                                  fontSize: '0.78rem',
                                  color: '#fff',
                                }}
                              >
                                🖨 Reprint KOT
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {moreSubTab === 'STAFF' && (
              <div className="data-table-container">
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', fontWeight: 800 }}>
                  Staff Members for {currentOutlet.shortName}
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Staff Member</th>
                      <th>Role</th>
                      <th>Phone</th>
                      <th>PIN Quick Access</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchData.staffMembers.map((s) => (
                      <tr key={s.id}>
                        <td style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                          <span style={{ fontSize: '20px' }}>{s.avatar}</span>
                          <div>
                            <div style={{ fontWeight: 700 }}>{s.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{s.email}</div>
                          </div>
                        </td>
                        <td>
                          <span className="status-chip chip-purple">{s.role}</span>
                        </td>
                        <td>{s.phone}</td>
                        <td style={{ fontFamily: 'monospace', letterSpacing: '2px', color: 'var(--accent-cyan)' }}>
                          ••••
                        </td>
                        <td>
                          <span className="status-chip chip-green">ACTIVE ON SHIFT</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* ========================================================
          PERSISTENT TABLET BOTTOM NAVIGATION
          ======================================================== */}
      {/* ========================================================
          ROLE-DIFFERENTIATED TABLET BOTTOM NAVIGATION
          ======================================================== */}
      <nav className="staff-bottom-nav">
        {roleConfig.allowedTabs.includes('ORDERS') && (
          <button
            onClick={() => setActiveTab('ORDERS')}
            className={`staff-nav-item ${activeTab === 'ORDERS' ? 'active' : ''}`}
          >
            <span style={{ fontSize: '20px', position: 'relative' }}>
              🍳
              {pendingOrdersCount > 0 && <span className="nav-badge-count">{pendingOrdersCount}</span>}
            </span>
            <span>Kitchen KDS</span>
          </button>
        )}

        {roleConfig.allowedTabs.includes('TABLES') && (
          <button
            onClick={() => setActiveTab('TABLES')}
            className={`staff-nav-item ${activeTab === 'TABLES' ? 'active' : ''}`}
          >
            <span style={{ fontSize: '20px' }}>🪑</span>
            <span>Tables ({tables.length})</span>
          </button>
        )}

        {roleConfig.allowedTabs.includes('PASS') && (
          <button
            onClick={() => setActiveTab('PASS')}
            className={`staff-nav-item ${activeTab === 'PASS' ? 'active' : ''}`}
          >
            <span style={{ fontSize: '20px', position: 'relative' }}>
              🍽️
              {readyOrdersCount > 0 && <span className="nav-badge-count pulse-glow">{readyOrdersCount}</span>}
            </span>
            <span>Food Pass{readyOrdersCount > 0 ? ` (${readyOrdersCount})` : ''}</span>
          </button>
        )}

        {roleConfig.allowedTabs.includes('STOCK') && (
          <button
            onClick={() => setActiveTab('STOCK')}
            className={`staff-nav-item ${activeTab === 'STOCK' ? 'active' : ''}`}
          >
            <span style={{ fontSize: '20px' }}>📋</span>
            <span>86 Stock ({stock.filter((i) => !i.isAvailable).length} off)</span>
          </button>
        )}

        {roleConfig.allowedTabs.includes('CALLS') && (
          <button
            onClick={() => setActiveTab('CALLS')}
            className={`staff-nav-item ${activeTab === 'CALLS' ? 'active' : ''}`}
          >
            <span style={{ fontSize: '20px', position: 'relative' }}>
              🔔
              {pendingCallsCount > 0 && <span className="nav-badge-count pulse-glow">{pendingCallsCount}</span>}
            </span>
            <span>Bells</span>
          </button>
        )}

        {roleConfig.allowedTabs.includes('POS') && (
          <button
            onClick={() => setActiveTab('POS')}
            className={`staff-nav-item ${activeTab === 'POS' || activeTab === 'MORE' ? 'active' : ''}`}
          >
            <span style={{ fontSize: '20px' }}>💳</span>
            <span>Cashier / POS</span>
          </button>
        )}
      </nav>

      {/* ========================================================
          PIN LOCK SCREEN OVERLAY (Auto-idle or manual lock)
          ======================================================== */}
      {isLocked && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(9, 13, 22, 0.96)',
            backdropFilter: 'blur(20px)',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '360px', width: '100%' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>{currentUser?.avatar || '🔒'}</div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 800 }}>Station Locked</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '18px' }}>
              Verify credentials to unlock {currentRole} floor station ({currentUser?.email})
            </p>

            {pinError && (
              <div style={{ color: 'var(--accent-rose)', fontSize: '0.85rem', fontWeight: 700, marginBottom: '16px' }}>
                ⚠️ {pinError}
              </div>
            )}

            <form onSubmit={handlePasswordLogin} style={{ display: 'flex', flexDirection: 'column', gap: '12px', textAlign: 'left', marginBottom: '20px' }}>
              {!lockMfaToken ? (
                <>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Staff Email</label>
                    <input
                      type="email"
                      required
                      placeholder={currentUser?.email || 'staff@restaurant.com'}
                      value={staffLoginUser || currentUser?.email || ''}
                      onChange={(e) => setStaffLoginUser(e.target.value)}
                      className="form-input"
                      style={{ padding: '10px 12px' }}
                    />
                  </div>
                  <div>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Password</label>
                    <div style={{ position: 'relative' }}>
                      <input
                        type={showStaffPass ? 'text' : 'password'}
                        required
                        minLength={8}
                        placeholder="••••••••"
                        value={staffLoginPass}
                        onChange={(e) => setStaffLoginPass(e.target.value)}
                        className="form-input"
                        style={{ padding: '10px 12px', paddingRight: '36px' }}
                      />
                      <button
                        type="button"
                        onClick={() => setShowStaffPass(!showStaffPass)}
                        style={{
                          position: 'absolute',
                          right: '8px',
                          top: '50%',
                          transform: 'translateY(-50%)',
                          background: 'none',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        {showStaffPass ? '🙈' : '👁️'}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div>
                  <label className="form-label" style={{ fontSize: '0.8rem' }}>Authenticator Code</label>
                  <input
                    type="text"
                    required
                    minLength={6}
                    maxLength={32}
                    autoFocus
                    placeholder="6-digit TOTP code"
                    value={lockMfaCode}
                    onChange={(e) => setLockMfaCode(e.target.value)}
                    className="form-input"
                    style={{ padding: '10px 12px', textAlign: 'center', letterSpacing: '2px' }}
                  />
                </div>
              )}
              <button type="submit" className="btn-primary" style={{ width: '100%', padding: '12px', marginTop: '6px' }}>
                {lockMfaToken ? 'Verify MFA & Unlock' : '🔑 Verify Password & Unlock'}
              </button>
            </form>

            {isOwnerMode ? (
              <button
                type="button"
                onClick={() => {
                  setShowSwitchUserModal(true);
                  setPinError('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#f59e0b',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                👑 Preview Station View (Owner Mode)
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignOut}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                  textDecoration: 'underline',
                }}
              >
                🚪 Sign Out to Common Login Page
              </button>
            )}
          </div>
        </div>
      )}

      {/* SWITCH USER MODAL (Owner only) */}
      {showSwitchUserModal && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '22px' }}>👑</span>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Switch Active Staff Profile</h3>
            </div>
            <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '16px' }}>
              As Executive Owner, you can switch into any staff station instantly without logging out.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px', maxHeight: '360px', overflowY: 'auto' }}>
              {staffList.filter((s) => s.outletId === selectedOutletId || s.outletId === null || !s.outletId).map((u) => {
                const uConfig = ROLE_CONFIGS[u.role] || ROLE_CONFIGS.CAPTAIN;
                return (
                  <button
                    key={u.id}
                    onClick={() => handleOwnerSwitchUser(u)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '12px',
                      padding: '12px 14px',
                      borderRadius: 'var(--radius-sm)',
                      background: currentUser?.id === u.id ? 'rgba(6, 182, 212, 0.15)' : 'rgba(255, 255, 255, 0.04)',
                      border: currentUser?.id === u.id ? '1.5px solid var(--accent-cyan)' : '1px solid var(--border-light)',
                      color: '#fff',
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontSize: '26px' }}>{u.avatar}</span>
                    <div>
                      <div style={{ fontWeight: 800 }}>{u.name}</div>
                      <div style={{ fontSize: '0.78rem', color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>{uConfig.stationBadge}</span>
                        <span>·</span>
                        <span>{u.role}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setShowSwitchUserModal(false)}
              className="btn-secondary"
              style={{ width: '100%' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* TABLE DRAWER DETAILS MODAL */}
      {selectedTable && (
        <div className="modal-overlay" onClick={() => setSelectedTable(null)}>
          <div className="modal-content" style={{ maxWidth: '500px' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <div>
                <span
                  style={{
                    background: 'var(--accent-cyan)',
                    color: '#000',
                    fontWeight: 900,
                    fontSize: '1rem',
                    padding: '2px 8px',
                    borderRadius: '6px',
                  }}
                >
                  {selectedTable.number}
                </span>
                <span style={{ marginLeft: '10px', fontWeight: 700 }}>{selectedTable.section}</span>
              </div>
              <button
                onClick={() => setSelectedTable(null)}
                style={{ color: 'var(--text-muted)', fontSize: '18px' }}
              >
                ✕
              </button>
            </div>

            {/* Session info */}
            {(() => {
              const session = sessions.find((s) => s.tableId === selectedTable.id && s.status === 'OPEN');
              const activeOrder = orders.find((o) => o.tableNumber === selectedTable.number);

              if (session) {
                return (
                  <div>
                    <div style={{ background: 'rgba(255,255,255,0.03)', padding: '12px', borderRadius: '8px', marginBottom: '14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Guests:</span>
                        <strong>{session.guestCount} Pax</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Session Opened:</span>
                        <span>{session.openedAt}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Table Code:</span>
                        <strong style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)' }}>{session.tableCode}</strong>
                      </div>
                    </div>

                    {activeOrder && (
                      <div style={{ marginBottom: '18px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <h4 style={{ fontSize: '0.9rem', fontWeight: 800 }}>Active Order {activeOrder.displayId}</h4>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>🕒 {activeOrder.createdAt}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
                          {activeOrder.items.map((i) => (
                            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                              <div>
                                <span>{i.quantity}× {i.name}</span>
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                  🕒 {i.createdAt || activeOrder.createdAt}
                                </div>
                              </div>
                              <span>{formatPaise(i.pricePaise * i.quantity)}</span>
                            </div>
                          ))}
                          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                            <span>Total Bill:</span>
                            <span style={{ color: 'var(--accent-cyan)' }}>{formatPaise(activeOrder.totalPaise)}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {activeOrder?.status === 'READY' && (
                      <button
                        onClick={() => {
                          transitionOrder(activeOrder.id, 'SERVED');
                          setSelectedTable(null);
                        }}
                        style={{
                          width: '100%',
                          marginBottom: '10px',
                          padding: '11px 14px',
                          background: 'linear-gradient(135deg, #10b981, #059669)',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: '0.88rem',
                          borderRadius: 'var(--radius-sm)',
                          border: 'none',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '8px',
                          boxShadow: '0 4px 12px rgba(16, 185, 129, 0.25)',
                        }}
                      >
                        🏃 Delivered &amp; Served to Table {selectedTable.number}
                      </button>
                    )}

                    <div style={{ display: 'flex', gap: '8px' }}>
                      {activeOrder && (
                        <button
                          onClick={() => {
                            setCollectPaymentOrder(activeOrder);
                            setSelectedTable(null);
                          }}
                          className="btn-primary"
                          style={{ flex: 1 }}
                        >
                          💳 Collect Payment / Settle
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedTable(null)}
                        className="btn-secondary"
                      >
                        Close
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Table {selectedTable.number} is currently vacant and ready for seating.
                  </p>
                  <button
                    onClick={() => {
                      // Seat new guests
                      setSessions((prev) => [
                        ...prev,
                        {
                          id: 's-new-' + Date.now(),
                          tableId: selectedTable.id,
                          tableNumber: selectedTable.number,
                          status: 'OPEN',
                          guestCount: 2,
                          openedAt: 'Just now',
                          closedAt: null,
                          tableCode: String(Math.floor(1000 + Math.random() * 9000)),
                        },
                      ]);
                      setSelectedTable(null);
                    }}
                    className="btn-primary"
                  >
                    Seat Walk-in Guests (Open Session)
                  </button>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* COLLECT PAYMENT / DIRECT UPI QR MODAL */}
      {collectPaymentOrder && (
        <div className="modal-overlay">
          <div className="modal-content" style={{ maxWidth: '440px', textAlign: 'center' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800 }}>Settle Table {collectPaymentOrder.tableNumber}</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>
              Order {collectPaymentOrder.displayId} · Total: {formatPaise(collectPaymentOrder.totalPaise)}
            </p>

            {/* Payment method selector */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginBottom: '18px' }}>
              {(['DIRECT_UPI', 'UPI', 'CASH', 'CARD'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPaymentMethod(m)}
                  style={{
                    padding: '8px 4px',
                    borderRadius: '6px',
                    fontSize: '0.74rem',
                    fontWeight: 700,
                    background: paymentMethod === m ? 'var(--accent-cyan)' : 'rgba(255, 255, 255, 0.05)',
                    color: paymentMethod === m ? '#000' : 'var(--text-secondary)',
                    border: '1px solid var(--border-light)',
                  }}
                >
                  {m === 'DIRECT_UPI' ? 'Direct UPI' : m}
                </button>
              ))}
            </div>

            {paymentMethod === 'DIRECT_UPI' && (
              <div style={{ background: '#fff', padding: '16px', borderRadius: '12px', display: 'inline-block', marginBottom: '14px' }}>
                {/* SVG mock QR for UPI */}
                <div style={{ width: '160px', height: '160px', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '10px' }}>
                  [ UPI QR CODE: ₹{collectPaymentOrder.totalPaise / 100} ]
                </div>
                <div style={{ color: '#000', fontWeight: 800, fontSize: '0.85rem', marginTop: '6px' }}>
                  Scan with any UPI App
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <button
                onClick={() => {
                  // Mark order billed and remove from active
                  setOrders((prev) => prev.filter((o) => o.id !== collectPaymentOrder.id));
                  setCollectPaymentOrder(null);
                }}
                className="btn-success"
                style={{ flex: 1 }}
              >
                ✓ Confirm Settle & Print GST Bill
              </button>
              <button
                onClick={() => setCollectPaymentOrder(null)}
                className="btn-secondary"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
