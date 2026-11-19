/**
 * Smart Kitchen Scheduler Service
 *
 * Coordinates:
 * - Course Hold Assignment on payment settlement
 * - Target Fire Time computation
 * - KDS Flattened Priority API (PAID orders only)
 * - Scheduled Order Auto-Fire ticker (60s)
 * - Serve-Later Auto-Prompter ticker (60s)
 * - Table Availability check
 * - Serve-Later Snooze
 *
 * Reference: ARCH §7, §10, AGENTS §2 rule 3, 6, 8
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { getPool, withTenantContextRaw } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';
import {
  scheduleOrderItems,
  sortKdsItemTickets,
  shouldSendServeLaterPrompt,
  type KdsItemTicket,
  type OrderType,
  type HoldStatus,
} from '../../services/kitchen-scheduler.js';

const TICKER_INTERVAL_MS = 60_000; // 60 seconds

export interface CheckAvailabilityDto {
  outlet_id: string;
  guest_count: number;
  reserved_for: string; // ISO timestamp
  duration_minutes?: number;
}

export interface AvailableTableOption {
  id: string;
  table_number: string;
  capacity: number;
}

export interface AvailabilityResult {
  available: boolean;
  tables: AvailableTableOption[];
  total_capacity: number;
  guest_count: number;
  reserved_for: string;
}

@Injectable()
export class KitchenSchedulerService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(KitchenSchedulerService.name);
  private tickerInterval: ReturnType<typeof setInterval> | null = null;
  private isTickRunning = false;

  onApplicationBootstrap() {
    this.tickerInterval = setInterval(() => {
      void this.runSchedulerTick();
    }, TICKER_INTERVAL_MS);
    this.logger.log(`Kitchen Scheduler Ticker started (interval=${TICKER_INTERVAL_MS}ms)`);
  }

  onApplicationShutdown() {
    if (this.tickerInterval) {
      clearInterval(this.tickerInterval);
      this.tickerInterval = null;
    }
    this.logger.log('Kitchen Scheduler Ticker stopped.');
  }

  // ─── 1. Schedule Order Items on Payment Confirmation ─────────────────────────

  /**
   * Called INSIDE the payment verification / webhook settlement transaction.
   * Computes target_fire_at and hold_status for all items and writes them atomically.
   */
  async scheduleOrderItemsInTx(
    db: PoolClient,
    orgId: string,
    orderId: string,
    paidAt: Date = new Date(),
  ): Promise<void> {
    const { rows: ordRows } = await db.query<{
      id: string;
      order_type: OrderType;
      scheduled_for: Date | null;
      outlet_id: string;
    }>(
      `SELECT id, order_type, scheduled_for, outlet_id FROM orders WHERE id = $1 AND org_id = $2`,
      [orderId, orgId],
    );
    const order = ordRows[0];
    if (!order) return;

    const { rows: items } = await db.query<{
      id: string;
      course_sequence: number;
      prep_time_minutes: number;
      notes: string | null;
      hold_status: HoldStatus;
      status: string;
    }>(
      `SELECT id, course_sequence, prep_time_minutes, notes, hold_status, status
       FROM order_items
       WHERE order_id = $1 AND org_id = $2`,
      [orderId, orgId],
    );
    if (items.length === 0) return;

    const scheduled = scheduleOrderItems(
      {
        orderType: order.order_type || 'DINE_IN',
        scheduledFor: order.scheduled_for,
        paidAt,
        items: items.map((i) => ({
          id: i.id,
          courseSequence: i.course_sequence,
          prepTimeMinutes: i.prep_time_minutes,
          notes: i.notes,
          holdStatus: i.hold_status,
          status: i.status,
        })),
      },
      paidAt,
    );

    for (const itemSched of scheduled) {
      await db.query(
        `UPDATE order_items
         SET target_fire_at = $1, hold_status = $2, updated_at = now()
         WHERE id = $3 AND org_id = $4`,
        [itemSched.targetFireAt, itemSched.holdStatus, itemSched.id, orgId],
      );
    }

    await db.query(
      `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, 'ORDER_SCHEDULED', 'SYSTEM', null, $3)`,
      [
        orgId,
        orderId,
        JSON.stringify({
          scheduledCount: scheduled.length,
          holds: scheduled.map((s) => ({ id: s.id, hold: s.holdStatus, fireAt: s.targetFireAt })),
        }),
      ],
    );
  }

  // ─── 2. Flattened KDS Priority Queue API ─────────────────────────────────────

  /**
   * GET /api/v1/console/kds/items
   * Returns ONLY PAID orders' items as an independent flat array (KdsItemTicket[]),
   * sorted deterministically: targetFireAt ASC, courseSequence ASC, prepTimeMinutes DESC, paidAt ASC.
   */
  async getFlattenedKdsItems(orgId: string, outletId?: string): Promise<KdsItemTicket[]> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }

    return withTenantContextRaw(orgId, async (db) => {
      const params: unknown[] = [orgId];
      let outletFilter = '';
      if (outletId) {
        params.push(outletId);
        outletFilter = ` AND o.outlet_id = $${params.length}`;
      }

      const { rows } = await db.query<{
        itemId: string;
        orderId: string;
        displayId?: string;
        orderDisplayId?: string;
        dinerId?: string | null;
        dinerLabel?: string | null;
        orderNumber: number | null;
        orderType: string;
        tableNumber: string;
        scheduledFor: string | null;
        dishName: string;
        quantity: number;
        modifiers: unknown;
        spiceLevel: number | null;
        notes: string | null;
        isComboItem: boolean;
        comboName: string | null;
        courseSequence: number;
        prepTimeMinutes: number;
        targetFireAt: string | null;
        holdStatus: HoldStatus;
        itemStatus: string;
        paidAt: string | null;
        claimedByStaffId: string | null;
        claimedAt: string | null;
      }>(
        `SELECT
           oi.id AS "itemId",
           oi.order_id AS "orderId",
           COALESCE(o.display_id, CASE WHEN o.order_number IS NOT NULL THEN 'ORD-' || LPAD(o.order_number::text, 4, '0') ELSE 'ORD-' || UPPER(SUBSTRING(o.id::text, 1, 4)) END) AS "displayId",
           o.order_number AS "orderNumber",
           o.order_type AS "orderType",
           COALESCE(tt.table_number, t.table_number, '--') AS "tableNumber",
           o.scheduled_for AS "scheduledFor",
           oi.name_snapshot AS "dishName",
           oi.quantity,
           oi.modifiers,
           mi.spice_level AS "spiceLevel",
           oi.notes,
           oi.is_combo_item AS "isComboItem",
           oi.combo_name AS "comboName",
           oi.course_sequence AS "courseSequence",
           oi.prep_time_minutes AS "prepTimeMinutes",
           oi.target_fire_at AS "targetFireAt",
           oi.hold_status AS "holdStatus",
           oi.status AS "itemStatus",
           o.paid_at AS "paidAt",
           oi.claimed_by_staff_id AS "claimedByStaffId",
           oi.claimed_at AS "claimedAt",
           COALESCE(oi.diner_id, o.diner_id) AS "dinerId",
           COALESCE(oi.diner_label, o.diner_label) AS "dinerLabel"
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id AND o.org_id = oi.org_id
         LEFT JOIN tables t ON t.id = o.table_id
         LEFT JOIN tables tt ON tt.id = oi.target_table_id
         LEFT JOIN menu_items mi ON mi.id = oi.menu_item_id
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         WHERE o.org_id = $1
           ${outletFilter}
           AND (o.payment_status = 'PAID' OR o.payment_method = 'CASH_APPROVED')
           AND o.status NOT IN ('AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_CANCELLED', 'PAYMENT_EXPIRED', 'CANCELLED', 'BILLED')
           AND o.status NOT IN ('COMPLETED')
           AND oi.status NOT IN ('CANCELLED', 'SERVED')
           AND (
             o.order_type IN ('TAKEAWAY', 'PRE_BOOK_DINE_IN')
             OR o.session_id IS NULL
             OR ts.status = 'OPEN'
           )`,
        params,
      );

      const mapped: KdsItemTicket[] = rows.map((r) => {
        const canonicalDisplayId = r.displayId || (r.orderNumber ? `ORD-${String(r.orderNumber).padStart(4, '0')}` : `ORD-${r.orderId.slice(-4).toUpperCase()}`);
        return {
          ...r,
          id: r.itemId,
          itemId: r.itemId,
          orderId: r.orderId,
          displayId: canonicalDisplayId,
          orderDisplayId: r.displayId ? canonicalDisplayId : (r.orderNumber ? `#${r.orderNumber}` : `#${r.orderId.slice(-4).toUpperCase()}`),
          dinerId: r.dinerId ?? null,
          dinerLabel: r.dinerLabel ?? null,
          itemStatus: r.itemStatus,
          status: r.itemStatus,
          modifiers: Array.isArray(r.modifiers) ? r.modifiers : [],
          targetFireAt: r.targetFireAt ? new Date(r.targetFireAt).toISOString() : null,
          scheduledFor: r.scheduledFor ? new Date(r.scheduledFor).toISOString() : null,
          paidAt: r.paidAt ? new Date(r.paidAt).toISOString() : null,
          claimedAt: r.claimedAt ? new Date(r.claimedAt).toISOString() : null,
        };
      });

      return sortKdsItemTickets(mapped);
    });
  }

  // ─── 3. Background Scheduler Ticker (Runs every 60s) ─────────────────────────

  async runSchedulerTick(): Promise<void> {
    if (this.isTickRunning) return;
    this.isTickRunning = true;
    try {
      await this.autoFireScheduledItems();
      await this.promptServeLaterCourses();
    } catch (err) {
      this.logger.error('Error during kitchen scheduler tick', err);
    } finally {
      this.isTickRunning = false;
    }
  }

  /**
   * Promotes SCHEDULED_WAIT items to ACTIVE when NOW() >= target_fire_at
   * and writes outbox events so KDS receives kds.item_fired via WebSocket.
   */
  private async autoFireScheduledItems(): Promise<void> {
    const pool = getPool();
    const { rows: dueItems } = await pool.query<{
      id: string;
      order_id: string;
      org_id: string;
      name_snapshot: string;
      target_fire_at: Date;
    }>(
      `UPDATE order_items
       SET hold_status = 'ACTIVE', updated_at = now()
       WHERE hold_status = 'SCHEDULED_WAIT'
         AND target_fire_at IS NOT NULL
         AND target_fire_at <= now()
       RETURNING id, order_id, org_id, name_snapshot, target_fire_at`,
    );

    for (const item of dueItems) {
      try {
        await withTenantContextRaw(item.org_id, async (db) => {
          await db.query(
            `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
             VALUES ($1, 'order_item', $2, 'kds.item_fired', $3)`,
            [
              item.org_id,
              item.id,
              JSON.stringify({
                itemId: item.id,
                orderId: item.order_id,
                dishName: item.name_snapshot,
                firedAt: new Date().toISOString(),
              }),
            ],
          );
        });
        this.logger.log(`Auto-fired item ${item.id} (${item.name_snapshot}) for order ${item.order_id}`);
      } catch (err) {
        this.logger.error(`Failed to broadcast auto-fire for item ${item.id}`, err);
      }
    }
  }

  /**
   * Serve-Later Auto-Prompter:
   * 1. Records main_course_served_at = NOW() once all Course 1 & 2 items become SERVED.
   * 2. Once 15 minutes have elapsed with unreleased Course 3/4 items, emits course.prompt_serve_later.
   */
  private async promptServeLaterCourses(): Promise<void> {
    const pool = getPool();

    // 1. Mark main_course_served_at for orders whose Course 1 & 2 items are fully SERVED
    await pool.query(
      `UPDATE orders o
       SET main_course_served_at = now(), updated_at = now()
       WHERE o.status NOT IN ('CANCELLED', 'BILLED', 'PAYMENT_EXPIRED', 'AWAITING_PAYMENT')
         AND o.main_course_served_at IS NULL
         AND EXISTS (
           SELECT 1 FROM order_items oi
           WHERE oi.order_id = o.id AND oi.course_sequence IN (1, 2)
         )
         AND NOT EXISTS (
           SELECT 1 FROM order_items oi
           WHERE oi.order_id = o.id
             AND oi.course_sequence IN (1, 2)
             AND oi.status NOT IN ('SERVED', 'CANCELLED')
         )`,
    );

    // 2. Identify orders ready for the Serve-Later prompt
    const { rows: candidates } = await pool.query<{
      id: string;
      org_id: string;
      outlet_id: string;
      session_id: string | null;
      main_course_served_at: Date;
    }>(
      `SELECT o.id, o.org_id, o.outlet_id, o.session_id, o.main_course_served_at
       FROM orders o
       WHERE o.status NOT IN ('CANCELLED', 'BILLED', 'PAYMENT_EXPIRED', 'AWAITING_PAYMENT')
         AND o.main_course_served_at IS NOT NULL
         AND o.serve_later_prompt_sent_at IS NULL
         AND o.main_course_served_at <= now() - INTERVAL '15 minutes'
         AND EXISTS (
           SELECT 1 FROM order_items oi
           WHERE oi.order_id = o.id
             AND oi.hold_status = 'SERVE_LATER_HOLD'
             AND oi.status NOT IN ('CANCELLED', 'SERVED')
         )`,
    );

    for (const ord of candidates) {
      try {
        await withTenantContextRaw(ord.org_id, async (db) => {
          // Set prompt sent timestamp
          await db.query(
            `UPDATE orders SET serve_later_prompt_sent_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2`,
            [ord.id, ord.org_id],
          );

          // Emit course.prompt_serve_later event to customer & captain consoles
          await db.query(
            `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
             VALUES ($1, 'order', $2, 'course.prompt_serve_later', $3)`,
            [
              ord.org_id,
              ord.id,
              JSON.stringify({
                orderId: ord.id,
                sessionId: ord.session_id,
                outletId: ord.outlet_id,
                promptTime: new Date().toISOString(),
              }),
            ],
          );
        });
        this.logger.log(`Dispatched course.prompt_serve_later for order ${ord.id}`);
      } catch (err) {
        this.logger.error(`Failed to send serve-later prompt for order ${ord.id}`, err);
      }
    }
  }

  // ─── 4. Serve-Later Snooze ───────────────────────────────────────────────────

  /**
   * Postpones the auto-prompt by snoozeMinutes (default 10 minutes)
   */
  async snoozeServeLater(orgId: string, orderId: string, snoozeMinutes = 10): Promise<{ success: boolean }> {
    return withTenantContextRaw(orgId, async (db) => {
      // By resetting serve_later_prompt_sent_at and bumping main_course_served_at,
      // the ticker will wait an additional snoozeMinutes before prompting again.
      const intervalMinutes = Math.max(1, 15 - snoozeMinutes);
      const res = await db.query(
        `UPDATE orders
         SET main_course_served_at = now() - ($3 || ' minutes')::interval,
             serve_later_prompt_sent_at = NULL,
             updated_at = now()
         WHERE id = $1 AND org_id = $2
         RETURNING id`,
        [orderId, orgId, intervalMinutes],
      );

      if (!res.rows[0]) {
        throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
      }

      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'SERVE_LATER_SNOOZED', 'CUSTOMER', null, $3)`,
        [orgId, orderId, JSON.stringify({ snoozeMinutes, snoozedAt: new Date().toISOString() })],
      );

      return { success: true };
    });
  }

  // ─── 5. Check Table Reservation Availability ─────────────────────────────────

  async checkAvailability(orgId: string, dto: CheckAvailabilityDto): Promise<AvailabilityResult> {
    const pool = getPool();
    const guestCount = dto.guest_count;
    const reservedFor = new Date(dto.reserved_for);
    const durationMinutes = dto.duration_minutes ?? 90;
    const reservedUntil = new Date(reservedFor.getTime() + durationMinutes * 60_000);

    // 1. Fetch active tables for this outlet
    const { rows: allTables } = await pool.query<{
      id: string;
      table_number: string;
      capacity: number;
    }>(
      `SELECT id, table_number, capacity
       FROM tables
       WHERE outlet_id = $1 AND is_active = true
       ORDER BY capacity ASC, table_number ASC`,
      [dto.outlet_id],
    );

    if (allTables.length === 0) {
      return {
        available: false,
        tables: [],
        total_capacity: 0,
        guest_count: guestCount,
        reserved_for: dto.reserved_for,
      };
    }

    // 2. Fetch occupied/conflicting reservations in this time window
    const { rows: conflicts } = await pool.query<{ assigned_table_ids: string[] }>(
      `SELECT assigned_table_ids
       FROM table_reservations
       WHERE outlet_id = $1
         AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'SEATED')
         AND reserved_for < $2
         AND (reserved_for + (duration_minutes || ' minutes')::interval) > $3`,
      [dto.outlet_id, reservedUntil, reservedFor],
    );

    const busyTableIds = new Set<string>();
    for (const c of conflicts) {
      for (const tid of c.assigned_table_ids || []) {
        busyTableIds.add(tid);
      }
    }

    const freeTables = allTables.filter((t) => !busyTableIds.has(t.id));

    // 3. Find single table match (best fit: minimum capacity >= guestCount)
    const singleMatch = freeTables.find((t) => t.capacity >= guestCount);
    if (singleMatch) {
      return {
        available: true,
        tables: [singleMatch],
        total_capacity: singleMatch.capacity,
        guest_count: guestCount,
        reserved_for: dto.reserved_for,
      };
    }

    // 4. Combine tables if no single table is large enough
    const selectedTables: AvailableTableOption[] = [];
    let accumulatedCapacity = 0;

    // Pick larger available tables first to minimize fragmentation
    const sortedDesc = [...freeTables].sort((a, b) => b.capacity - a.capacity);
    for (const tbl of sortedDesc) {
      selectedTables.push(tbl);
      accumulatedCapacity += tbl.capacity;
      if (accumulatedCapacity >= guestCount) {
        break;
      }
    }

    if (accumulatedCapacity >= guestCount) {
      return {
        available: true,
        tables: selectedTables,
        total_capacity: accumulatedCapacity,
        guest_count: guestCount,
        reserved_for: dto.reserved_for,
      };
    }

    return {
      available: false,
      tables: [],
      total_capacity: 0,
      guest_count: guestCount,
      reserved_for: dto.reserved_for,
    };
  }

  // ─── 6. Create Table Reservation with Concurrency Lock (App + DB Defense in Depth) ───

  async createReservation(
    outletId: string,
    dto: {
      guest_count: number;
      reserved_for: string;
      duration_minutes?: number;
      customer_name?: string;
      customer_phone?: string;
      table_ids?: string[];
    },
    customerId?: string | null,
  ): Promise<{
    id: string;
    reservationId: string;
    outletId: string;
    tableIds: string[];
    reservedFor: string;
    durationMinutes: number;
    guestCount: number;
    status: string;
  }> {
    const pool = getPool();
    // 1. Resolve org_id from outlet_id
    const { rows: outletRows } = await pool.query<{ org_id: string }>(
      `SELECT org_id FROM outlets WHERE id = $1`,
      [outletId],
    );
    const orgId = outletRows[0]?.org_id;
    if (!orgId) throw domainError(ErrorCode.NOT_FOUND, 'Outlet not found.', 404);

    const reservedFor = new Date(dto.reserved_for);
    const durationMinutes = dto.duration_minutes ?? 90;
    const reservedUntil = new Date(reservedFor.getTime() + durationMinutes * 60_000);

    return withTenantContextRaw(orgId, async (client) => {
      // 2. Select candidate tables: if dto.table_ids provided, use them; else check availability
      let candidateTableIds = dto.table_ids;
      if (!candidateTableIds || candidateTableIds.length === 0) {
        const avail = await this.checkAvailability(outletId, {
          outlet_id: outletId,
          guest_count: dto.guest_count,
          reserved_for: dto.reserved_for,
          duration_minutes: durationMinutes,
        });
        if (!avail.available || avail.tables.length === 0) {
          throw domainError(ErrorCode.CONFLICT, 'Table no longer available', 409);
        }
        candidateTableIds = avail.tables.map((t) => t.id);
      }

      // 3. Sort candidate table IDs deterministically in ascending order to prevent deadlocks
      const sortedTableIds = [...candidateTableIds].sort();

      // 4. Lock candidate tables rows in deterministic ascending order FOR UPDATE
      const { rows: lockedTables } = await client.query<{ id: string }>(
        `SELECT id FROM tables WHERE id = ANY($1) AND org_id = $2 AND outlet_id = $3 ORDER BY id ASC FOR UPDATE`,
        [sortedTableIds, orgId, outletId],
      );
      if (lockedTables.length !== sortedTableIds.length) {
        throw domainError(ErrorCode.CONFLICT, 'Table no longer available', 409);
      }

      // 5. Re-verify zero overlapping slots in table_reservation_slots within the same transaction
      const { rows: overlapRows } = await client.query<{ id: string }>(
        `SELECT id FROM table_reservation_slots
         WHERE table_id = ANY($1)
           AND org_id = $2
           AND status IN ('PENDING_PAYMENT', 'CONFIRMED', 'SEATED')
           AND slot_range && tstzrange($3, $4, '[)')`,
        [sortedTableIds, orgId, reservedFor, reservedUntil],
      );
      if (overlapRows.length > 0) {
        throw domainError(ErrorCode.CONFLICT, 'Table no longer available', 409);
      }

      // 6. Insert into table_reservations & table_reservation_slots
      try {
        const { rows: resRows } = await client.query<{ id: string }>(
          `INSERT INTO table_reservations (org_id, outlet_id, customer_id, customer_name, customer_phone,
                                           guest_count, assigned_table_ids, reserved_for, duration_minutes, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING_PAYMENT')
           RETURNING id`,
          [
            orgId,
            outletId,
            customerId ?? null,
            dto.customer_name ?? null,
            dto.customer_phone ?? null,
            dto.guest_count,
            sortedTableIds,
            reservedFor,
            durationMinutes,
          ],
        );
        const reservationId = resRows[0]!.id;

        for (const tid of sortedTableIds) {
          await client.query(
            `INSERT INTO table_reservation_slots (org_id, outlet_id, reservation_id, table_id, slot_range, status)
             VALUES ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'PENDING_PAYMENT')`,
            [orgId, outletId, reservationId, tid, reservedFor, reservedUntil],
          );
        }

        return {
          id: reservationId,
          reservationId,
          outletId,
          tableIds: sortedTableIds,
          reservedFor: dto.reserved_for,
          durationMinutes,
          guestCount: dto.guest_count,
          status: 'PENDING_PAYMENT',
        };
      } catch (err: any) {
        if (err && (err.code === '23P01' || String(err.message).includes('table_reservation_slots_no_overlap'))) {
          throw domainError(ErrorCode.CONFLICT, 'Table no longer available', 409);
        }
        throw err;
      }
    });
  }
}
