import type { Table, TableSession, Order, ServiceCall } from '../../../app/lib/restaurant-db';

export type TableOccupancy = 'VACANT' | 'OCCUPIED' | 'NEEDS_CLEANING';

/**
 * Accurately derives the operational occupancy status of a dining table.
 */
export function deriveTableOccupancy(
  tableId: string,
  tableNumber: string,
  sessions: TableSession[],
  orders: Order[],
  needsCleaningTableIds: string[] | Set<string>,
): TableOccupancy {
  const isCleaning =
    needsCleaningTableIds instanceof Set
      ? needsCleaningTableIds.has(tableId)
      : needsCleaningTableIds.includes(tableId);

  if (isCleaning) {
    return 'NEEDS_CLEANING';
  }

  const hasOpenSession = sessions.some((s) => s.tableId === tableId && s.status === 'OPEN');
  if (hasOpenSession) {
    return 'OCCUPIED';
  }

  const hasActiveOrder = orders.some(
    (o) =>
      o.status !== 'CANCELLED' &&
      o.status !== 'BILLED' &&
      (o.tableNumber === tableNumber ||
        o.items?.some((it) => it.targetTableNumber === tableNumber)),
  );

  if (hasActiveOrder) {
    return 'OCCUPIED';
  }

  return 'VACANT';
}

/**
 * Derives visual badge chip label and CSS class for the floor plan grid.
 */
export function deriveTableChip(
  occupancy: TableOccupancy,
  hasReadyOrder: boolean,
): { label: string; chipClass: string } {
  if (hasReadyOrder) {
    return { label: 'READY', chipClass: 'chip-green' };
  }
  if (occupancy === 'NEEDS_CLEANING') {
    return { label: 'OCCUPIED / CLEAN', chipClass: 'chip-blue' };
  }
  if (occupancy === 'OCCUPIED') {
    return { label: 'ORDER ACTIVE', chipClass: 'chip-blue' };
  }
  return { label: 'AVAILABLE', chipClass: 'chip-purple' };
}

/**
 * Extracts unique sections across configured dining tables.
 */
export function extractUniqueSections(tables: Table[]): string[] {
  const sections = new Set<string>();
  for (const t of tables) {
    if (t.section) {
      sections.add(t.section);
    }
  }
  return ['ALL', ...Array.from(sections)];
}

/**
 * Filters dining tables by selected floor section.
 */
export function filterTablesBySection(tables: Table[], section: string): Table[] {
  if (!section || section === 'ALL') return tables;
  return tables.filter((t) => t.section === section);
}

/**
 * Finds any active, unacknowledged or pending service bell call for a given table.
 */
export function findPendingCallForTable(
  calls: ServiceCall[],
  tableNumber: string,
): ServiceCall | undefined {
  return calls.find(
    (c) => (c.table === tableNumber || c.table === `T${tableNumber}`) && c.status !== 'RESOLVED',
  );
}
