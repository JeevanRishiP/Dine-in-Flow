'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { io, type Socket } from 'socket.io-client';
import {
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
import MenuCatalogManager from '../components/MenuCatalogManager';
import {
  useStaffStore,
  ROLE_CONFIGS,
  type StaffTab,
  type StaffDashboardView,
  type RoleWorkstationConfig,
} from '../../store/useStaffStore';
import { StaffSidebar } from '../../components/staff/shared/StaffSidebar';
import { KdsKanbanBoard } from '../../components/staff/kds/KdsKanbanBoard';
import { ServeLaterPromptBanner } from '../../components/staff/kds/ServeLaterPromptBanner';
import { FloorMapView } from '../../components/staff/floor/FloorMapView';
import { CashierPosView } from '../../components/staff/pos/CashierPosView';

export default function StaffWebApp() {
  const router = useRouter();

  // Outlet Selection State (Stored & dynamically created by Owner)
  const [outletsList, setOutletsList] = useState<Outlet[]>(() =>
    typeof window !== 'undefined' ? getStoredOutlets() : []
  );
  // Outlet Selection State (Zustand: useStaffStore)
  const selectedOutletId = useStaffStore((s) => s.selectedOutletId);
  const setSelectedOutletId = useStaffStore((s) => s.setSelectedOutletId);
  const fallbackOutlet: Outlet = {
    id: selectedOutletId || '',
    orgId: '',
    name: 'Selected Outlet',
    shortName: 'Outlet',
    address: '',
    timezone: 'Asia/Kolkata',
    isActive: true,
  };
  const currentOutlet = outletsList.find((o) => o.id === selectedOutletId) ?? outletsList[0] ?? fallbackOutlet;

  // Staff User State (Stored & dynamically assigned by Owner)
  const [staffList, setStaffList] = useState<StaffMember[]>(() =>
    typeof window !== 'undefined' ? getStoredStaff() : []
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
    useStaffStore.getState().setCurrentUser(user);
    setIsOwnerMode(state.user.role === 'OWNER');
    if (user.outletId) {
      setSelectedOutletId(user.outletId);
    }
  }, [router, setSelectedOutletId]);

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

  // Global Staff Store State (Zustand: useStaffStore)
  const activeTab = useStaffStore((s) => s.activeTab);
  const activeView = useStaffStore((s) => s.activeView);
  const setActiveTab = useStaffStore((s) => s.setActiveTab);
  const setActiveView = useStaffStore((s) => s.setActiveView);

  const connectionStatus = useStaffStore((s) => s.connectionStatus);
  const setConnectionStatus = useStaffStore((s) => s.setConnectionStatus);
  const pushWebSocketEvent = useStaffStore((s) => s.pushWebSocketEvent);

  const orders = useStaffStore((s) => s.orders);
  const setOrders = useStaffStore((s) => s.setOrders);
  const setKdsItems = useStaffStore((s) => s.setKdsItems);
  const setLastKdsSyncedAt = useStaffStore((s) => s.setLastKdsSyncedAt);
  const tables = useStaffStore((s) => s.tables);
  const setTables = useStaffStore((s) => s.setTables);
  const sessions = useStaffStore((s) => s.sessions);
  const setSessions = useStaffStore((s) => s.setSessions);
  const reservations = useStaffStore((s) => s.reservations);
  const setReservations = useStaffStore((s) => s.setReservations);
  const serveLaterPrompts = useStaffStore((s) => s.serveLaterPrompts);
  const dismissServeLaterPrompt = useStaffStore((s) => s.dismissServeLaterPrompt);
  const markTableCleaned = useStaffStore((s) => s.markTableCleaned);
  const stock = useStaffStore((s) => s.stock);
  const setStock = useStaffStore((s) => s.setStock);
  const calls = useStaffStore((s) => s.calls);
  const setCalls = useStaffStore((s) => s.setCalls);
  const setPayments = useStaffStore((s) => s.setPayments);

  const needsCleaningTableIdsRaw = useStaffStore((s) => s.needsCleaningTableIds);
  const setNeedsCleaningTableIds = useStaffStore((s) => s.setNeedsCleaningTableIds);
  const needsCleaningTableIds = React.useMemo(
    () => new Set(needsCleaningTableIdsRaw),
    [needsCleaningTableIdsRaw],
  );

  const isSoundMuted = useStaffStore((s) => s.isSoundMuted);
  const setIsSoundMuted = useStaffStore((s) => s.setIsSoundMuted);
  const staffToast = useStaffStore((s) => s.staffToast);
  const showStaffToast = useStaffStore((s) => s.showStaffToast);

  // Guard active tab to ensure the staff member only views allowed stations for their role
  useEffect(() => {
    if (!currentUser) return;
    const config = ROLE_CONFIGS[currentRole] || ROLE_CONFIGS.CAPTAIN;
    if (!config.allowedTabs.includes(activeTab)) {
      setActiveTab(config.defaultTab);
    }
  }, [currentRole, currentUser?.id, activeTab, setActiveTab]);

  const [cleaningTableLoading, setCleaningTableLoading] = useState(false);

  const fetchLiveFloor = async () => {
    try {
      const res = await consoleAuthFetch(
        `/api/v1/console/tables/floor?outlet_id=${encodeURIComponent(selectedOutletId)}`,
      );
      if (!res.ok) return;
      const data = await res.json();
      if (!Array.isArray(data)) return;
      if (data.length === 0) {
        setTables([]);
        setSessions([]);
        setNeedsCleaningTableIds(new Set());
        return;
      }

      const liveTables: Table[] = data.map((t: any, idx: number) => ({
        id: t.id,
        outletId: t.outlet_id || selectedOutletId,
        number: t.table_number,
        section: (t.section || 'Main Dining Hall') as Table['section'],
        capacity: Number(t.capacity || 4),
        qrTokenVersion: Number(t.qr_token_version || 1),
        isActive: true,
        x: idx % 4,
        y: Math.floor(idx / 4),
      }));
      const cleaningSet = new Set<string>();
      const liveSessions: TableSession[] = data
        .filter((t: any) => {
          if (t.needs_cleaning) {
            cleaningSet.add(t.id);
          }
          return Number(t.open_sessions_count || 0) > 0;
        })
        .map((t: any) => ({
          id: `live-sess-${t.id}`,
          tableId: t.id,
          tableNumber: t.table_number,
          status: 'OPEN' as const,
          guestCount: Math.max(1, Number(t.active_guest_pax || 2)),
          openedAt: t.first_opened_at ? formatOrderDateTime(t.first_opened_at) : 'Active',
          closedAt: null,
          tableCode: String(t.qr_token_version || 1),
        }));

      setTables(liveTables);
      setSessions(liveSessions);
      setNeedsCleaningTableIds(cleaningSet);
    } catch {
      // Keep previous floor state on transient network errors
    }
  };

  const handleMarkTableCleaned = async (table: Table) => {
    if (cleaningTableLoading) return;
    setCleaningTableLoading(true);
    try {
      const res = await consoleAuthFetch(`/api/v1/console/tables/${encodeURIComponent(table.id)}/clean`, {
        method: 'POST',
      });
      if (!res.ok) {
        showStaffToast('Unable to mark table cleaned. Verify captain/waiter permission.');
        return;
      }
      const data = (await res.json()) as {
        tableNumber?: string;
        dissolvedTempCustomerIds?: string[];
        stillActiveOtherTablesCount?: number;
      };
      const dissolvedCount = data.dissolvedTempCustomerIds?.length ?? 0;
      const stillOther = data.stillActiveOtherTablesCount ?? 0;
      const note =
        dissolvedCount > 0
          ? `Guest temp ID dissolved (${dissolvedCount}).`
          : stillOther > 0
          ? `Guest remains active on ${stillOther} other table(s).`
          : 'Ready for next diner.';
      showStaffToast(`🧹 Table ${data.tableNumber || table.number} cleaned & ready! ${note}`);
      setSelectedTable(null);
      await Promise.all([fetchLiveFloor(), fetchLiveOrders()]);
    } catch {
      showStaffToast('Network error marking table cleaned.');
    } finally {
      setCleaningTableLoading(false);
    }
  };

  const [releasingHeldOrderId, setReleasingHeldOrderId] = useState<string | null>(null);

  const handleStaffFireHeldItems = async (orderId: string, itemId?: string) => {
    if (releasingHeldOrderId === orderId) return;
    setReleasingHeldOrderId(orderId);
    try {
      const url = `/api/v1/console/orders/${encodeURIComponent(orderId)}/serve-later/release`;
      const res = await consoleAuthFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(itemId ? { itemId } : {}),
      });
      if (res.ok) {
        dismissServeLaterPrompt(orderId);
        showStaffToast(itemId ? '🔥 Dish fired to kitchen!' : '🔥 Held dishes fired to kitchen!');
        await Promise.all([fetchLiveOrders(), fetchKdsSnapshot()]);
      } else {
        const errData = await res.json().catch(() => ({}));
        showStaffToast(errData.detail || errData.message || 'Failed to fire held items.');
      }
    } catch {
      showStaffToast('Network error firing held items.');
    } finally {
      setReleasingHeldOrderId(null);
    }
  };

  const handleStaffSnoozePrompt = async (orderId: string) => {
    if (releasingHeldOrderId === orderId) return;
    setReleasingHeldOrderId(orderId);
    try {
      const res = await consoleAuthFetch(`/api/v1/console/orders/${orderId}/serve-later/snooze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutes: 10 }),
      });
      if (res.ok) {
        dismissServeLaterPrompt(orderId);
        showStaffToast('⏳ Snoozed dessert check-in for 10 minutes.');
      } else {
        showStaffToast('Failed to snooze check-in.');
      }
    } catch {
      showStaffToast('Network error snoozing check-in.');
    } finally {
      setReleasingHeldOrderId(null);
    }
  };

  // Live Database Orders Sync
  const fetchKdsSnapshot = async () => {
    try {
      const kdsRes = await consoleAuthFetch(
        `/api/v1/console/orders/kds/items?outlet_id=${encodeURIComponent(selectedOutletId)}`,
      );
      if (kdsRes.ok) {
        const kdsData = await kdsRes.json();
        const tickets = Array.isArray(kdsData) ? kdsData : (kdsData?.items ?? []);
        setKdsItems(tickets);
        if (kdsData?.serverTimestamp) {
          setLastKdsSyncedAt(kdsData.serverTimestamp);
        }
      }
    } catch (err) {
      console.error('Failed to sync KDS items:', err);
    }
  };

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
        const liveOrders: Order[] = (Array.isArray(data) ? data : [])
          .filter((d: any) => {
            const isPaid = d.payment_status === 'PAID' || d.payment_method === 'CASH_APPROVED';
            return (
              d.status !== 'AWAITING_PAYMENT' &&
              d.status !== 'PAYMENT_FAILED' &&
              d.status !== 'PAYMENT_CANCELLED' &&
              d.status !== 'PAYMENT_EXPIRED' &&
              isPaid
            );
          })
          .map((d: any) => {
          const frontendStatus: Order['status'] =
            d.status === 'PENDING' ? 'PENDING_APPROVAL' : (d.status as Order['status']);
          const isKnownMock =
            d.id === '10000000-0000-0000-0000-000000000001'
              ? 'RS-1001'
              : d.id === '10000000-0000-0000-0000-000000000002'
              ? 'RS-1002'
              : d.id === '10000000-0000-0000-0000-000000000003'
              ? 'RS-1003'
              : null;
          const canonicalDisplayId =
            d.display_id ||
            d.displayId ||
            (d.order_number ? ('ORD-' + String(d.order_number).padStart(4, '0')) : (isKnownMock || ('ORD-#' + d.id.slice(-4).toUpperCase())));

          return {
            id: d.id,
            displayId: canonicalDisplayId,
            outletId: d.outlet_id || selectedOutletId,
            tableId: d.table_id ?? d.tableId ?? null,
            tableNumber: d.table_number || 'T04',
            dinerId: d.diner_id ?? d.dinerId ?? null,
            dinerLabel: d.diner_label ?? d.dinerLabel ?? null,
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
              targetTableId: it.target_table_id ?? it.targetTableId ?? null,
              targetTableNumber: it.target_table_number ?? null,
              dinerId: it.diner_id ?? it.dinerId ?? null,
              dinerLabel: it.diner_label ?? it.dinerLabel ?? null,
              createdAt: formatOrderDateTime(it.created_at || d.created_at),
              courseSequence: it.course_sequence ?? 2,
              prepTimeMinutes: it.prep_time_minutes ?? 15,
              targetFireAt: it.target_fire_at ?? null,
              holdStatus: it.hold_status ?? 'ACTIVE',
              isComboItem: Boolean(it.is_combo_item),
              comboName: it.combo_name ?? null,
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
            paymentMethod: d.payment_method || 'UPI',
            paymentStatus: d.payment_status || 'PAID',
            orderType: d.order_type || 'DINE_IN',
            scheduledFor: d.scheduled_for ?? null,
            paidAt: d.paid_at ?? null,
            mainCourseServedAt: d.main_course_served_at ?? null,
            serveLaterPromptSentAt: d.serve_later_prompt_sent_at ?? null,
          };
        });

        // Use live orders directly without falling back to phantom mock orders
        const combined = Array.isArray(data) ? liveOrders : [];

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

        // Also fetch flattened KDS priority items
        await fetchKdsSnapshot();
      }
    } catch {
      setConnectionStatus('degraded');
    }
  };

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

  // Realtime WebSocket Connection & State Sync via Socket.IO /kds Gateway
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const data = getBranchData(selectedOutletId);
    setTables(data.tables);
    setSessions([]);
    setStock(data.menuItems);
    setCalls(data.serviceCalls);
    setPayments(data.payments);
    if ((data as any).reservations) {
      setReservations((data as any).reservations);
    }

    // Initial baseline fetch on mount or outlet switch
    void fetchLiveOrders();
    void fetchLiveFloor();

    const authState = getConsoleAuthState();
    const token = authState?.accessToken;

    if (!token) {
      setConnectionStatus('offline');
      return;
    }

    // Connect directly to NestJS KdsGateway (/kds namespace, transports: ['websocket'])
    const getKdsSocketUrl = (): string => {
      if (typeof window === 'undefined') return 'http://localhost:3000';
      if (process.env['NEXT_PUBLIC_WS_URL']) return process.env['NEXT_PUBLIC_WS_URL'];
      if (process.env['NEXT_PUBLIC_API_URL']) return process.env['NEXT_PUBLIC_API_URL'];
      const port = window.location.port === '3004' ? '3000' : window.location.port;
      return `${window.location.protocol}//${window.location.hostname}:${port || '3000'}`;
    };

    const wsBase = getKdsSocketUrl();
    const socket: Socket = io(`${wsBase}/kds`, {
      transports: ['websocket'],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnectionStatus('live');
      void fetchLiveOrders();
      void fetchLiveFloor();
    });

    socket.on('reconnect', () => {
      setConnectionStatus('live');
      void fetchLiveOrders();
      void fetchLiveFloor();
    });

    socket.on('connected', () => {
      setConnectionStatus('live');
      void fetchLiveOrders();
      void fetchLiveFloor();
    });

    socket.on('order:event', (msg: { id: string; org_id: string; outlet_id?: string; aggregate: string; eventType: string; payload: unknown }) => {
      // Acknowledge receipt to gateway
      if (msg?.id) {
        socket.emit('order:ack', { eventId: msg.id });
      }

      // Filter by outlet if specified on event and matching active outlet
      const eventOutletId = msg?.outlet_id || (msg?.payload as any)?.outlet_id;
      if (eventOutletId && selectedOutletId && eventOutletId !== selectedOutletId) {
        return;
      }

      // Record incoming socket event in global staff store queue
      pushWebSocketEvent(msg);

      // Live push update from database outbox without polling
      void fetchLiveOrders();
      void fetchLiveFloor();

      if (
        msg?.eventType === 'table.cleaned' ||
        msg?.eventType === 'kds.sync_required'
      ) {
        const tableId = (msg?.payload as any)?.tableId || (msg?.payload as any)?.table_id;
        if (tableId) {
          markTableCleaned(tableId);
        }
        void Promise.all([fetchLiveOrders(), fetchLiveFloor(), fetchKdsSnapshot()]);
      }

      // Auditory and visual alert for newly arrived orders, item fired, payment, and serve-later prompts
      if (
        msg?.eventType === 'kds.item_fired' ||
        msg?.eventType === 'PAYMENT_CAPTURED' ||
        msg?.eventType === 'ORDER_PLACED'
      ) {
        playAlertChime();
        if (msg?.eventType === 'kds.item_fired') {
          showStaffToast('🍳 Kitchen item fired!');
        } else if (msg?.eventType === 'PAYMENT_CAPTURED') {
          showStaffToast('💰 Payment confirmed! Order sent to kitchen.');
        } else {
          showStaffToast('🔔 New customer order received in kitchen!');
        }
      } else if (msg?.eventType === 'course.prompt_serve_later') {
        playAlertChime();
        showStaffToast('🍨 Dessert/beverage check-in ready for table!');
      }
    });

    socket.on('kds.item_fired', () => {
      void Promise.all([fetchLiveOrders(), fetchKdsSnapshot()]);
      playAlertChime();
      showStaffToast('🍳 Kitchen item fired!');
    });

    socket.on('table.cleaned', (data: any) => {
      const tid = data?.tableId || data?.table_id;
      if (tid) markTableCleaned(tid);
      void Promise.all([fetchLiveOrders(), fetchLiveFloor(), fetchKdsSnapshot()]);
    });

    socket.on('kds.sync_required', () => {
      void Promise.all([fetchLiveOrders(), fetchKdsSnapshot()]);
    });

    socket.on('order.updated', () => {
      void Promise.all([fetchLiveOrders(), fetchKdsSnapshot()]);
    });

    socket.on('item.updated', () => {
      void Promise.all([fetchLiveOrders(), fetchKdsSnapshot()]);
    });

    socket.on('disconnect', (reason) => {
      if (reason !== 'io client disconnect') {
        setConnectionStatus('degraded');
      }
    });

    socket.on('connect_error', () => {
      setConnectionStatus('degraded');
    });

    // Fallback sync ONLY when socket is disconnected/degraded (30s safety net, NEVER 3s hammering)
    const fallbackInterval = setInterval(() => {
      if (socket.disconnected) {
        void fetchLiveOrders();
        void fetchLiveFloor();
      }
    }, 30000);

    // 60s safety-net full resync interval for missed ticket recovery
    const safetyNetInterval = setInterval(() => {
      void fetchLiveOrders();
      void fetchLiveFloor();
    }, 60000);

    return () => {
      clearInterval(fallbackInterval);
      clearInterval(safetyNetInterval);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [selectedOutletId]);

  // Filters & Views
  const [selectedSection, setSelectedSection] = useState<string>('ALL');
  const [stockSearch, setStockSearch] = useState('');

  // Modals & Drawers
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [selectedTable, setSelectedTable] = useState<Table | null>(null);
  const [collectPaymentOrder, setCollectPaymentOrder] = useState<Order | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'UPI' | 'DIRECT_UPI' | 'CASH' | 'CARD'>('DIRECT_UPI');
  const [cashGiven, setCashGiven] = useState('');
  const [directUpiRef, setDirectUpiRef] = useState('');

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

  // Handle server-verified Staff Username + Password unlock on Lock Screen
  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const state = getConsoleAuthState();
    const orgSlug = state?.user.orgSlug || '';
    const identifierToVerify = (
      staffLoginUser ||
      state?.user.username ||
      state?.user.email ||
      ''
    )
      .trim()
      .toLowerCase();

    if (lockMfaToken) {
      const mfaResult = await verifyStaffMfaRemote({
        preMfaToken: lockMfaToken,
        code: lockMfaCode,
        orgSlug,
        username: state?.user.username,
        email: state?.user.email || identifierToVerify,
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

    if (!identifierToVerify || !staffLoginPass) {
      setPinError('Please enter your username and password.');
      return;
    }

    // Prevent switching accounts from a locked non-owner terminal without explicit Sign Out
    const currentUsername = state?.user.username?.toLowerCase();
    const currentEmail = state?.user.email?.toLowerCase();
    if (
      !isOwnerMode &&
      (currentUsername || currentEmail) &&
      identifierToVerify !== currentUsername &&
      identifierToVerify !== currentEmail
    ) {
      setPinError(
        `Please unlock as ${currentUsername || currentEmail} or Sign Out to switch staff.`,
      );
      return;
    }

    const authResult = await loginStaffRemote({
      orgSlug: orgSlug || undefined,
      username: identifierToVerify,
      password: staffLoginPass,
    });
    if (!authResult.ok) {
      setPinError(authResult.error || 'Invalid username or password.');
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
      if (res.ok || (res.status === 400 && nextStatus === 'SERVED')) {
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
      if (res.ok || (res.status === 400 && nextStatus === 'SERVED')) {
        if (localItemStatusOverrides.current[orderId]) {
          delete localItemStatusOverrides.current[orderId]![itemId];
          if (Object.keys(localItemStatusOverrides.current[orderId]!).length === 0) {
            delete localItemStatusOverrides.current[orderId];
            delete localStatusOverrides.current[orderId];
          }
        }
        fetchLiveOrders();
      } else if (res.status === 409) {
        let msg = 'Item already claimed by another chef';
        try {
          const body = await res.json();
          if (body?.detail) msg = body.detail;
        } catch {}
        showStaffToast(`⚠️ ${msg}`);
        if (localItemStatusOverrides.current[orderId]) {
          delete localItemStatusOverrides.current[orderId]![itemId];
        }
        delete localStatusOverrides.current[orderId];
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

  function isDessertOrPostMealDish(name?: string, notes?: string | null): boolean {
    const str = `${name || ''} ${notes || ''}`.toLowerCase();
    return (
      str.includes('ice cream') ||
      str.includes('kulfi') ||
      str.includes('gulab jamun') ||
      str.includes('halwa') ||
      str.includes('dessert') ||
      str.includes('sweet') ||
      str.includes('rasgulla') ||
      str.includes('filter coffee') ||
      str.includes('masala chai') ||
      str.includes('coffee') ||
      str.includes('tea') ||
      str.includes('warm gulab jamun') ||
      str.includes('serve later') ||
      str.includes('[serve_later]')
    );
  }

  // Shared per-item row renderer: puts the proceed button directly next to each item name
  const renderKdsOrderItems = (order: Order, qtyColor = 'var(--accent-cyan)') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
      {order.items.map((item) => {
        const isPendingOrConfirmed = !item.status || item.status === 'PENDING' || item.status === 'CONFIRMED';
        const isPreparing = item.status === 'PREPARING';
        const isReady = item.status === 'READY';
        const isServed = item.status === 'SERVED';
        const isPostMeal = isDessertOrPostMealDish(item.name, item.notes);
        const isReleased = Boolean(item.notes && item.notes.includes('[RELEASED_TO_KITCHEN]'));
        const isOnHold = isPostMeal && !isReleased && (isPendingOrConfirmed || isPreparing);

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
                {item.targetTableNumber && item.targetTableNumber !== order.tableNumber && (
                  <span
                    style={{
                      background: 'rgba(245, 158, 11, 0.2)',
                      color: '#fbbf24',
                      border: '1px solid rgba(245, 158, 11, 0.45)',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      fontSize: '0.7rem',
                      fontWeight: 800,
                    }}
                  >
                    → Table {item.targetTableNumber}
                  </span>
                )}
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
              {isOnHold && (
                <div style={{ marginTop: '4px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: 'rgba(168, 85, 247, 0.2)',
                      border: '1px solid rgba(168, 85, 247, 0.45)',
                      color: '#c084fc',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                    }}
                  >
                    <span>⏳</span>
                    <span>ON HOLD · Serve Later (Guest will signal)</span>
                  </span>
                </div>
              )}
              {isReleased && (
                <div style={{ marginTop: '4px' }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      padding: '2px 8px',
                      borderRadius: '4px',
                      background: 'rgba(245, 158, 11, 0.25)',
                      border: '1px solid rgba(245, 158, 11, 0.5)',
                      color: '#fbbf24',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                    }}
                    className="pulse-glow"
                  >
                    <span>🔥</span>
                    <span>GUEST SIGNALLED · PREPARE NOW!</span>
                  </span>
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

  // Unread badge counts: count dishes ready on the food pass waiting for pickup/delivery
  const pendingOrdersCount = orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'PENDING_APPROVAL').length;
  const readyItemsCount = orders.reduce((sum, o) => sum + o.items.filter((it) => it.status === 'READY').length, 0);
  const passOrders = orders.filter((o) => o.items.some((it) => it.status === 'READY') || o.status === 'READY');
  const passOrdersCount = passOrders.length;
  const readyOrdersCount = readyItemsCount;
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
        {/* Captain & Floor Serve Later Auto-Prompter Banner */}
        <ServeLaterPromptBanner />

        {/* TAB 1: KITCHEN DISPLAY SYSTEM (KDS) */}
        {(activeTab === 'ORDERS' || activeView === 'KDS') && (
          <KdsKanbanBoard
            currentOutlet={currentOutlet}
            currentUser={currentUser}
            onTransitionItem={transitionItem}
            onTransitionOrder={transitionOrder}
            onSettleOrder={(order) => setCollectPaymentOrder(order)}
            onSelectOutlet={(outletId) => setSelectedOutletId(outletId)}
          />
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

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                <span
                  style={{
                    background: readyItemsCount > 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 255, 255, 0.05)',
                    color: readyItemsCount > 0 ? '#10b981' : 'var(--text-muted)',
                    border: `1px solid ${readyItemsCount > 0 ? 'rgba(16, 185, 129, 0.4)' : 'var(--border-light)'}`,
                    padding: '6px 14px',
                    borderRadius: '999px',
                    fontSize: '0.82rem',
                    fontWeight: 800,
                  }}
                  className={readyItemsCount > 0 ? 'pulse-glow' : ''}
                >
                  ⚡ {readyItemsCount} Dish{readyItemsCount === 1 ? '' : 'es'} Waiting on Pass ({passOrdersCount} Table{passOrdersCount === 1 ? '' : 's'})
                </span>
                {readyItemsCount > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      const passList = orders.filter((o) => o.items.some((it) => it.status === 'READY') || o.status === 'READY');
                      for (const ro of passList) {
                        const readyItems = ro.items.filter((it) => it.status === 'READY');
                        for (const it of readyItems) {
                          void transitionItem(ro.id, it.id, 'SERVED');
                        }
                        if (ro.status === 'READY') {
                          void transitionOrder(ro.id, 'SERVED');
                        }
                      }
                    }}
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.35)',
                      color: '#34d399',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    ✓ Mark All Delivered
                  </button>
                )}
              </div>
            </div>

            {/* Ready Tickets Grid */}
            {readyItemsCount === 0 ? (
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
                  All prepared dishes have been delivered to guests. As soon as the kitchen marks any dish &quot;Plated &amp; Ready&quot;, it will appear right here with destination table details for immediate pickup.
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
                  .filter((o) => o.items.some((it) => it.status === 'READY') || o.status === 'READY')
                  .map((order) => {
                    const readyItems = order.items.filter((it) => it.status === 'READY');
                    const cookingItems = order.items.filter(
                      (it) => !it.status || it.status === 'PREPARING' || it.status === 'PENDING' || it.status === 'CONFIRMED'
                    );

                    return (
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
                              🔥 {readyItems.length} PLATED ON PASS
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                              🕒 {order.createdAt}
                            </div>
                          </div>
                        </div>

                        {/* Items to Deliver with inline Served buttons */}
                        {renderKdsOrderItems(order, '#10b981')}

                        {/* Expediter status if other dishes still cooking */}
                        {cookingItems.length > 0 && (
                          <div
                            style={{
                              padding: '8px 12px',
                              background: 'rgba(245, 158, 11, 0.12)',
                              border: '1px solid rgba(245, 158, 11, 0.3)',
                              borderRadius: '6px',
                              color: '#fbbf24',
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              marginBottom: '12px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '8px',
                            }}
                          >
                            <span>⏳</span>
                            <span>Kitchen still preparing {cookingItems.length} dish{cookingItems.length === 1 ? '' : 'es'}: {cookingItems.map((c) => `${c.quantity}× ${c.name}`).join(', ')}</span>
                          </div>
                        )}

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

                        {/* Bulk action: deliver ready dishes to table */}
                        {readyItems.length > 0 && (
                          <button
                            onClick={async () => {
                              for (const it of readyItems) {
                                void transitionItem(order.id, it.id, 'SERVED');
                              }
                              if (order.status === 'READY') {
                                void transitionOrder(order.id, 'SERVED');
                              }
                            }}
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
                            <span>🏃</span>
                            <span>Deliver {readyItems.length} Ready Dish{readyItems.length === 1 ? '' : 'es'} to Table {order.tableNumber}</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
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
        {(activeTab === 'TABLES' || activeView === 'FLOOR') && (
          <FloorMapView
            currentOutlet={currentOutlet}
            onSelectTable={(table) => setSelectedTable(table)}
            onMarkTableCleaned={handleMarkTableCleaned}
            onSelectOutlet={(outletId) => setSelectedOutletId(outletId)}
          />
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
                  No Menu Configured in {currentOutlet.shortName || currentOutlet.name}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                  Menu items and categories can be created and managed in the Owner Cockpit.
                </p>
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
        {activeTab === 'MENU' && (currentRole === 'MANAGER' || currentRole === 'OWNER') && (
          <div style={{ padding: '20px 24px' }}>
            <MenuCatalogManager
              outletId={selectedOutletId}
              outletName={currentOutlet.shortName || currentOutlet.name}
              onToast={showStaffToast}
            />
          </div>
        )}

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
        {(activeTab === 'POS' || activeTab === 'MORE' || activeView === 'CASHIER') && (
          <CashierPosView
            currentOutlet={currentOutlet}
            currentUser={currentUser}
            staffMembers={branchData.staffMembers}
            onSettleOrder={(order) => setCollectPaymentOrder(order)}
          />
        )}
      </main>

      {/* ========================================================
          ROLE-DIFFERENTIATED TABLET & DESKTOP NAVIGATION
          Extracted to StaffSidebar wired to useStaffStore
          ======================================================== */}
      <StaffSidebar currentRole={currentRole} />

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
              Verify credentials to unlock {currentRole} floor station ({currentUser?.username || currentUser?.email})
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
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Username</label>
                    <input
                      type="text"
                      required
                      placeholder={currentUser?.username || 'e.g. captain'}
                      value={staffLoginUser || currentUser?.username || currentUser?.email || ''}
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
                        minLength={4}
                        placeholder="Enter password"
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
              const activeOrders = orders.filter(
                (o) =>
                  o.status !== 'CANCELLED' &&
                  o.status !== 'BILLED' &&
                  (o.tableNumber === selectedTable.number ||
                    (selectedTable.id && o.tableId === selectedTable.id) ||
                    o.items?.some((it) => it.targetTableNumber === selectedTable.number)),
              );
              activeOrders.sort(
                (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
              );
              const combinedTotalPaise = activeOrders.reduce((sum, o) => sum + (o.totalPaise || 0), 0);
              const upcomingRes = reservations.find(
                (r) => r.tableNumber === selectedTable.number && (r.status === 'CONFIRMED' || !r.status),
              );

              if (session) {
                const heldOrders = activeOrders.filter((o) =>
                  o.items.some((it) => it.holdStatus === 'SERVE_LATER_HOLD'),
                );
                const hasPrompt = Boolean(
                  serveLaterPrompts.some(
                    (p) =>
                      activeOrders.some((o) => p.orderId === o.id) ||
                      p.tableNumber === selectedTable.number,
                  ),
                );
                const showServeLaterCheckIn = Boolean(heldOrders.length > 0 || hasPrompt);

                return (
                  <div>
                    {upcomingRes && (
                      <div
                        style={{
                          background: 'rgba(59, 130, 246, 0.15)',
                          border: '1px solid rgba(59, 130, 246, 0.4)',
                          borderRadius: '8px',
                          padding: '8px 12px',
                          marginBottom: '12px',
                          fontSize: '0.8rem',
                          color: '#93c5fd',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}
                      >
                        <span>📅</span>
                        <span>
                          Upcoming Reservation: {new Date(upcomingRes.reservedFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {upcomingRes.guestCount} Pax {upcomingRes.customerName ? `(${upcomingRes.customerName})` : ''}
                        </span>
                      </div>
                    )}

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

                    {/* Serve-Later Check-In Banner in Table Detail Drawer */}
                    {showServeLaterCheckIn && heldOrders.length > 0 && (
                      <div
                        style={{
                          background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.22), rgba(126, 34, 206, 0.32))',
                          border: '1.5px solid #c084fc',
                          borderRadius: '8px',
                          padding: '10px 12px',
                          marginBottom: '14px',
                          boxShadow: '0 0 12px rgba(192, 132, 252, 0.3)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '8px',
                        }}
                      >
                        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#f3e8ff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>🍨</span> Serve-Later Check-In Ready!
                        </div>
                        <div style={{ fontSize: '0.75rem', color: '#e9d5ff' }}>
                          Desserts &amp; beverages are on hold. Check with diner and fire when ready.
                        </div>
                        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                          {heldOrders.map((hOrd) => (
                            <button
                              key={hOrd.id}
                              type="button"
                              disabled={releasingHeldOrderId === hOrd.id}
                              onClick={() => void handleStaffFireHeldItems(hOrd.id)}
                              style={{
                                flex: 1,
                                minWidth: '140px',
                                padding: '7px 10px',
                                borderRadius: '6px',
                                background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                                color: '#fff',
                                fontSize: '0.78rem',
                                fontWeight: 800,
                                border: 'none',
                                cursor: 'pointer',
                              }}
                            >
                              🔥 Fire Held Items ({hOrd.displayId})
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeOrders.map((activeOrder, ordIdx) => (
                      <div key={activeOrder.id} style={{ marginBottom: '18px', background: 'rgba(255,255,255,0.02)', padding: '10px 12px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <h4 style={{ fontSize: '0.9rem', fontWeight: 800, margin: 0 }}>
                              Order #{ordIdx + 1}: {activeOrder.displayId}
                            </h4>
                            {activeOrder.dinerLabel && (
                              <span
                                style={{
                                  background: 'rgba(56, 189, 248, 0.15)',
                                  border: '1px solid rgba(56, 189, 248, 0.35)',
                                  color: '#38bdf8',
                                  padding: '1px 6px',
                                  borderRadius: '4px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                }}
                              >
                                👤 {activeOrder.dinerLabel}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>🕒 {activeOrder.createdAt}</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '0.85rem' }}>
                          {activeOrder.items.map((i) => {
                            const isReady = i.status === 'READY';
                            const isServed = i.status === 'SERVED';
                            const isHeld = i.holdStatus === 'SERVE_LATER_HOLD' || i.holdStatus === 'SCHEDULED_WAIT';
                            const isCooking = !isHeld && i.status === 'PREPARING';
                            const isQueued = !isHeld && !isReady && !isServed && !isCooking;

                            return (
                              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '6px 0', borderBottom: '1px dashed rgba(255,255,255,0.06)' }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700 }}>{i.quantity}× {i.name}</span>
                                    {i.dinerLabel && (
                                      <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(56, 189, 248, 0.12)', color: '#38bdf8', fontWeight: 700 }}>
                                        👤 {i.dinerLabel}
                                      </span>
                                    )}
                                    {isReady && <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981', fontWeight: 800 }}>🍽️ ON PASS</span>}
                                    {isServed && <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-muted)' }}>✓ SERVED</span>}
                                    {isCooking && <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24' }}>🔥 COOKING</span>}
                                    {isHeld && <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(168, 85, 247, 0.2)', color: '#c084fc', fontWeight: 800 }}>⏳ ON HOLD</span>}
                                    {isQueued && <span style={{ fontSize: '0.68rem', padding: '1px 5px', borderRadius: '4px', background: 'rgba(255, 255, 255, 0.08)', color: '#94a3b8', fontWeight: 700 }}>📋 QUEUED (Waiting for Chef)</span>}
                                  </div>
                                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                                    🕒 {i.createdAt || activeOrder.createdAt}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                  <span>{formatPaise(i.pricePaise * i.quantity)}</span>
                                  {isHeld && (
                                    <button
                                      type="button"
                                      disabled={releasingHeldOrderId === activeOrder.id}
                                      onClick={() => void handleStaffFireHeldItems(activeOrder.id, i.id)}
                                      style={{
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                                        color: '#fff',
                                        fontSize: '0.72rem',
                                        fontWeight: 800,
                                        border: 'none',
                                        cursor: 'pointer',
                                        whiteSpace: 'nowrap',
                                      }}
                                    >
                                      🔥 Fire Dish
                                    </button>
                                  )}
                                  {isReady && (
                                    <button
                                      type="button"
                                      onClick={() => void transitionItem(activeOrder.id, i.id, 'SERVED')}
                                      className="btn-success"
                                      style={{ padding: '4px 8px', fontSize: '0.72rem', fontWeight: 800, whiteSpace: 'nowrap' }}
                                    >
                                      🏃 Served ✓
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', fontWeight: 800 }}>
                            <span>Order Total:</span>
                            <span style={{ color: 'var(--accent-amber)' }}>{formatPaise(activeOrder.totalPaise)}</span>
                          </div>
                        </div>
                      </div>
                    ))}

                    {activeOrders.length > 1 && (
                      <div style={{ background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 900 }}>
                        <span style={{ color: '#fff' }}>Combined Table Total ({activeOrders.length} Orders):</span>
                        <span style={{ color: 'var(--accent-cyan)', fontSize: '1.05rem' }}>{formatPaise(combinedTotalPaise)}</span>
                      </div>
                    )}

                    {activeOrders.some((ord) => ord.status === 'READY' || ord.items.some((it) => it.status === 'READY')) && (
                      <button
                        onClick={async () => {
                          for (const ord of activeOrders) {
                            const readyItems = ord.items.filter((it) => it.status === 'READY');
                            for (const it of readyItems) {
                              void transitionItem(ord.id, it.id, 'SERVED');
                            }
                            if (ord.status === 'READY') {
                              void transitionOrder(ord.id, 'SERVED');
                            }
                          }
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
                        🏃 Mark Ready Dishes Delivered to Table {selectedTable.number}
                      </button>
                    )}

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <button
                        type="button"
                        disabled={cleaningTableLoading}
                        onClick={() => void handleMarkTableCleaned(selectedTable)}
                        style={{
                          width: '100%',
                          padding: '11px 14px',
                          borderRadius: 'var(--radius-sm)',
                          background: 'linear-gradient(135deg, #06b6d4, #0284c7)',
                          color: '#fff',
                          fontWeight: 800,
                          fontSize: '0.86rem',
                          border: 'none',
                          cursor: cleaningTableLoading ? 'not-allowed' : 'pointer',
                          opacity: cleaningTableLoading ? 0.65 : 1,
                        }}
                      >
                        {cleaningTableLoading
                          ? 'Updating Table...'
                          : `🧹 Mark Table ${selectedTable.number} Cleaned & Ready`}
                      </button>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        {activeOrders.length > 0 && (
                          <button
                            onClick={() => {
                              setCollectPaymentOrder(activeOrders[0] ?? null);
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
                  </div>
                );
              }

              return (
                <div style={{ textAlign: 'center', padding: '20px 0' }}>
                  {upcomingRes && (
                    <div
                      style={{
                        background: 'rgba(59, 130, 246, 0.15)',
                        border: '1px solid rgba(59, 130, 246, 0.4)',
                        borderRadius: '8px',
                        padding: '8px 12px',
                        marginBottom: '16px',
                        fontSize: '0.82rem',
                        color: '#93c5fd',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '6px',
                      }}
                    >
                      <span>📅</span>
                      <span>
                        Upcoming Reservation: {new Date(upcomingRes.reservedFor).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {upcomingRes.guestCount} Pax {upcomingRes.customerName ? `(${upcomingRes.customerName})` : ''}
                      </span>
                    </div>
                  )}
                  <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Table {selectedTable.number} is currently vacant and ready for seating.
                  </p>
                  <button
                    type="button"
                    disabled={cleaningTableLoading}
                    onClick={() => void handleMarkTableCleaned(selectedTable)}
                    style={{
                      width: '100%',
                      marginBottom: '10px',
                      padding: '10px 14px',
                      borderRadius: 'var(--radius-sm)',
                      background: 'rgba(6, 182, 212, 0.16)',
                      border: '1px solid rgba(6, 182, 212, 0.4)',
                      color: '#67e8f9',
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                    }}
                  >
                    {cleaningTableLoading ? 'Cleaning...' : `🧹 Confirm Table ${selectedTable.number} Cleaned & Ready`}
                  </button>
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

      {staffToast && (
        <div
          style={{
            position: 'fixed',
            bottom: '84px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#0f172a',
            border: '1px solid rgba(6, 182, 212, 0.5)',
            color: '#f8fafc',
            padding: '10px 18px',
            borderRadius: '999px',
            fontWeight: 700,
            fontSize: '0.85rem',
            zIndex: 9999,
            boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
          }}
        >
          {staffToast}
        </div>
      )}
    </div>
  );
}
