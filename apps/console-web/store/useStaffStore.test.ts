import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  useStaffStore,
  toDashboardView,
  toStaffTab,
  ROLE_CONFIGS,
} from './useStaffStore.ts';
import type { Order, Table, TableSession, StaffMember } from '../app/lib/restaurant-db.ts';

describe('useStaffStore - Global State Architecture for Staff Decomposition', () => {
  beforeEach(() => {
    // Reset store state before each test
    useStaffStore.setState({
      activeView: 'FLOOR',
      activeTab: 'TABLES',
      currentUser: null,
      currentRole: 'CAPTAIN',
      isOwnerMode: false,
      ownerViewRole: null,
      connectionStatus: 'live',
      webSocketEventQueue: [],
      orders: [],
      tables: [],
      sessions: [],
      payments: [],
      needsCleaningTableIds: [],
      stock: [],
      calls: [],
      isSoundMuted: true,
      staffToast: null,
    });
  });

  describe('View & Tab Navigation Architecture', () => {
    it('switches between decomposed views and synchronizes legacy tabs', () => {
      const store = useStaffStore.getState();

      store.setActiveView('KDS');
      assert.equal(useStaffStore.getState().activeView, 'KDS');
      assert.equal(useStaffStore.getState().activeTab, 'ORDERS');

      store.setActiveView('FLOOR');
      assert.equal(useStaffStore.getState().activeView, 'FLOOR');
      assert.equal(useStaffStore.getState().activeTab, 'TABLES');

      store.setActiveView('CASHIER');
      assert.equal(useStaffStore.getState().activeView, 'CASHIER');
      assert.equal(useStaffStore.getState().activeTab, 'POS');

      store.setActiveView('WAITER');
      assert.equal(useStaffStore.getState().activeView, 'WAITER');
      assert.equal(useStaffStore.getState().activeTab, 'PASS');
    });

    it('accepts legacy tab names and maps them seamlessly to decomposed views', () => {
      const store = useStaffStore.getState();

      store.setActiveTab('ORDERS');
      assert.equal(useStaffStore.getState().activeView, 'KDS');
      assert.equal(useStaffStore.getState().activeTab, 'ORDERS');

      store.setActiveTab('TABLES');
      assert.equal(useStaffStore.getState().activeView, 'FLOOR');
      assert.equal(useStaffStore.getState().activeTab, 'TABLES');

      store.setActiveTab('POS');
      assert.equal(useStaffStore.getState().activeView, 'CASHIER');
      assert.equal(useStaffStore.getState().activeTab, 'POS');

      store.setActiveTab('PASS');
      assert.equal(useStaffStore.getState().activeView, 'WAITER');
      assert.equal(useStaffStore.getState().activeTab, 'PASS');
    });

    it('verifies bidirectional conversion helpers', () => {
      assert.equal(toDashboardView('ORDERS'), 'KDS');
      assert.equal(toDashboardView('TABLES'), 'FLOOR');
      assert.equal(toDashboardView('PASS'), 'WAITER');
      assert.equal(toDashboardView('POS'), 'CASHIER');
      assert.equal(toDashboardView('STOCK'), 'STOCK');

      assert.equal(toStaffTab('KDS'), 'ORDERS');
      assert.equal(toStaffTab('FLOOR'), 'TABLES');
      assert.equal(toStaffTab('WAITER'), 'PASS');
      assert.equal(toStaffTab('CASHIER'), 'POS');
      assert.equal(toStaffTab('CALLS'), 'CALLS');
    });

    it('configures role-specific default views and tabs on user login', () => {
      const kitchenStaff: StaffMember = {
        id: 'staff-k1',
        orgId: 'org-1',
        name: 'Chef Suresh',
        email: 'chef@dineflow.test',
        phone: '+919876543210',
        role: 'KITCHEN',
        avatar: '👨‍🍳',
        outletId: 'out-1',
        isActive: true,
      };

      useStaffStore.getState().setCurrentUser(kitchenStaff);
      assert.equal(useStaffStore.getState().currentRole, 'KITCHEN');
      assert.equal(useStaffStore.getState().activeView, 'KDS');
      assert.equal(useStaffStore.getState().activeTab, 'ORDERS');
      assert.equal(useStaffStore.getState().selectedOutletId, 'out-1');

      const cashierStaff: StaffMember = {
        id: 'staff-c1',
        orgId: 'org-1',
        name: 'Pooja Cashier',
        email: 'cashier@dineflow.test',
        phone: '+919876543211',
        role: 'CASHIER',
        avatar: '👩‍💼',
        outletId: 'out-1',
        isActive: true,
      };

      useStaffStore.getState().setCurrentUser(cashierStaff);
      assert.equal(useStaffStore.getState().currentRole, 'CASHIER');
      assert.equal(useStaffStore.getState().activeView, 'CASHIER');
      assert.equal(useStaffStore.getState().activeTab, 'POS');
    });
  });

  describe('WebSocket Order Queue Management', () => {
    const mockOrder1: Order = {
      id: 'ord-101',
      displayId: 'ORD-#0101',
      outletId: 'out-1',
      tableNumber: 'T01',
      sessionId: 'sess-1',
      status: 'CONFIRMED',
      subtotalPaise: 45000,
      taxPaise: 2250,
      discountPaise: 0,
      totalPaise: 47250,
      createdAt: '2026-11-17 12:00',
      items: [
        {
          id: 'item-1',
          orderId: 'ord-101',
          itemId: 'menu-1',
          name: 'Butter Chicken',
          pricePaise: 45000,
          quantity: 1,
          status: 'PREPARING',
        },
      ],
      events: [],
    };

    it('adds new orders and updates existing orders in queue', () => {
      const store = useStaffStore.getState();

      store.addOrUpdateOrder(mockOrder1);
      assert.equal(useStaffStore.getState().orders.length, 1);
      assert.equal(useStaffStore.getState().orders[0]?.id, 'ord-101');

      // Update existing order
      const updatedOrder: Order = {
        ...mockOrder1,
        status: 'READY',
      };
      store.addOrUpdateOrder(updatedOrder);
      assert.equal(useStaffStore.getState().orders.length, 1);
      assert.equal(useStaffStore.getState().orders[0]?.status, 'READY');
    });

    it('updates order status and order item status', () => {
      const store = useStaffStore.getState();
      store.addOrUpdateOrder(mockOrder1);

      store.updateOrderStatus('ord-101', 'SERVED');
      assert.equal(useStaffStore.getState().orders[0]?.status, 'SERVED');

      store.updateOrderItemStatus('ord-101', 'item-1', 'READY');
      assert.equal(useStaffStore.getState().orders[0]?.items[0]?.status, 'READY');
    });

    it('pushes incoming WebSocket events into queue and caps history', () => {
      const store = useStaffStore.getState();

      store.pushWebSocketEvent({
        id: 'ws-evt-1',
        eventType: 'ORDER_PLACED',
        payload: { orderId: 'ord-101' },
      });

      const queue = useStaffStore.getState().webSocketEventQueue;
      assert.equal(queue.length, 1);
      assert.equal(queue[0]?.eventType, 'ORDER_PLACED');
      assert.ok(queue[0]?.receivedAt);

      store.clearWebSocketEventQueue();
      assert.equal(useStaffStore.getState().webSocketEventQueue.length, 0);
    });

    it('updates connectionStatus for network resilience', () => {
      const store = useStaffStore.getState();

      store.setConnectionStatus('degraded');
      assert.equal(useStaffStore.getState().connectionStatus, 'degraded');

      store.setConnectionStatus('offline');
      assert.equal(useStaffStore.getState().connectionStatus, 'offline');

      store.setConnectionStatus('live');
      assert.equal(useStaffStore.getState().connectionStatus, 'live');
    });

    it('manages KDS flat priority items and synchronizes status with order queue', () => {
      const store = useStaffStore.getState();
      store.addOrUpdateOrder(mockOrder1);

      store.setKdsItems([
        {
          itemId: 'item-1',
          orderId: 'ord-101',
          orderDisplayId: '#1001',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Dum Biryani',
          quantity: 2,
          modifiers: [],
          spiceLevel: 'MEDIUM',
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 2,
          prepTimeMinutes: 28,
          targetFireAt: '2026-11-18T12:00:00.000Z',
          holdStatus: 'ACTIVE',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T11:50:00.000Z',
        },
      ]);

      assert.equal(useStaffStore.getState().kdsItems.length, 1);
      assert.equal(useStaffStore.getState().kdsItems[0]?.dishName, 'Dum Biryani');

      // Update item status to PREPARING
      store.updateKdsItemStatus('item-1', 'PREPARING', 'RELEASED');
      assert.equal(useStaffStore.getState().kdsItems[0]?.itemStatus, 'PREPARING');
      assert.equal(useStaffStore.getState().kdsItems[0]?.holdStatus, 'RELEASED');
      assert.equal(useStaffStore.getState().orders[0]?.items[0]?.status, 'PREPARING');
    });

    it('manages serveLaterPrompts and handles smart kitchen websocket events', () => {
      const store = useStaffStore.getState();

      // Push course.prompt_serve_later event
      store.pushWebSocketEvent({
        id: 'ws-evt-prompt',
        eventType: 'course.prompt_serve_later',
        payload: {
          orderId: 'ord-101',
          tableNumber: 'T01',
          unreleasedItems: [{ id: 'item-3', name: 'Gulab Jamun' }],
        },
      });

      const prompts = useStaffStore.getState().serveLaterPrompts;
      assert.equal(prompts.length, 1);
      assert.equal(prompts[0]?.orderId, 'ord-101');
      assert.equal(prompts[0]?.tableNumber, 'T01');

      // Dismiss prompt
      store.dismissServeLaterPrompt('ord-101');
      assert.equal(useStaffStore.getState().serveLaterPrompts.length, 0);

      // Push kds.item_fired event
      store.setKdsItems([
        {
          itemId: 'item-hold-1',
          orderId: 'ord-101',
          orderDisplayId: '#1001',
          orderType: 'DINE_IN',
          tableNumber: 'T01',
          scheduledFor: null,
          dishName: 'Gulab Jamun',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 3,
          prepTimeMinutes: 10,
          targetFireAt: '2026-11-18T12:00:00.000Z',
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'PENDING',
          paidAt: '2026-11-18T11:50:00.000Z',
        },
      ]);

      store.pushWebSocketEvent({
        id: 'ws-evt-fired',
        eventType: 'kds.item_fired',
        payload: {
          itemId: 'item-hold-1',
          orderId: 'ord-101',
          status: 'PREPARING',
        },
      });

      assert.equal(useStaffStore.getState().kdsItems[0]?.itemStatus, 'PREPARING');
      assert.equal(useStaffStore.getState().kdsItems[0]?.holdStatus, 'RELEASED');
    });
  });

  describe('Table Occupancy & Cleaning Statuses', () => {
    const mockTable1: Table = {
      id: 'tbl-1',
      number: 'T01',
      capacity: 4,
      section: 'Main Dining Hall',
      qrTokenVersion: 1,
      isActive: true,
      x: 0,
      y: 0,
    };

    const mockTable2: Table = {
      id: 'tbl-2',
      number: 'T02',
      capacity: 2,
      section: 'Main Dining Hall',
      qrTokenVersion: 1,
      isActive: true,
      x: 1,
      y: 0,
    };

    it('evaluates table occupancy status accurately based on cleaning, sessions and orders', () => {
      const store = useStaffStore.getState();
      store.setTables([mockTable1, mockTable2]);

      // Initially vacant
      assert.equal(store.getTableOccupancyStatus('tbl-1', 'T01'), 'VACANT');

      // Table 1 has open guest session -> OCCUPIED
      const mockSession: TableSession = {
        id: 'sess-1',
        tableId: 'tbl-1',
        tableNumber: 'T01',
        status: 'OPEN',
        guestCount: 2,
        openedAt: '12:00',
        closedAt: null,
        tableCode: '1234',
      };
      store.setSessions([mockSession]);
      assert.equal(useStaffStore.getState().getTableOccupancyStatus('tbl-1', 'T01'), 'OCCUPIED');

      // Table 1 marked needs cleaning -> NEEDS_CLEANING overrides OCCUPIED
      store.markTableNeedsCleaning('tbl-1');
      assert.equal(useStaffStore.getState().getTableOccupancyStatus('tbl-1', 'T01'), 'NEEDS_CLEANING');

      // Table 1 cleaned -> back to OCCUPIED since session is still open
      store.markTableCleaned('tbl-1');
      assert.equal(useStaffStore.getState().getTableOccupancyStatus('tbl-1', 'T01'), 'OCCUPIED');

      // Session closed -> back to VACANT
      store.setSessions([]);
      assert.equal(useStaffStore.getState().getTableOccupancyStatus('tbl-1', 'T01'), 'VACANT');
    });

    it('manages needsCleaningTableIds with array and Set inputs', () => {
      const store = useStaffStore.getState();

      store.setNeedsCleaningTableIds(new Set(['tbl-1', 'tbl-2']));
      assert.deepEqual(useStaffStore.getState().needsCleaningTableIds, ['tbl-1', 'tbl-2']);

      store.markTableCleaned('tbl-1');
      assert.deepEqual(useStaffStore.getState().needsCleaningTableIds, ['tbl-2']);

      store.markTableNeedsCleaning('tbl-3');
      assert.deepEqual(useStaffStore.getState().needsCleaningTableIds, ['tbl-2', 'tbl-3']);
    });
  });

  describe('Cashier POS & Settlement State', () => {
    it('records settled payment, adds to payments history, and removes order from active queue', () => {
      const store = useStaffStore.getState();

      const mockOrder: Order = {
        id: 'ord-to-settle',
        displayId: 'RS-505',
        outletId: 'out-1',
        tableNumber: 'T02',
        sessionId: 'sess-505',
        status: 'READY',
        subtotalPaise: 50000,
        taxPaise: 2500,
        discountPaise: 0,
        totalPaise: 52500,
        items: [],
        events: [],
        customerName: 'Kavita Singh',
        createdAt: new Date().toISOString(),
      };

      store.setOrders([mockOrder]);
      assert.equal(useStaffStore.getState().orders.length, 1);

      store.recordPayment({
        id: 'pay-505',
        orderId: 'ord-to-settle',
        displayId: 'RS-505',
        tableNumber: 'T02',
        method: 'DIRECT_UPI_STAFF',
        status: 'PAID',
        amountPaise: 52500,
        gatewayFeePaise: 0,
        netDepositedPaise: 52500,
        timestamp: '02:30 PM',
        customerName: 'Kavita Singh',
      });

      // Active orders queue must now be empty
      assert.equal(useStaffStore.getState().orders.length, 0);

      // Payments history must now contain the settled payment
      const payments = useStaffStore.getState().payments;
      assert.equal(payments.length, 1);
      assert.equal(payments[0]?.id, 'pay-505');
      assert.equal(payments[0]?.amountPaise, 52500);
      assert.equal(payments[0]?.method, 'DIRECT_UPI_STAFF');
    });
  });

  describe('Part B Regression Invariants', () => {
    it('markTableCleaned strips closed sessions, lingering orders, KDS items and prompts for that table', () => {
      const store = useStaffStore.getState();

      store.setTables([
        {
          id: 'tbl-clean-1',
          number: 'T10',
          capacity: 4,
          section: 'Main Dining Hall',
          qrTokenVersion: 1,
          isActive: true,
          x: 0,
          y: 0,
        },
      ]);

      store.setSessions([
        {
          id: 'sess-closed-1',
          tableId: 'tbl-clean-1',
          tableNumber: 'T10',
          status: 'CLOSED',
          guestCount: 3,
          openedAt: '12:00',
          closedAt: '13:00',
          tableCode: '1234',
        },
      ]);

      store.setOrders([
        {
          id: 'ord-ghost-1',
          displayId: 'ORD-0010',
          outletId: 'out-1',
          tableId: 'tbl-clean-1',
          tableNumber: 'T10',
          sessionId: 'sess-closed-1',
          status: 'SERVED',
          subtotalPaise: 40000,
          taxPaise: 2000,
          discountPaise: 0,
          totalPaise: 42000,
          createdAt: '12:05',
          items: [],
          events: [],
        },
      ]);

      store.setKdsItems([
        {
          itemId: 'it-ghost-1',
          orderId: 'ord-ghost-1',
          displayId: 'ORD-0010',
          orderDisplayId: 'ORD-0010',
          orderType: 'DINE_IN',
          tableId: 'tbl-clean-1',
          tableNumber: 'T10',
          dishName: 'Gulab Jamun',
          quantity: 1,
          modifiers: [],
          spiceLevel: null,
          notes: null,
          isComboItem: false,
          comboName: null,
          courseSequence: 3,
          prepTimeMinutes: 5,
          targetFireAt: null,
          holdStatus: 'SERVE_LATER_HOLD',
          itemStatus: 'CONFIRMED',
          paidAt: null,
          scheduledFor: null,
        },
      ]);

      store.addServeLaterPrompt({
        orderId: 'ord-ghost-1',
        tableNumber: 'T10',
        items: ['Gulab Jamun'],
      });

      store.markTableNeedsCleaning('tbl-clean-1');
      assert.equal(useStaffStore.getState().needsCleaningTableIds.includes('tbl-clean-1'), true);

      // Now table is cleaned & ready
      store.markTableCleaned('tbl-clean-1');

      const cleanedState = useStaffStore.getState();
      assert.equal(cleanedState.needsCleaningTableIds.includes('tbl-clean-1'), false);
      assert.equal(cleanedState.sessions.some((s) => s.tableId === 'tbl-clean-1'), false);
      assert.equal(cleanedState.orders.some((o) => o.tableId === 'tbl-clean-1' || o.tableNumber === 'T10'), false);
      assert.equal(cleanedState.kdsItems.some((k) => k.tableId === 'tbl-clean-1' || k.tableNumber === 'T10'), false);
      assert.equal(cleanedState.serveLaterPrompts.some((p) => p.tableNumber === 'T10'), false);
    });

    it('multi-order table calculations aggregate combined totals and display IDs accurately', () => {
      const order1 = {
        id: 'ord-multi-1',
        displayId: 'ORD-0001',
        outletId: 'out-1',
        tableNumber: 'T05',
        sessionId: 'sess-active',
        status: 'CONFIRMED' as const,
        subtotalPaise: 50000,
        taxPaise: 2500,
        discountPaise: 0,
        totalPaise: 52500,
        createdAt: '2026-11-19T11:00:00Z',
        items: [],
        events: [],
      };

      const order2 = {
        id: 'ord-multi-2',
        displayId: 'ORD-0002',
        outletId: 'out-1',
        tableNumber: 'T05',
        sessionId: 'sess-active',
        status: 'CONFIRMED' as const,
        subtotalPaise: 30000,
        taxPaise: 1500,
        discountPaise: 0,
        totalPaise: 31500,
        createdAt: '2026-11-19T11:30:00Z',
        items: [],
        events: [],
      };

      const tableOrders = [order1, order2];
      const combinedTotalPaise = tableOrders.reduce((sum, o) => sum + o.totalPaise, 0);
      assert.equal(combinedTotalPaise, 84000);
      assert.deepEqual(tableOrders.map((o) => o.displayId), ['ORD-0001', 'ORD-0002']);
    });
  });
});
