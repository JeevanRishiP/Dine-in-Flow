import { create } from 'zustand';
import type {
  Order,
  OrderItem,
  KdsItemTicket,
  TableReservationRecord,
  Table,
  TableSession,
  MenuItem,
  ServiceCall,
  StaffMember,
  Payment,
} from '../app/lib/restaurant-db';

export interface ServeLaterPromptNotification {
  orderId: string;
  tableNumber: string;
  items?: string[];
  unreleasedItems?: Array<{ id: string; name: string }>;
  promptSentAt?: string;
  triggeredAt?: number;
}

// ============================================================================
// Types & View Definitions
// ============================================================================

/**
 * Standard decomposed dashboard view identifiers:
 * - KDS: Kitchen Display System (ticket prep & Kanban)
 * - FLOOR: Table map, seating & guest session status
 * - CASHIER: POS register, billing, invoicing & payments
 * - WAITER: Food pass & table delivery queue
 * - STOCK: 86 item availability toggles
 * - MENU: Menu catalog manager
 * - CALLS: Guest service bells & calls
 * - MORE: Secondary settings & tools
 */
export type StaffDashboardView =
  | 'KDS'
  | 'FLOOR'
  | 'CASHIER'
  | 'WAITER'
  | 'STOCK'
  | 'MENU'
  | 'CALLS'
  | 'MORE';

/**
 * Legacy tab identifiers preserved for seamless backward compatibility
 */
export type StaffTab =
  | 'ORDERS'
  | 'TABLES'
  | 'PASS'
  | 'STOCK'
  | 'MENU'
  | 'CALLS'
  | 'POS'
  | 'MORE';

export type TableOccupancyStatus = 'VACANT' | 'OCCUPIED' | 'NEEDS_CLEANING';

export interface WebSocketEventMessage {
  id: string;
  org_id?: string;
  outlet_id?: string;
  aggregate?: string;
  eventType: string;
  payload?: unknown;
  receivedAt?: number;
}

export interface RoleWorkstationConfig {
  defaultView: StaffDashboardView;
  defaultTab: StaffTab;
  allowedViews: StaffDashboardView[];
  allowedTabs: StaffTab[];
  stationTitle: string;
  stationBadge: string;
  stationEmoji: string;
  stationDescription: string;
}

export const ROLE_CONFIGS: Record<StaffMember['role'], RoleWorkstationConfig> = {
  KITCHEN: {
    defaultView: 'KDS',
    defaultTab: 'ORDERS',
    allowedViews: ['KDS', 'STOCK'],
    allowedTabs: ['ORDERS', 'STOCK'],
    stationTitle: 'Kitchen Display System (KDS)',
    stationBadge: '🍳 KITCHEN WORKSTATION',
    stationEmoji: '🍳',
    stationDescription: 'Live ticket prep queue & 86 stock availability',
  },
  CAPTAIN: {
    defaultView: 'FLOOR',
    defaultTab: 'TABLES',
    allowedViews: ['FLOOR', 'WAITER', 'CALLS'],
    allowedTabs: ['TABLES', 'PASS', 'CALLS'],
    stationTitle: 'Floor Captain & Seating Station',
    stationBadge: '🪑 FLOOR & SERVICE',
    stationEmoji: '👨‍💼',
    stationDescription: 'Table seating map, guest sessions & service bells',
  },
  WAITER: {
    defaultView: 'WAITER',
    defaultTab: 'PASS',
    allowedViews: ['WAITER', 'FLOOR', 'CALLS'],
    allowedTabs: ['PASS', 'TABLES', 'CALLS'],
    stationTitle: 'Food Pass & Table Delivery',
    stationBadge: '🤵 TABLE SERVER',
    stationEmoji: '🤵',
    stationDescription: 'Pick up ready dishes, deliver to tables & attend bells',
  },
  CASHIER: {
    defaultView: 'CASHIER',
    defaultTab: 'POS',
    allowedViews: ['CASHIER', 'FLOOR'],
    allowedTabs: ['POS', 'TABLES'],
    stationTitle: 'Cashier Register & Billing Station',
    stationBadge: '💳 FINANCE & POS',
    stationEmoji: '👩‍💼',
    stationDescription: 'Payment collection (UPI/Cash/Card), GST invoices & settlement',
  },
  MANAGER: {
    defaultView: 'FLOOR',
    defaultTab: 'TABLES',
    allowedViews: ['KDS', 'FLOOR', 'WAITER', 'STOCK', 'MENU', 'CALLS', 'CASHIER'],
    allowedTabs: ['ORDERS', 'TABLES', 'PASS', 'STOCK', 'MENU', 'CALLS', 'POS'],
    stationTitle: 'Floor Operations Cockpit',
    stationBadge: '👔 GENERAL MANAGER',
    stationEmoji: '👔',
    stationDescription: 'Full multi-station access across Kitchen, Floor, Pass, Menu, and POS',
  },
  OWNER: {
    defaultView: 'FLOOR',
    defaultTab: 'TABLES',
    allowedViews: ['KDS', 'FLOOR', 'WAITER', 'STOCK', 'MENU', 'CALLS', 'CASHIER'],
    allowedTabs: ['ORDERS', 'TABLES', 'PASS', 'STOCK', 'MENU', 'CALLS', 'POS'],
    stationTitle: 'Executive Floor Operations',
    stationBadge: '👑 GROUP OWNER',
    stationEmoji: '👑',
    stationDescription: 'Complete organizational oversight across all floor stations & Menu',
  },
};

/**
 * Bidirectional conversion between decomposed view IDs and legacy tab IDs
 */
export function toDashboardView(tab: StaffTab | StaffDashboardView): StaffDashboardView {
  switch (tab) {
    case 'ORDERS':
      return 'KDS';
    case 'TABLES':
      return 'FLOOR';
    case 'PASS':
      return 'WAITER';
    case 'POS':
      return 'CASHIER';
    default:
      return tab as StaffDashboardView;
  }
}

export function toStaffTab(view: StaffDashboardView | StaffTab): StaffTab {
  switch (view) {
    case 'KDS':
      return 'ORDERS';
    case 'FLOOR':
      return 'TABLES';
    case 'WAITER':
      return 'PASS';
    case 'CASHIER':
      return 'POS';
    default:
      return view as StaffTab;
  }
}

// ============================================================================
// Store State Interface
// ============================================================================

export interface StaffStoreState {
  // ── Navigation & Station View State ──
  activeView: StaffDashboardView;
  activeTab: StaffTab;
  setActiveView: (view: StaffDashboardView | StaffTab) => void;
  setActiveTab: (tab: StaffTab | StaffDashboardView) => void;

  // ── Role & Authentication Context ──
  currentUser: StaffMember | null;
  setCurrentUser: (user: StaffMember | null) => void;
  currentRole: StaffMember['role'];
  setCurrentRole: (role: StaffMember['role']) => void;
  isOwnerMode: boolean;
  setIsOwnerMode: (isOwner: boolean) => void;
  ownerViewRole: StaffMember['role'] | null;
  setOwnerViewRole: (role: StaffMember['role'] | null) => void;
  selectedOutletId: string;
  setSelectedOutletId: (outletId: string) => void;

  // ── Connection & Socket State ──
  connectionStatus: 'live' | 'degraded' | 'offline';
  setConnectionStatus: (status: 'live' | 'degraded' | 'offline') => void;
  webSocketEventQueue: WebSocketEventMessage[];
  pushWebSocketEvent: (event: WebSocketEventMessage) => void;
  clearWebSocketEventQueue: () => void;

  // ── Orders Queue State (Live & Socket Feed) ──
  orders: Order[];
  setOrders: (orders: Order[] | ((prev: Order[]) => Order[])) => void;
  addOrUpdateOrder: (order: Order) => void;
  updateOrderStatus: (orderId: string, status: Order['status']) => void;
  updateOrderItemStatus: (orderId: string, itemId: string, status: OrderItem['status']) => void;
  removeOrder: (orderId: string) => void;

  // ── KDS & Smart Kitchen State ──
  kdsViewMode: 'KANBAN' | 'PRIORITY_QUEUE';
  setKdsViewMode: (mode: 'KANBAN' | 'PRIORITY_QUEUE') => void;
  kdsItems: KdsItemTicket[];
  lastKdsSyncedAt: string | null;
  setLastKdsSyncedAt: (ts: string | null) => void;
  setKdsItems: (items: KdsItemTicket[] | ((prev: KdsItemTicket[]) => KdsItemTicket[])) => void;
  upsertKdsItem: (item: KdsItemTicket) => void;
  updateKdsItemStatus: (itemId: string, status: string, holdStatus?: 'ACTIVE' | 'SCHEDULED_WAIT' | 'SERVE_LATER_HOLD' | 'RELEASED') => void;
  serveLaterPrompts: ServeLaterPromptNotification[];
  addServeLaterPrompt: (prompt: ServeLaterPromptNotification) => void;
  dismissServeLaterPrompt: (orderId: string) => void;

  // ── Table Occupancy & Floor State ──
  tables: Table[];
  setTables: (tables: Table[] | ((prev: Table[]) => Table[])) => void;
  sessions: TableSession[];
  setSessions: (sessions: TableSession[] | ((prev: TableSession[]) => TableSession[])) => void;
  reservations: TableReservationRecord[];
  setReservations: (reservations: TableReservationRecord[] | ((prev: TableReservationRecord[]) => TableReservationRecord[])) => void;
  needsCleaningTableIds: string[];
  setNeedsCleaningTableIds: (ids: string[] | Set<string> | ((prev: string[]) => string[])) => void;
  markTableCleaned: (tableId: string) => void;
  markTableNeedsCleaning: (tableId: string) => void;
  getTableOccupancyStatus: (tableId: string, tableNumber?: string) => TableOccupancyStatus;

  // ── Cashier POS & Settlement State ──
  payments: Payment[];
  setPayments: (payments: Payment[] | ((prev: Payment[]) => Payment[])) => void;
  recordPayment: (payment: Payment) => void;

  // ── 86 Stock State ──
  stock: MenuItem[];
  setStock: (stock: MenuItem[] | ((prev: MenuItem[]) => MenuItem[])) => void;
  toggleStockItem: (itemId: string) => void;

  // ── Service Bells / Calls State ──
  calls: ServiceCall[];
  setCalls: (calls: ServiceCall[] | ((prev: ServiceCall[]) => ServiceCall[])) => void;
  acknowledgeCall: (callId: string) => void;
  resolveCall: (callId: string) => void;

  // ── Audio & Notification State ──
  isSoundMuted: boolean;
  setIsSoundMuted: (isMuted: boolean | ((prev: boolean) => boolean)) => void;
  staffToast: string | null;
  showStaffToast: (msg: string) => void;
  clearStaffToast: () => void;
}

// ============================================================================
// Store Implementation
// ============================================================================

export const useStaffStore = create<StaffStoreState>((set, get) => ({
  // ── Navigation & Station View State ──
  activeView: 'FLOOR',
  activeTab: 'TABLES',
  setActiveView: (view) => {
    const canonicalView = toDashboardView(view);
    const tab = toStaffTab(view);
    set({ activeView: canonicalView, activeTab: tab });
  },
  setActiveTab: (tab) => {
    const canonicalView = toDashboardView(tab);
    const canonicalTab = toStaffTab(tab);
    set({ activeView: canonicalView, activeTab: canonicalTab });
  },

  // ── Role & Authentication Context ──
  currentUser: null,
  setCurrentUser: (user) => {
    if (!user) {
      set({ currentUser: null });
      return;
    }
    const config = ROLE_CONFIGS[user.role] || ROLE_CONFIGS.CAPTAIN;
    set({
      currentUser: user,
      currentRole: user.role,
      activeView: config.defaultView,
      activeTab: config.defaultTab,
      ...(user.outletId ? { selectedOutletId: user.outletId } : {}),
    });
  },
  currentRole: 'CAPTAIN',
  setCurrentRole: (role) => {
    const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.CAPTAIN;
    set((state) => {
      // If current activeView is not allowed in the new role, switch to default
      const isAllowed = config.allowedViews.includes(state.activeView);
      return {
        currentRole: role,
        ...(isAllowed ? {} : { activeView: config.defaultView, activeTab: config.defaultTab }),
      };
    });
  },
  isOwnerMode: false,
  setIsOwnerMode: (isOwner) => set({ isOwnerMode: isOwner }),
  ownerViewRole: null,
  setOwnerViewRole: (role) => {
    if (!role) {
      set({ ownerViewRole: null });
      return;
    }
    const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.CAPTAIN;
    set({
      ownerViewRole: role,
      activeView: config.defaultView,
      activeTab: config.defaultTab,
    });
  },
  selectedOutletId: '71ad00a6-d79b-4035-b563-bf9543fcfa86',
  setSelectedOutletId: (outletId) => set({ selectedOutletId: outletId }),

  // ── Connection & Socket State ──
  connectionStatus: 'live',
  setConnectionStatus: (status) => set({ connectionStatus: status }),
  webSocketEventQueue: [],
  pushWebSocketEvent: (event) => {
    // Dispatch smart kitchen events
    if (event.eventType === 'kds.item_fired') {
      const payload = event.payload as any;
      if (payload?.itemId) {
        get().updateKdsItemStatus(payload.itemId, payload.status || 'PREPARING', 'RELEASED');
      }
    } else if (event.eventType === 'course.prompt_serve_later') {
      const payload = event.payload as any;
      if (payload?.orderId) {
        get().addServeLaterPrompt({
          orderId: payload.orderId,
          tableNumber: payload.tableNumber || '--',
          unreleasedItems: payload.unreleasedItems || [],
          promptSentAt: new Date().toISOString(),
        });
      }
    }

    set((state) => ({
      webSocketEventQueue: [
        { ...event, receivedAt: event.receivedAt ?? Date.now() },
        ...state.webSocketEventQueue.slice(0, 99),
      ],
    }));
  },
  clearWebSocketEventQueue: () => set({ webSocketEventQueue: [] }),

  // ── Orders Queue State (Live & Socket Feed) ──
  orders: [],
  setOrders: (ordersOrUpdater) =>
    set((state) => ({
      orders: typeof ordersOrUpdater === 'function' ? ordersOrUpdater(state.orders) : ordersOrUpdater,
    })),
  addOrUpdateOrder: (order) =>
    set((state) => {
      const idx = state.orders.findIndex((o) => o.id === order.id);
      if (idx === -1) {
        return { orders: [order, ...state.orders] };
      }
      const updated = [...state.orders];
      updated[idx] = order;
      return { orders: updated };
    }),
  updateOrderStatus: (orderId, status) =>
    set((state) => ({
      orders: state.orders.map((o) => (o.id === orderId ? { ...o, status } : o)),
    })),
  updateOrderItemStatus: (orderId, itemId, status) =>
    set((state) => ({
      orders: state.orders.map((o) => {
        if (o.id !== orderId) return o;
        const updatedItems = o.items.map((it) => (it.id === itemId ? { ...it, status } : it));
        return { ...o, items: updatedItems };
      }),
    })),
  removeOrder: (orderId) =>
    set((state) => ({
      orders: state.orders.filter((o) => o.id !== orderId),
    })),

  // ── KDS & Smart Kitchen State ──
  kdsViewMode: 'KANBAN',
  setKdsViewMode: (mode) => set({ kdsViewMode: mode }),
  kdsItems: [],
  lastKdsSyncedAt: null,
  setLastKdsSyncedAt: (ts) => set({ lastKdsSyncedAt: ts }),
  setKdsItems: (itemsOrUpdater) =>
    set((state) => ({
      kdsItems: typeof itemsOrUpdater === 'function' ? itemsOrUpdater(state.kdsItems) : itemsOrUpdater,
    })),
  upsertKdsItem: (item) =>
    set((state) => {
      const idx = state.kdsItems.findIndex((it) => it.itemId === item.itemId);
      if (idx === -1) {
        return { kdsItems: [...state.kdsItems, item] };
      }
      const updated = [...state.kdsItems];
      updated[idx] = { ...updated[idx], ...item };
      return { kdsItems: updated };
    }),
  updateKdsItemStatus: (itemId, status, holdStatus) =>
    set((state) => ({
      kdsItems: state.kdsItems.map((it) =>
        it.itemId === itemId
          ? {
              ...it,
              itemStatus: status,
              ...(holdStatus ? { holdStatus } : {}),
            }
          : it,
      ),
      orders: state.orders.map((o) => ({
        ...o,
        items: o.items.map((it) =>
          it.id === itemId
            ? {
                ...it,
                status: status as any,
                ...(holdStatus ? { holdStatus: holdStatus as any } : {}),
              }
            : it,
        ),
      })),
    })),
  serveLaterPrompts: [],
  addServeLaterPrompt: (prompt) =>
    set((state) => {
      if (state.serveLaterPrompts.some((p) => p.orderId === prompt.orderId)) return state;
      return { serveLaterPrompts: [prompt, ...state.serveLaterPrompts] };
    }),
  dismissServeLaterPrompt: (orderId) =>
    set((state) => ({
      serveLaterPrompts: state.serveLaterPrompts.filter((p) => p.orderId !== orderId),
    })),

  // ── Table Occupancy & Floor State ──
  tables: [],
  setTables: (tablesOrUpdater) =>
    set((state) => ({
      tables: typeof tablesOrUpdater === 'function' ? tablesOrUpdater(state.tables) : tablesOrUpdater,
    })),
  sessions: [],
  setSessions: (sessionsOrUpdater) =>
    set((state) => ({
      sessions:
        typeof sessionsOrUpdater === 'function' ? sessionsOrUpdater(state.sessions) : sessionsOrUpdater,
    })),
  reservations: [],
  setReservations: (reservationsOrUpdater) =>
    set((state) => ({
      reservations:
        typeof reservationsOrUpdater === 'function'
          ? reservationsOrUpdater(state.reservations)
          : reservationsOrUpdater,
    })),
  needsCleaningTableIds: [],
  setNeedsCleaningTableIds: (idsOrUpdater) =>
    set((state) => {
      if (typeof idsOrUpdater === 'function') {
        return { needsCleaningTableIds: idsOrUpdater(state.needsCleaningTableIds) };
      }
      const arr = idsOrUpdater instanceof Set ? Array.from(idsOrUpdater) : idsOrUpdater;
      return { needsCleaningTableIds: arr };
    }),
  markTableCleaned: (tableId) =>
    set((state) => {
      const table = (state.tables || []).find((t) => t.id === tableId);
      const tableNum = table?.number || (table as any)?.tableNumber;
      return {
        needsCleaningTableIds: (state.needsCleaningTableIds || []).filter((id) => id !== tableId),
        sessions: (state.sessions || []).filter((s) => s.tableId !== tableId || s.status === 'OPEN'),
        orders: (state.orders || []).filter(
          (o) =>
            o.tableId !== tableId &&
            (!tableNum || o.tableNumber !== tableNum),
        ),
        kdsItems: (state.kdsItems || []).filter(
          (k) =>
            k.tableId !== tableId &&
            (!tableNum || k.tableNumber !== tableNum),
        ),
        serveLaterPrompts: (state.serveLaterPrompts || []).filter(
          (p) => !tableNum || p.tableNumber !== tableNum,
        ),
      };
    }),
  markTableNeedsCleaning: (tableId) =>
    set((state) => {
      if (state.needsCleaningTableIds.includes(tableId)) return state;
      return { needsCleaningTableIds: [...state.needsCleaningTableIds, tableId] };
    }),
  getTableOccupancyStatus: (tableId, tableNumber) => {
    const state = get();
    if (state.needsCleaningTableIds.includes(tableId)) {
      return 'NEEDS_CLEANING';
    }
    const hasOpenSession = state.sessions.some(
      (s) => s.tableId === tableId && s.status === 'OPEN',
    );
    if (hasOpenSession) {
      return 'OCCUPIED';
    }
    if (tableNumber) {
      const hasActiveOrder = state.orders.some(
        (o) =>
          o.status !== 'CANCELLED' &&
          o.status !== 'BILLED' &&
          (o.tableNumber === tableNumber ||
            o.items?.some((it) => it.targetTableNumber === tableNumber)),
      );
      if (hasActiveOrder) {
        return 'OCCUPIED';
      }
    }
    return 'VACANT';
  },

  // ── Cashier POS & Settlement State ──
  payments: [],
  setPayments: (paymentsOrUpdater) =>
    set((state) => ({
      payments:
        typeof paymentsOrUpdater === 'function'
          ? paymentsOrUpdater(state.payments)
          : paymentsOrUpdater,
    })),
  recordPayment: (payment) =>
    set((state) => ({
      payments: [payment, ...state.payments],
      orders: state.orders.filter((o) => o.id !== payment.orderId),
    })),

  // ── 86 Stock State ──
  stock: [],
  setStock: (stockOrUpdater) =>
    set((state) => ({
      stock: typeof stockOrUpdater === 'function' ? stockOrUpdater(state.stock) : stockOrUpdater,
    })),
  toggleStockItem: (itemId) =>
    set((state) => ({
      stock: state.stock.map((item) =>
        item.id === itemId ? { ...item, isAvailable: !item.isAvailable } : item,
      ),
    })),

  // ── Service Bells / Calls State ──
  calls: [],
  setCalls: (callsOrUpdater) =>
    set((state) => ({
      calls: typeof callsOrUpdater === 'function' ? callsOrUpdater(state.calls) : callsOrUpdater,
    })),
  acknowledgeCall: (callId) =>
    set((state) => ({
      calls: state.calls.map((c) => (c.id === callId ? { ...c, status: 'ACKNOWLEDGED' } : c)),
    })),
  resolveCall: (callId) =>
    set((state) => ({
      calls: state.calls.filter((c) => c.id !== callId),
    })),

  // ── Audio & Notification State ──
  isSoundMuted: true,
  setIsSoundMuted: (isMutedOrUpdater) =>
    set((state) => ({
      isSoundMuted:
        typeof isMutedOrUpdater === 'function' ? isMutedOrUpdater(state.isSoundMuted) : isMutedOrUpdater,
    })),
  staffToast: null,
  showStaffToast: (msg) => {
    set({ staffToast: msg });
    setTimeout(() => {
      if (get().staffToast === msg) {
        set({ staffToast: null });
      }
    }, 4000);
  },
  clearStaffToast: () => set({ staffToast: null }),
}));
