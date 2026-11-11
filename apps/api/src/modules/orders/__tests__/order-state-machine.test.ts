import { describe, it, expect } from 'vitest';
import {
  canTransitionOrder,
  canTransitionItem,
  deriveOrderStatus,
  isTerminalOrderStatus,
  isTerminalItemStatus,
  ORDER_TRANSITIONS,
  ITEM_TRANSITIONS,
  type OrderStatus,
  type ItemStatus,
} from '../order-state-machine.js';

// ─── canTransitionOrder ───────────────────────────────────────────────────────

describe('canTransitionOrder', () => {
  it('allows PENDING → CONFIRMED', () => {
    expect(canTransitionOrder('PENDING', 'CONFIRMED')).toEqual({ ok: true });
  });

  it('allows PENDING → CANCELLED', () => {
    expect(canTransitionOrder('PENDING', 'CANCELLED')).toEqual({ ok: true });
  });

  it('rejects PENDING → READY (skip ahead)', () => {
    const r = canTransitionOrder('PENDING', 'READY');
    expect(r.ok).toBe(false);
    expect((r as { ok: false; reason: string }).reason).toMatch(/PENDING/);
  });

  it('rejects BILLED → anything', () => {
    const statuses: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED'];
    for (const next of statuses) {
      const r = canTransitionOrder('BILLED', next);
      expect(r.ok).toBe(false);
    }
  });

  it('rejects CANCELLED → anything', () => {
    const statuses: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED'];
    for (const next of statuses) {
      const r = canTransitionOrder('CANCELLED', next);
      expect(r.ok).toBe(false);
    }
  });

  it('covers all defined forward paths in ORDER_TRANSITIONS', () => {
    for (const [from, tos] of Object.entries(ORDER_TRANSITIONS) as [OrderStatus, readonly OrderStatus[]][]) {
      for (const to of tos) {
        expect(canTransitionOrder(from, to).ok).toBe(true);
      }
    }
  });

  it('rejects every same-state self-transition', () => {
    const states: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED', 'CANCELLED'];
    for (const s of states) {
      const r = canTransitionOrder(s, s);
      expect(r.ok).toBe(false);
    }
  });
});

// ─── canTransitionItem ────────────────────────────────────────────────────────

describe('canTransitionItem', () => {
  it('allows PENDING → PREPARING', () => {
    expect(canTransitionItem('PENDING', 'PREPARING')).toEqual({ ok: true });
  });

  it('allows PREPARING → READY', () => {
    expect(canTransitionItem('PREPARING', 'READY')).toEqual({ ok: true });
  });

  it('allows PREPARING → CANCELLED', () => {
    expect(canTransitionItem('PREPARING', 'CANCELLED')).toEqual({ ok: true });
  });

  it('rejects READY → PENDING (backwards)', () => {
    expect(canTransitionItem('READY', 'PENDING').ok).toBe(false);
  });

  it('rejects SERVED → anything', () => {
    const statuses: ItemStatus[] = ['PENDING', 'PREPARING', 'READY', 'CANCELLED'];
    for (const next of statuses) {
      expect(canTransitionItem('SERVED', next).ok).toBe(false);
    }
  });

  it('covers all defined forward paths in ITEM_TRANSITIONS', () => {
    for (const [from, tos] of Object.entries(ITEM_TRANSITIONS) as [ItemStatus, readonly ItemStatus[]][]) {
      for (const to of tos) {
        expect(canTransitionItem(from, to).ok).toBe(true);
      }
    }
  });
});

// ─── isTerminal helpers ───────────────────────────────────────────────────────

describe('isTerminalOrderStatus', () => {
  it('returns true for BILLED', () => expect(isTerminalOrderStatus('BILLED')).toBe(true));
  it('returns true for CANCELLED', () => expect(isTerminalOrderStatus('CANCELLED')).toBe(true));
  it('returns false for non-terminal statuses', () => {
    const nonTerminal: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED'];
    for (const s of nonTerminal) {
      expect(isTerminalOrderStatus(s)).toBe(false);
    }
  });
});

describe('isTerminalItemStatus', () => {
  it('returns true for SERVED', () => expect(isTerminalItemStatus('SERVED')).toBe(true));
  it('returns true for CANCELLED', () => expect(isTerminalItemStatus('CANCELLED')).toBe(true));
  it('returns false for PENDING, PREPARING, READY', () => {
    expect(isTerminalItemStatus('PENDING')).toBe(false);
    expect(isTerminalItemStatus('PREPARING')).toBe(false);
    expect(isTerminalItemStatus('READY')).toBe(false);
  });
});

// ─── deriveOrderStatus ────────────────────────────────────────────────────────

describe('deriveOrderStatus', () => {
  it('returns CANCELLED when all items are cancelled', () => {
    expect(deriveOrderStatus(['CANCELLED', 'CANCELLED'])).toBe('CANCELLED');
  });

  it('returns SERVED when all non-cancelled items are SERVED', () => {
    expect(deriveOrderStatus(['SERVED', 'SERVED', 'CANCELLED'])).toBe('SERVED');
    expect(deriveOrderStatus(['SERVED', 'SERVED'])).toBe('SERVED');
  });

  it('returns READY when all non-cancelled items are READY or SERVED', () => {
    expect(deriveOrderStatus(['READY', 'SERVED', 'CANCELLED'])).toBe('READY');
    expect(deriveOrderStatus(['READY', 'READY'])).toBe('READY');
  });

  it('returns PREPARING when any non-cancelled item is PREPARING', () => {
    expect(deriveOrderStatus(['PREPARING', 'READY'])).toBe('PREPARING');
    expect(deriveOrderStatus(['PREPARING', 'PENDING'])).toBe('PREPARING');
  });

  it('returns null (no auto-advance) when all items are PENDING', () => {
    expect(deriveOrderStatus(['PENDING', 'PENDING'])).toBeNull();
  });

  it('returns null for mixed PENDING + READY (partial)', () => {
    expect(deriveOrderStatus(['PENDING', 'READY'])).toBeNull();
  });

  it('handles single item arrays', () => {
    expect(deriveOrderStatus(['SERVED'])).toBe('SERVED');
    expect(deriveOrderStatus(['READY'])).toBe('READY');
    expect(deriveOrderStatus(['CANCELLED'])).toBe('CANCELLED');
  });
});

// ─── Property: every allowed transition passes, reverse does not ──────────────

describe('property: transition symmetry', () => {
  const orderStatuses: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'SERVED', 'BILLED', 'CANCELLED'];

  it('canTransitionOrder is consistent with ORDER_TRANSITIONS', () => {
    for (const from of orderStatuses) {
      for (const to of orderStatuses) {
        const allowed = (ORDER_TRANSITIONS[from] as readonly string[]).includes(to);
        expect(canTransitionOrder(from, to).ok).toBe(allowed);
      }
    }
  });
});
