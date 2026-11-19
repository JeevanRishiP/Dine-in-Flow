import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { useStaffStore, ROLE_CONFIGS, type StaffDashboardView } from '../../../store/useStaffStore.ts';
import type { Order, Table, ServiceCall, MenuItem } from '../../../app/lib/restaurant-db.ts';

describe('StaffSidebar - Navigation & Workstation Decomposition (StaffSidebar.test.ts)', () => {
  beforeEach(() => {
    useStaffStore.setState({
      activeView: 'FLOOR',
      activeTab: 'TABLES',
      currentUser: null,
      currentRole: 'CAPTAIN',
      orders: [],
      tables: [],
      stock: [],
      calls: [],
    });
  });

  describe('Role-Differentiated Station Permission Filtering', () => {
    it('restricts stations strictly for KITCHEN role', () => {
      const config = ROLE_CONFIGS.KITCHEN;
      assert.deepEqual(config.allowedViews, ['KDS', 'STOCK']);
      assert.deepEqual(config.allowedTabs, ['ORDERS', 'STOCK']);
      assert.equal(config.defaultView, 'KDS');
      assert.equal(config.defaultTab, 'ORDERS');
    });

    it('provides PASS, TABLES and CALLS for WAITER role', () => {
      const config = ROLE_CONFIGS.WAITER;
      assert.deepEqual(config.allowedViews, ['WAITER', 'FLOOR', 'CALLS']);
      assert.deepEqual(config.allowedTabs, ['PASS', 'TABLES', 'CALLS']);
      assert.equal(config.defaultView, 'WAITER');
    });

    it('provides POS and TABLES for CASHIER role', () => {
      const config = ROLE_CONFIGS.CASHIER;
      assert.deepEqual(config.allowedViews, ['CASHIER', 'FLOOR']);
      assert.deepEqual(config.allowedTabs, ['POS', 'TABLES']);
      assert.equal(config.defaultView, 'CASHIER');
    });

    it('grants full multi-station access to MANAGER and OWNER', () => {
      const mgrConfig = ROLE_CONFIGS.MANAGER;
      assert.ok(mgrConfig.allowedViews.includes('KDS'));
      assert.ok(mgrConfig.allowedViews.includes('FLOOR'));
      assert.ok(mgrConfig.allowedViews.includes('WAITER'));
      assert.ok(mgrConfig.allowedViews.includes('CASHIER'));
      assert.ok(mgrConfig.allowedViews.includes('STOCK'));
      assert.ok(mgrConfig.allowedViews.includes('MENU'));
      assert.ok(mgrConfig.allowedViews.includes('CALLS'));
    });
  });

  describe('Badge Count & Queue Derivation for StaffSidebar', () => {
    it('computes pending orders queue badge for Kitchen KDS', () => {
      const orders: Order[] = [
        {
          id: 'o-1',
          displayId: 'ORD-#1',
          outletId: 'out-1',
          tableNumber: 'T01',
          sessionId: 's-1',
          status: 'PENDING_APPROVAL',
          subtotalPaise: 20000,
          taxPaise: 1000,
          discountPaise: 0,
          totalPaise: 21000,
          createdAt: '12:00',
          items: [],
          events: [],
        },
        {
          id: 'o-2',
          displayId: 'ORD-#2',
          outletId: 'out-1',
          tableNumber: 'T02',
          sessionId: 's-2',
          status: 'CONFIRMED',
          subtotalPaise: 30000,
          taxPaise: 1500,
          discountPaise: 0,
          totalPaise: 31500,
          createdAt: '12:05',
          items: [],
          events: [],
        },
        {
          id: 'o-3',
          displayId: 'ORD-#3',
          outletId: 'out-1',
          tableNumber: 'T03',
          sessionId: 's-3',
          status: 'SERVED',
          subtotalPaise: 10000,
          taxPaise: 500,
          discountPaise: 0,
          totalPaise: 10500,
          createdAt: '11:45',
          items: [],
          events: [],
        },
      ];

      useStaffStore.getState().setOrders(orders);
      const pendingCount = useStaffStore
        .getState()
        .orders.filter((o) => o.status === 'CONFIRMED' || o.status === 'PENDING_APPROVAL').length;
      assert.equal(pendingCount, 2);
    });

    it('computes ready dish badge for Food Pass (WAITER view)', () => {
      const orders: Order[] = [
        {
          id: 'o-1',
          displayId: 'ORD-#1',
          outletId: 'out-1',
          tableNumber: 'T01',
          sessionId: 's-1',
          status: 'PREPARING',
          subtotalPaise: 40000,
          taxPaise: 2000,
          discountPaise: 0,
          totalPaise: 42000,
          createdAt: '12:00',
          items: [
            {
              id: 'it-1',
              orderId: 'o-1',
              itemId: 'm-1',
              name: 'Paneer Tikka',
              pricePaise: 20000,
              quantity: 2,
              status: 'READY',
            },
            {
              id: 'it-2',
              orderId: 'o-1',
              itemId: 'm-2',
              name: 'Garlic Naan',
              pricePaise: 5000,
              quantity: 2,
              status: 'PREPARING',
            },
          ],
          events: [],
        },
      ];

      useStaffStore.getState().setOrders(orders);
      const readyDishesCount = useStaffStore
        .getState()
        .orders.reduce((sum, o) => sum + o.items.filter((it) => it.status === 'READY').length, 0);
      assert.equal(readyDishesCount, 1);
    });

    it('computes pending service calls badge', () => {
      const calls: ServiceCall[] = [
        { id: 'c-1', table: 'T01', timestamp: Date.now(), reason: 'Water refill', status: 'PENDING' },
        { id: 'c-2', table: 'T04', timestamp: Date.now(), reason: 'Bill request', status: 'ACKNOWLEDGED' },
        { id: 'c-3', table: 'T05', timestamp: Date.now(), reason: 'Cutlery', status: 'PENDING' },
      ];

      useStaffStore.getState().setCalls(calls);
      const pendingCalls = useStaffStore.getState().calls.filter((c) => c.status === 'PENDING').length;
      assert.equal(pendingCalls, 2);
    });
  });

  describe('Store-Wired View Selection', () => {
    it('updates active dashboard view and legacy tab when navigation item is selected', () => {
      const store = useStaffStore.getState();

      store.setActiveView('KDS');
      assert.equal(useStaffStore.getState().activeView, 'KDS');
      assert.equal(useStaffStore.getState().activeTab, 'ORDERS');

      store.setActiveView('CASHIER');
      assert.equal(useStaffStore.getState().activeView, 'CASHIER');
      assert.equal(useStaffStore.getState().activeTab, 'POS');

      store.setActiveView('WAITER');
      assert.equal(useStaffStore.getState().activeView, 'WAITER');
      assert.equal(useStaffStore.getState().activeTab, 'PASS');

      store.setActiveView('FLOOR');
      assert.equal(useStaffStore.getState().activeView, 'FLOOR');
      assert.equal(useStaffStore.getState().activeTab, 'TABLES');
    });
  });
});
