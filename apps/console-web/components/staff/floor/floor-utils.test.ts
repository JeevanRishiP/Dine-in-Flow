import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTableOccupancy,
  deriveTableChip,
  extractUniqueSections,
  filterTablesBySection,
  findPendingCallForTable,
} from './floor-utils.ts';
import type { Table, TableSession, Order, ServiceCall } from '../../../app/lib/restaurant-db.ts';

describe('Floor Map Utilities (floor-utils.test.ts)', () => {
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
    section: 'Verandah / Terrace',
    qrTokenVersion: 2,
    isActive: true,
    x: 1,
    y: 0,
  };

  describe('deriveTableOccupancy', () => {
    it('returns VACANT when no session, order, or cleaning needed', () => {
      const status = deriveTableOccupancy('tbl-1', 'T01', [], [], []);
      assert.equal(status, 'VACANT');
    });

    it('returns OCCUPIED when table has an open session', () => {
      const sessions: TableSession[] = [
        {
          id: 's-1',
          tableId: 'tbl-1',
          tableNumber: 'T01',
          status: 'OPEN',
          guestCount: 2,
          openedAt: '12:00',
          closedAt: null,
          tableCode: '1234',
        },
      ];
      const status = deriveTableOccupancy('tbl-1', 'T01', sessions, [], []);
      assert.equal(status, 'OCCUPIED');
    });

    it('returns OCCUPIED when table has an active order', () => {
      const orders: Order[] = [
        {
          id: 'ord-1',
          displayId: 'ORD-#1',
          outletId: 'out-1',
          tableNumber: 'T01',
          sessionId: 's-1',
          status: 'CONFIRMED',
          subtotalPaise: 20000,
          taxPaise: 1000,
          discountPaise: 0,
          totalPaise: 21000,
          createdAt: '12:00',
          items: [],
          events: [],
        },
      ];
      const status = deriveTableOccupancy('tbl-1', 'T01', [], orders, []);
      assert.equal(status, 'OCCUPIED');
    });

    it('prioritizes NEEDS_CLEANING when table is in cleaning queue', () => {
      const status = deriveTableOccupancy('tbl-1', 'T01', [], [], ['tbl-1']);
      assert.equal(status, 'NEEDS_CLEANING');

      // Works with Set
      const statusWithSet = deriveTableOccupancy('tbl-1', 'T01', [], [], new Set(['tbl-1']));
      assert.equal(statusWithSet, 'NEEDS_CLEANING');
    });
  });

  describe('deriveTableChip', () => {
    it('returns green READY chip when order is ready', () => {
      const chip = deriveTableChip('OCCUPIED', true);
      assert.equal(chip.label, 'READY');
      assert.equal(chip.chipClass, 'chip-green');
    });

    it('returns OCCUPIED / CLEAN chip when table needs cleaning', () => {
      const chip = deriveTableChip('NEEDS_CLEANING', false);
      assert.equal(chip.label, 'OCCUPIED / CLEAN');
      assert.equal(chip.chipClass, 'chip-blue');
    });

    it('returns ORDER ACTIVE chip when table is occupied', () => {
      const chip = deriveTableChip('OCCUPIED', false);
      assert.equal(chip.label, 'ORDER ACTIVE');
      assert.equal(chip.chipClass, 'chip-blue');
    });

    it('returns AVAILABLE chip when table is vacant', () => {
      const chip = deriveTableChip('VACANT', false);
      assert.equal(chip.label, 'AVAILABLE');
      assert.equal(chip.chipClass, 'chip-purple');
    });
  });

  describe('Section Filtering & Extraction', () => {
    it('extracts unique sections prepended with ALL', () => {
      const sections = extractUniqueSections([mockTable1, mockTable2]);
      assert.deepEqual(sections, ['ALL', 'Main Dining Hall', 'Verandah / Terrace']);
    });

    it('filters tables by section', () => {
      const all = filterTablesBySection([mockTable1, mockTable2], 'ALL');
      assert.equal(all.length, 2);

      const verandah = filterTablesBySection([mockTable1, mockTable2], 'Verandah / Terrace');
      assert.equal(verandah.length, 1);
      assert.equal(verandah[0]?.id, 'tbl-2');
    });
  });

  describe('findPendingCallForTable', () => {
    const mockCalls: ServiceCall[] = [
      { id: 'c-1', table: 'T01', timestamp: Date.now(), reason: 'Water refill', status: 'PENDING' },
      { id: 'c-2', table: 'T02', timestamp: Date.now(), reason: 'Check please', status: 'RESOLVED' },
    ];

    it('finds active service call for table', () => {
      const call = findPendingCallForTable(mockCalls, 'T01');
      assert.ok(call);
      assert.equal(call?.reason, 'Water refill');
    });

    it('ignores resolved service calls', () => {
      const call = findPendingCallForTable(mockCalls, 'T02');
      assert.equal(call, undefined);
    });
  });
});
