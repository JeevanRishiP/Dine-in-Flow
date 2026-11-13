import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import {
  assertCustomerAccessScope,
  type CustomerAccessScope,
} from '../../common/utils/ownership.utils.js';
import { assertStaffOutletAccess } from '../../common/utils/outlet-scope.utils.js';
import { ErrorCode } from '@dineflow/contracts';
import {
  canTransitionOrder,
  canTransitionItem,
  deriveOrderStatus,
  isTerminalOrderStatus,
  type OrderStatus,
  type ItemStatus,
} from './order-state-machine.js';
import {
  computeQuote,
  DEFAULT_GST_CONFIG,
  NOOP_DISCOUNT,
  PricingValidationError,
  type PriceLineInput,
} from './pricing.engine.js';
import type {
  QuoteOrderSchema,
  PlaceOrderSchema,
  UpdateOrderStatusSchema,
  UpdateItemStatusSchema,
  OrderQuerySchema,
  ReassignItemTableSchema,
} from './orders.dto.js';
import type { z } from 'zod';

type QuoteOrderInput    = z.infer<typeof QuoteOrderSchema>;
type PlaceOrderInput    = z.infer<typeof PlaceOrderSchema>;
type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;
type UpdateItemStatusInput  = z.infer<typeof UpdateItemStatusSchema>;
type OrderQueryInput    = z.infer<typeof OrderQuerySchema>;
type ReassignItemTableInput = z.infer<typeof ReassignItemTableSchema>;

/**
 * Orders Service
 *
 * Key invariants (AGENTS §2):
 *  - Rule 1: all money in integer paise — never floating point.
 *  - Rule 2: prices are NEVER trusted from the client — derived from DB and
 *    computed by the pure pricing engine.
 *  - Rule 6: order_events and outbox_events written in same TX as the state change.
 *  - Rule 8: idempotency_key enforced at DB level (unique index on orders).
 *
 * PRICE_CHANGED flow (§8):
 *   POST /orders/quote → returns quote + price_fingerprint.
 *   POST /orders       → server re-derives quote; if fingerprint differs → 409 with fresh quote.
 *   Client must re-confirm before retrying with new fingerprint.
 *
 * NEEDS_HUMAN_REVIEW: pricing derivation, idempotency replay, state transitions
 * Reference: ARCH §8, AGENTS §2 rule 1+2+6+8
 */
const ORDER_ITEM_SELECT_FIELDS =
  'oi.id, oi.menu_item_id, oi.name_snapshot, oi.unit_price_paise, oi.quantity, oi.line_total_paise, oi.modifiers, oi.notes, oi.status, oi.target_table_id, tt.table_number AS target_table_number, oi.created_at, oi.updated_at';

@Injectable()
export class OrdersService {
  private static readonly UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ─── Quote ───────────────────────────────────────────────────────────────────

  async quoteOrder(orgId: string, dto: QuoteOrderInput) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    return withTenantContextRaw(orgId, async (db) => {
      const { rows: sRows } = await db.query<{ id: string; outlet_id: string }>(
        `SELECT id, outlet_id FROM table_sessions WHERE id = $1 AND org_id = $2`,
        [dto.session_id, orgId],
      );
      if (!sRows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Session not found.', 404);
      const pricingInput = await this.buildPricingInput(orgId, sRows[0].outlet_id, dto.items, db);
      const quote = this.computeQuoteOrThrow(pricingInput, dto.tip_paise ?? 0);
      return { ...quote, session_id: dto.session_id };
    });
  }

  // ─── List / Get ──────────────────────────────────────────────────────────────

  async listOrders(orgId: string, query: OrderQueryInput) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const targetOrgId = orgId;

    return withTenantContextRaw(targetOrgId, async (db) => {
      const params: unknown[] = [targetOrgId];
      const clauses: string[] = ['o.org_id = $1'];

      if (query.outlet_id)  { params.push(query.outlet_id);  clauses.push(`o.outlet_id = $${params.length}`); }
      if (query.status)     { params.push(query.status);     clauses.push(`o.status = $${params.length}`); }
      if (query.session_id) { params.push(query.session_id); clauses.push(`o.session_id = $${params.length}`); }

      params.push(query.limit, query.offset);
      const limitIdx  = params.length - 1;
      const offsetIdx = params.length;

      const { rows } = await db.query(
        `SELECT o.id, o.status, o.subtotal_paise, o.tax_paise, o.discount_paise, o.total_paise,
                o.idempotency_key, o.session_id, o.table_id, o.notes, o.created_at, o.updated_at,
                t.table_number
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE ${clauses.join(' AND ')}
         ORDER BY o.created_at DESC
         LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
        params,
      );

      await this.attachItemsToOrders(targetOrgId, rows, db);

      return rows;
    });
  }

  async getOrder(
    orgId: string,
    orderId: string,
    scope?: CustomerAccessScope,
    staffOutletId?: string,
  ) {
    const targetOrgId = await this.resolveOrderOrgId(orgId, orderId);

    return withTenantContextRaw(targetOrgId, async (db) => {
      const order = await this.getOrderInTx(targetOrgId, orderId, db);
      if (staffOutletId) {
        assertStaffOutletAccess(staffOutletId, order.outlet_id as string | undefined);
      }
      if (scope) {
        let sessionCustomerId: string | null = null;
        let sessionTempCustomerId: string | null = null;
        if (order.session_id) {
          const { rows: sRows } = await db.query<{
            customer_id: string | null;
            temp_customer_id?: string | null;
          }>(
            `SELECT customer_id, temp_customer_id FROM table_sessions WHERE id = $1 AND org_id = $2`,
            [order.session_id, targetOrgId],
          );
          sessionCustomerId = sRows[0]?.customer_id ?? null;
          sessionTempCustomerId = sRows[0]?.temp_customer_id ?? null;
        }
        assertCustomerAccessScope(scope, {
          session_id: order.session_id,
          customer_id: order.customer_id,
          session_customer_id: sessionCustomerId,
          temp_customer_id: order.temp_customer_id ?? null,
          session_temp_customer_id: sessionTempCustomerId,
        });
      }
      return order;
    });
  }

  async getMyOrders(orgId: string, scope: CustomerAccessScope) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    return withTenantContextRaw(orgId, async (db) => {
      let whereClause = '';
      const params: unknown[] = [orgId];

      if (scope.customerId) {
        params.push(scope.customerId);
        whereClause = `o.customer_id = $${params.length}`;
      } else if (scope.tempCustomerId) {
        const { rows: tcRows } = await db.query<{ status: string }>(
          `SELECT status FROM temp_customers WHERE id = $1 AND org_id = $2`,
          [scope.tempCustomerId, orgId],
        );
        if (tcRows[0]?.status === 'DISSOLVED') {
          return [];
        }
        params.push(scope.tempCustomerId);
        whereClause = `o.temp_customer_id = $${params.length}`;
      } else if (scope.sessionId) {
        params.push(scope.sessionId);
        whereClause = `o.session_id = $${params.length}`;
      } else {
        throw domainError(ErrorCode.UNAUTHORIZED, 'Customer or table session identity required.', 401);
      }

      const { rows: orders } = await db.query(
        `SELECT o.*, t.table_number,
                (SELECT p.status FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_status,
                (SELECT p.method FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_method,
                (SELECT p.settled_at FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_settled_at
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE o.org_id = $1 AND ${whereClause}
         ORDER BY o.created_at DESC`,
        params,
      );
      await this.attachItemsToOrders(orgId, orders, db);
      return orders;
    });
  }

  async getOrdersBySession(orgId: string, sessionId: string, scope?: CustomerAccessScope) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!OrdersService.UUID_RE.test(sessionId)) {
      throw domainError(ErrorCode.NOT_FOUND, 'Session not found.', 404);
    }

    return withTenantContextRaw(orgId, async (db) => {
      if (scope) {
        const { rows: sRows } = await db.query<{
          id: string;
          customer_id: string | null;
          temp_customer_id: string | null;
        }>(
          `SELECT id, customer_id, temp_customer_id FROM table_sessions WHERE id = $1 AND org_id = $2`,
          [sessionId, orgId],
        );
        const sess = sRows[0];
        if (!sess) throw domainError(ErrorCode.NOT_FOUND, 'Session not found.', 404);
        assertCustomerAccessScope(scope, {
          session_id: sess.id,
          session_customer_id: sess.customer_id,
          session_temp_customer_id: sess.temp_customer_id,
        });
      }

      const params: unknown[] = [sessionId, orgId];
      let ownerFilter = '';
      if (scope?.customerId) {
        params.push(scope.customerId);
        ownerFilter = ` AND o.customer_id = $${params.length}`;
      } else if (scope?.tempCustomerId) {
        params.push(scope.tempCustomerId);
        ownerFilter = ` AND o.temp_customer_id = $${params.length}`;
      }

      const { rows: orders } = await db.query(
        `SELECT o.*, t.table_number,
                (SELECT p.status FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_status,
                (SELECT p.method FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_method,
                (SELECT p.settled_at FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_settled_at
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE o.session_id = $1 AND o.org_id = $2 ${ownerFilter}
         ORDER BY o.created_at DESC`,
        params,
      );
      await this.attachItemsToOrders(orgId, orders, db);
      return orders;
    });
  }

  // ─── Place Order ─────────────────────────────────────────────────────────────

  async placeOrder(
    orgId: string,
    dto: PlaceOrderInput,
    actorId: string,
    actorType: 'STAFF' | 'CUSTOMER',
    scope?: CustomerAccessScope,
    staffOutletId?: string,
  ) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (scope?.sessionId && dto.session_id !== scope.sessionId) {
      throw domainError(ErrorCode.FORBIDDEN, 'Access denied for this table session.', 403);
    }
    const targetOrgId = orgId;

    return withTenantContextRaw(targetOrgId, async (db) => {

      // ── 1. Idempotency check ──────────────────────────────────────────────────
      const { rows: existing } = await db.query(
        `SELECT id FROM orders WHERE org_id = $1 AND idempotency_key = $2`,
        [targetOrgId, dto.idempotency_key],
      );
      if (existing[0]) return this.getOrderInTx(targetOrgId, existing[0]!['id'] as string, db);

      // ── 2. Verify session is open ─────────────────────────────────────────────
      const { rows: sessionRows } = await db.query<{
        id: string;
        table_id: string;
        outlet_id: string;
        status: string;
        customer_id: string | null;
        temp_customer_id?: string | null;
      }>(
        `SELECT id, table_id, outlet_id, status, customer_id, temp_customer_id FROM table_sessions
         WHERE id = $1 AND org_id = $2`,
        [dto.session_id, targetOrgId],
      );
      const session = sessionRows[0];
      if (!session) throw domainError(ErrorCode.NOT_FOUND, 'Session not found.', 404);
      if (staffOutletId) {
        assertStaffOutletAccess(staffOutletId, session.outlet_id);
      }
      if (actorType === 'CUSTOMER' && scope) {
        assertCustomerAccessScope(scope, {
          session_id: session.id,
          session_customer_id: session.customer_id,
          session_temp_customer_id: session.temp_customer_id,
        });
      }
      if (session.status !== 'OPEN') {
        throw domainError(ErrorCode.VALIDATION_ERROR, 'Session is not open.', 400);
      }

      // ── 3. Server-side pricing (AGENTS §2 rule 2) ─────────────────────────────
      const pricingInput = await this.buildPricingInput(targetOrgId, session.outlet_id, dto.items, db);
      const quote = this.computeQuoteOrThrow(pricingInput, dto.tip_paise ?? 0);

      // ── 4. PRICE_CHANGED detection ────────────────────────────────────────────
      if (dto.price_fingerprint && dto.price_fingerprint !== quote.price_fingerprint) {
        // 409 with fresh quote so customer can confirm changed prices
        throw domainError(
          ErrorCode.PRICE_CHANGED,
          'Prices have changed since the quote was generated. Please review the updated prices.',
          409,
          { quote },
        );
      }

      // ── 4.5 Validate optional per-plate target_table_id within same outlet ────
      const requestedTargetTableIds = [
        ...new Set(
          dto.items
            .map((i) => i.target_table_id)
            .filter((tid): tid is string => Boolean(tid)),
        ),
      ];
      if (requestedTargetTableIds.length > 0) {
        const { rows: tRows } = await db.query<{ id: string }>(
          `SELECT id FROM tables WHERE org_id = $1 AND outlet_id = $2 AND id = ANY($3) AND is_active = true`,
          [targetOrgId, session.outlet_id, requestedTargetTableIds],
        );
        const validIds = new Set(tRows.map((r) => r.id));
        for (const tid of requestedTargetTableIds) {
          if (!validIds.has(tid)) {
            throw domainError(
              ErrorCode.VALIDATION_ERROR,
              'Selected per-plate table does not belong to this outlet or is inactive.',
              400,
            );
          }
        }
      }

      // ── 5. Write order + items + events atomically ──────────────────────────
      const customerId = scope?.customerId ?? session.customer_id ?? null;
      const tempCustomerId = scope?.tempCustomerId ?? session.temp_customer_id ?? null;
      const { rows: orderRows } = await db.query<{ id: string }>(
        `INSERT INTO orders (org_id, outlet_id, table_id, session_id, customer_id, temp_customer_id, idempotency_key,
                             status, subtotal_paise, tax_paise, discount_paise, total_paise, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9, 0, $10, $11)
         RETURNING id`,
        [
          targetOrgId, session.outlet_id, session.table_id, session.id, customerId, tempCustomerId,
          dto.idempotency_key,
          quote.subtotal_paise, quote.tax_paise,
          quote.total_paise,
          dto.notes ?? null,
        ],
      );
      const orderId = orderRows[0]!.id;

      for (let idx = 0; idx < quote.lines.length; idx++) {
        const line = quote.lines[idx]!;
        const targetTableId = dto.items[idx]?.target_table_id ?? session.table_id;
        await db.query(
          `INSERT INTO order_items (org_id, order_id, menu_item_id, name_snapshot,
                                    unit_price_paise, quantity, line_total_paise, modifiers, notes, target_table_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            targetOrgId, orderId, line.menu_item_id, line.name_snapshot,
            line.unit_price_paise, line.quantity, line.line_total_paise,
            JSON.stringify(line.modifiers),
            dto.items[idx]?.notes ?? null,
            targetTableId,
          ],
        );
      }

      if (tempCustomerId) {
        const touchedTableIds = [...new Set([session.table_id, ...requestedTargetTableIds])];
        await this.linkTempCustomerTables(targetOrgId, session.outlet_id, tempCustomerId, touchedTableIds, db);
      }

      // ── 6. Audit + outbox in same TX (AGENTS §2 rule 6) ───────────────────────
      const validActorUuid =
        actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)
          ? actorId
          : null;

      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'ORDER_PLACED', $3, $4, $5)`,
        [targetOrgId, orderId, actorType, validActorUuid,
         JSON.stringify({ item_count: quote.lines.length, total_paise: quote.total_paise })],
      );

      await db.query(
        `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
         VALUES ($1, 'order', $2, 'ORDER_PLACED', $3)`,
        [
          targetOrgId,
          orderId,
          JSON.stringify({ session_id: session.id, outlet_id: session.outlet_id, total_paise: quote.total_paise }),
        ],
      );

      return this.getOrderInTx(targetOrgId, orderId, db);
    });
  }

  // ─── Reassign Per-Plate Table (Customer, pre-SERVED/BILLED) ────────────────

  async reassignItemTable(
    orgId: string,
    orderId: string,
    itemId: string,
    dto: ReassignItemTableInput,
    actorId: string,
    scope: CustomerAccessScope,
  ) {
    if (!OrdersService.UUID_RE.test(itemId)) {
      throw domainError(ErrorCode.NOT_FOUND, 'Order item not found.', 404);
    }
    const targetOrgId = await this.resolveOrderOrgId(orgId, orderId);

    return withTenantContextRaw(targetOrgId, async (db) => {
      const { rows: ordRows } = await db.query<{
        id: string;
        outlet_id: string;
        table_id: string;
        session_id: string | null;
        customer_id: string | null;
        temp_customer_id?: string | null;
        status: OrderStatus;
      }>(
        `SELECT id, outlet_id, table_id, session_id, customer_id, temp_customer_id, status
         FROM orders WHERE id = $1 AND org_id = $2`,
        [orderId, targetOrgId],
      );
      const order = ordRows[0];
      if (!order) throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);

      let sessionCustomerId: string | null = null;
      let sessionTempCustomerId: string | null = null;
      if (order.session_id) {
        const { rows: sRows } = await db.query<{
          customer_id: string | null;
          temp_customer_id?: string | null;
        }>(
          `SELECT customer_id, temp_customer_id FROM table_sessions WHERE id = $1 AND org_id = $2`,
          [order.session_id, targetOrgId],
        );
        sessionCustomerId = sRows[0]?.customer_id ?? null;
        sessionTempCustomerId = sRows[0]?.temp_customer_id ?? null;
      }
      assertCustomerAccessScope(scope, {
        session_id: order.session_id,
        customer_id: order.customer_id,
        session_customer_id: sessionCustomerId,
        temp_customer_id: order.temp_customer_id ?? null,
        session_temp_customer_id: sessionTempCustomerId,
      });

      if (order.status === 'BILLED' || order.status === 'CANCELLED') {
        throw domainError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot change table once order is '${order.status}'.`,
          400,
        );
      }

      const { rows: itemRows } = await db.query<{
        id: string;
        order_id: string;
        menu_item_id: string;
        name_snapshot: string;
        unit_price_paise: number;
        quantity: number;
        line_total_paise: number;
        modifiers: unknown;
        notes: string | null;
        status: ItemStatus;
        target_table_id: string | null;
      }>(
        `SELECT id, order_id, menu_item_id, name_snapshot, unit_price_paise,
                quantity, line_total_paise, modifiers, notes, status, target_table_id
         FROM order_items WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [itemId, targetOrgId],
      );
      const item = itemRows[0];
      if (!item || item.order_id !== orderId) {
        throw domainError(ErrorCode.NOT_FOUND, 'Order item not found.', 404);
      }
      if (item.status === 'SERVED' || item.status === 'CANCELLED') {
        throw domainError(
          ErrorCode.VALIDATION_ERROR,
          `Cannot change table after plate is '${item.status}'.`,
          400,
        );
      }

      const { rows: outletTables } = await db.query<{ id: string; table_number: string }>(
        `SELECT id, table_number FROM tables WHERE org_id = $1 AND outlet_id = $2 AND is_active = true`,
        [targetOrgId, order.outlet_id],
      );
      const norm = (val: string) => val.replace(/\D/g, '').replace(/^0+/, '') || '0';
      const destTable = dto.target_table_id
        ? outletTables.find((t) => t.id === dto.target_table_id)
        : outletTables.find(
            (t) =>
              t.table_number.toUpperCase() === dto.target_table_number!.trim().toUpperCase() ||
              norm(t.table_number) === norm(dto.target_table_number!),
          );
      if (!destTable) {
        throw domainError(ErrorCode.NOT_FOUND, 'Wrong table number for this hotel.', 404);
      }

      if (item.quantity > 1 && dto.plate_index !== undefined) {
        if (dto.plate_index > item.quantity) {
          throw domainError(ErrorCode.VALIDATION_ERROR, 'plate_index exceeds item quantity.', 400);
        }
        const singleLinePaise = Math.floor(item.line_total_paise / item.quantity);
        const remainingLinePaise = item.line_total_paise - singleLinePaise;
        await db.query(
          `UPDATE order_items
           SET quantity = $1, line_total_paise = $2, updated_at = now()
           WHERE id = $3 AND org_id = $4`,
          [item.quantity - 1, remainingLinePaise, itemId, targetOrgId],
        );
        await db.query(
          `INSERT INTO order_items (org_id, order_id, menu_item_id, name_snapshot,
                                    unit_price_paise, quantity, line_total_paise, modifiers, notes, status, target_table_id)
           VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)`,
          [
            targetOrgId,
            orderId,
            item.menu_item_id,
            item.name_snapshot,
            item.unit_price_paise,
            singleLinePaise,
            JSON.stringify(item.modifiers ?? []),
            item.notes,
            item.status,
            destTable.id,
          ],
        );
      } else {
        await db.query(
          `UPDATE order_items SET target_table_id = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
          [destTable.id, itemId, targetOrgId],
        );
      }

      const activeTempCustomerId = order.temp_customer_id || sessionTempCustomerId || scope.tempCustomerId || null;
      if (activeTempCustomerId) {
        await this.linkTempCustomerTables(targetOrgId, order.outlet_id, activeTempCustomerId, [destTable.id], db);
      }

      const validActorUuid = this.toValidUuidOrNull(actorId);
      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'ITEM_TABLE_CHANGED', 'CUSTOMER', $3, $4)`,
        [
          targetOrgId,
          orderId,
          validActorUuid,
          JSON.stringify({
            item_id: itemId,
            from_table_id: item.target_table_id ?? order.table_id,
            to_table_id: destTable.id,
            to_table_number: destTable.table_number,
          }),
        ],
      );
      await db.query(
        `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
         VALUES ($1, 'order', $2, 'ITEM_TABLE_CHANGED', $3)`,
        [
          targetOrgId,
          orderId,
          JSON.stringify({
            item_id: itemId,
            outlet_id: order.outlet_id,
            to_table_id: destTable.id,
            to_table_number: destTable.table_number,
          }),
        ],
      );

      return this.getOrderInTx(targetOrgId, orderId, db);
    });
  }

  // ─── Update Order Status ─────────────────────────────────────────────────────

  async updateOrderStatus(
    orgId: string,
    orderId: string,
    dto: UpdateOrderStatusInput,
    actorId: string,
    actorType: 'STAFF' | 'CUSTOMER',
    staffOutletId?: string,
  ) {
    const targetOrgId = await this.resolveOrderOrgId(orgId, orderId);

    return withTenantContextRaw(targetOrgId, async (db) => {
      const { rows } = await db.query<{ status: OrderStatus; outlet_id?: string }>(
        `SELECT status, outlet_id FROM orders WHERE id = $1 AND org_id = $2`,
        [orderId, targetOrgId],
      );
      const order = rows[0];
      if (!order) throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
      if (staffOutletId) {
        assertStaffOutletAccess(staffOutletId, order.outlet_id);
      }
      if (isTerminalOrderStatus(order.status)) {
        throw domainError(ErrorCode.VALIDATION_ERROR, `Order is in terminal state '${order.status}'.`, 400);
      }

      const result = canTransitionOrder(order.status, dto.status as OrderStatus);
      if (!result.ok) throw domainError(ErrorCode.VALIDATION_ERROR, result.reason, 400);

      await db.query(
        `UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
        [dto.status, orderId, targetOrgId],
      );
      if (dto.status === 'PREPARING' || dto.status === 'READY' || dto.status === 'SERVED') {
        await db.query(
          `UPDATE order_items SET status = $1, updated_at = now() WHERE order_id = $2 AND org_id = $3 AND status NOT IN ('CANCELLED', $1)`,
          [dto.status, orderId, targetOrgId],
        );
      }

      const validActorUuid = this.toValidUuidOrNull(actorId);

      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'STATUS_CHANGED', $3, $4, $5)`,
        [targetOrgId, orderId, actorType, validActorUuid,
         JSON.stringify({ from: order.status, to: dto.status, reason: dto.reason ?? null })],
      );
      await db.query(
        `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
         VALUES ($1, 'order', $2, 'STATUS_CHANGED', $3)`,
        [targetOrgId, orderId, JSON.stringify({ from: order.status, to: dto.status, outlet_id: order.outlet_id ?? null })],
      );

      return this.getOrderInTx(targetOrgId, orderId, db);
    });
  }

  // ─── KDS: Update Item Status ──────────────────────────────────────────────────

  async updateItemStatus(
    orgId: string,
    orderId: string,
    itemId: string,
    dto: UpdateItemStatusInput,
    actorId: string,
    staffOutletId?: string,
  ) {
    if (!OrdersService.UUID_RE.test(itemId)) {
      throw domainError(ErrorCode.NOT_FOUND, 'Order item not found.', 404);
    }
    const targetOrgId = await this.resolveOrderOrgId(orgId, orderId);

    return withTenantContextRaw(targetOrgId, async (db) => {
      if (staffOutletId) {
        const { rows: ordRows } = await db.query<{ outlet_id: string }>(
          `SELECT outlet_id FROM orders WHERE id = $1 AND org_id = $2`,
          [orderId, targetOrgId],
        );
        if (!ordRows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
        assertStaffOutletAccess(staffOutletId, ordRows[0].outlet_id);
      }

      const { rows } = await db.query<{ status: ItemStatus; order_id: string }>(
        `SELECT status, order_id FROM order_items WHERE id = $1 AND org_id = $2`,
        [itemId, targetOrgId],
      );
      const item = rows[0];
      if (!item || item.order_id !== orderId) {
        throw domainError(ErrorCode.NOT_FOUND, 'Order item not found.', 404);
      }

      const result = canTransitionItem(item.status, dto.status as ItemStatus);
      if (!result.ok) throw domainError(ErrorCode.VALIDATION_ERROR, result.reason, 400);

      await db.query(
        `UPDATE order_items SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
        [dto.status, itemId, targetOrgId],
      );

      // Auto-derive parent order status from all item statuses
      const { rows: allItems } = await db.query<{ status: string }>(
        `SELECT status FROM order_items WHERE order_id = $1 AND org_id = $2`,
        [orderId, targetOrgId],
      );
      const derivedStatus = deriveOrderStatus(allItems.map((i) => i.status as ItemStatus));

      const validActorUuid = this.toValidUuidOrNull(actorId);

      if (derivedStatus) {
        const { rows: orderRows } = await db.query<{ status: OrderStatus }>(
          `SELECT status FROM orders WHERE id = $1 AND org_id = $2`, [orderId, targetOrgId],
        );
        const cur = orderRows[0]?.status;
        if (cur && canTransitionOrder(cur, derivedStatus).ok) {
          await db.query(
            `UPDATE orders SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
            [derivedStatus, orderId, targetOrgId],
          );
          await db.query(
            `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
             VALUES ($1, 'order', $2, 'STATUS_CHANGED', $3)`,
            [targetOrgId, orderId, JSON.stringify({ from: cur, to: derivedStatus })],
          );
        }
      }

      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'ITEM_STATUS_CHANGED', 'STAFF', $3, $4)`,
        [targetOrgId, orderId, validActorUuid,
         JSON.stringify({ item_id: itemId, from: item.status, to: dto.status })],
      );
      await db.query(
        `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
         VALUES ($1, 'order', $2, 'ITEM_STATUS_CHANGED', $3)`,
        [targetOrgId, orderId, JSON.stringify({ item_id: itemId, from: item.status, to: dto.status })],
      );

      return this.getOrderInTx(targetOrgId, orderId, db);
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private toValidUuidOrNull(value?: string | null): string | null {
    return value && OrdersService.UUID_RE.test(value) ? value : null;
  }

  private async resolveOrderOrgId(orgId: string, orderId: string): Promise<string> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!OrdersService.UUID_RE.test(orderId)) {
      throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
    }
    return orgId;
  }

  private computeQuoteOrThrow(lines: PriceLineInput[], tipPaise: number) {
    try {
      return computeQuote({
        lines,
        taxConfig: DEFAULT_GST_CONFIG,
        discountHook: NOOP_DISCOUNT,
        tipPaise,
      });
    } catch (err) {
      if (err instanceof PricingValidationError) {
        throw domainError(ErrorCode[err.code], err.message, 400);
      }
      throw err;
    }
  }

  private async attachItemsToOrders(
    orgId: string,
    orders: Array<Record<string, unknown>>,
    db: PoolClient,
  ): Promise<void> {
    if (orders.length === 0) return;
    const orderIds = orders.map((o) => o['id'] as string);
    const { rows: allItems } = await db.query<Record<string, unknown>>(
      `SELECT oi.order_id, ${ORDER_ITEM_SELECT_FIELDS}
       FROM order_items oi
       LEFT JOIN tables tt ON tt.id = oi.target_table_id
       WHERE oi.order_id = ANY($1) AND oi.org_id = $2 ORDER BY oi.created_at`,
      [orderIds, orgId],
    );
    const itemsByOrder = new Map<string, Array<Record<string, unknown>>>();
    for (const item of allItems) {
      const oid = item['order_id'] as string;
      const list = itemsByOrder.get(oid) ?? [];
      list.push(item);
      itemsByOrder.set(oid, list);
    }
    for (const ord of orders) {
      const id = ord['id'] as string;
      const matched = itemsByOrder.get(id);
      if (matched) {
        ord['items'] = matched;
      } else if (orders.length === 1 && allItems.length > 0 && allItems[0]!['order_id'] === undefined) {
        ord['items'] = allItems;
      } else {
        ord['items'] = [];
      }
    }
  }

  /**
   * Build PriceLineInput from the DTO items by fetching server-side prices from DB.
   * Prices and availability are NEVER taken from the client.
   * Validates active flags, outlet ownership, scheduled availability, modifier availability,
   * and modifier-group ownership.
   * Reference: AGENTS §2 rule 2
   */
  private async buildPricingInput(
    orgId: string,
    outletId: string,
    items: Array<{ menu_item_id: string; quantity: number; modifiers: Array<{ modifier_id: string }>; portion?: 'FULL' | 'HALF'; notes?: string | null }>,
    db: PoolClient,
  ): Promise<PriceLineInput[]> {
    const itemIds = [...new Set(items.map((i) => i.menu_item_id))];
    const { rows: menuItems } = await db.query<{
      id: string; name: string; price_paise: number; is_available: boolean;
      is_active?: boolean; outlet_id?: string | null;
      allow_half_portion?: boolean; half_price_paise?: number | null;
    }>(
      `SELECT id, name, price_paise, is_available, is_active, outlet_id, allow_half_portion, half_price_paise
       FROM menu_items WHERE id = ANY($1) AND org_id = $2`,
      [itemIds, orgId],
    );
    const menuItemMap = new Map(menuItems.map((m) => [m.id, m]));

    // Check scheduled availability rules (if configured for any item in this outlet/org)
    const { rows: availRows } = await db.query<{
      item_id: string; day_of_week: number | null; start_time: string | null; end_time: string | null; is_available: boolean;
    }>(
      `SELECT item_id, day_of_week, start_time, end_time, is_available
       FROM item_availability
       WHERE org_id = $1 AND item_id = ANY($2) AND (outlet_id IS NULL OR outlet_id = $3)`,
      [orgId, itemIds, outletId],
    );
    const availByItem = new Map<string, typeof availRows>();
    for (const r of availRows) {
      const list = availByItem.get(r.item_id) ?? [];
      list.push(r);
      availByItem.set(r.item_id, list);
    }

    const now = new Date();
    const todayDow = now.getUTCDay();
    const currentHms = now.toISOString().slice(11, 19);

    // Validate all items exist, belong to the outlet, and are active/available
    for (const item of items) {
      const mi = menuItemMap.get(item.menu_item_id);
      if (!mi) throw domainError(ErrorCode.NOT_FOUND, `Menu item ${item.menu_item_id} not found.`, 404);
      if (mi.is_active === false) {
        throw domainError(ErrorCode.ITEM_UNAVAILABLE, `'${mi.name}' is not active.`, 400);
      }
      if (mi.outlet_id && mi.outlet_id !== outletId) {
        throw domainError(ErrorCode.ITEM_UNAVAILABLE, `'${mi.name}' is not available at this outlet.`, 400);
      }
      if (!mi.is_available) {
        throw domainError(ErrorCode.ITEM_UNAVAILABLE, `'${mi.name}' is currently unavailable.`, 400);
      }
      const schedules = availByItem.get(mi.id) ?? [];
      const dayMatches = schedules.filter((s) => s.day_of_week === null || s.day_of_week === todayDow);
      if (dayMatches.length > 0) {
        const blocked = dayMatches.some((s) => s.is_available === false);
        const positiveWindows = dayMatches.filter((s) => s.is_available === true);
        const insideWindow = positiveWindows.some((s) => {
          if (!s.start_time || !s.end_time) return true;
          return currentHms >= s.start_time && currentHms <= s.end_time;
        });
        if (blocked && !insideWindow) {
          throw domainError(ErrorCode.ITEM_UNAVAILABLE, `'${mi.name}' is currently unavailable by schedule.`, 400);
        }
        if (positiveWindows.length > 0 && !insideWindow) {
          throw domainError(ErrorCode.ITEM_UNAVAILABLE, `'${mi.name}' is outside its serving hours.`, 400);
        }
      }
      if (item.portion === 'HALF' && !mi.allow_half_portion) {
        throw domainError(ErrorCode.VALIDATION_ERROR, `'${mi.name}' does not offer a half plate option.`, 400);
      }
    }

    const modifierIds = [...new Set(items.flatMap((i) => i.modifiers.map((m) => m.modifier_id)))];
    const modMap = new Map<string, { group_id: string; price_paise: number; name: string; is_available: boolean }>();
    const itemAllowedGroups = new Map<string, Set<string>>();
    if (modifierIds.length > 0) {
      const { rows: mods } = await db.query<{
        id: string; group_id: string; name: string; price_paise: number; is_available: boolean;
      }>(
        `SELECT id, group_id, name, price_paise, is_available FROM modifiers WHERE id = ANY($1) AND org_id = $2`,
        [modifierIds, orgId],
      );
      for (const m of mods) {
        modMap.set(m.id, {
          group_id: m.group_id,
          price_paise: m.price_paise,
          name: m.name,
          is_available: m.is_available,
        });
      }

      const { rows: imgRows } = await db.query<{ item_id: string; group_id: string }>(
        `SELECT item_id, group_id FROM item_modifier_groups WHERE org_id = $1 AND item_id = ANY($2)`,
        [orgId, itemIds],
      );
      for (const link of imgRows) {
        const set = itemAllowedGroups.get(link.item_id) ?? new Set<string>();
        set.add(link.group_id);
        itemAllowedGroups.set(link.item_id, set);
      }
    }

    return items.map((line) => {
      const mi = menuItemMap.get(line.menu_item_id)!;
      const allowedGroups = itemAllowedGroups.get(line.menu_item_id);
      const modPaise = line.modifiers.reduce((sum, m) => {
        const mod = modMap.get(m.modifier_id);
        if (!mod) throw domainError(ErrorCode.NOT_FOUND, `Modifier ${m.modifier_id} not found.`, 404);
        if (!mod.is_available) {
          throw domainError(ErrorCode.ITEM_UNAVAILABLE, `Modifier '${mod.name}' is currently unavailable.`, 400);
        }
        if (!allowedGroups || !allowedGroups.has(mod.group_id)) {
          throw domainError(
            ErrorCode.VALIDATION_ERROR,
            `Modifier '${mod.name}' is not allowed for '${mi.name}'.`,
            400,
          );
        }
        return sum + mod.price_paise;
      }, 0);

      const isHalf = line.portion === 'HALF';
      const basePricePaise = isHalf
        ? (mi.half_price_paise ?? Math.round((mi.price_paise * 0.62) / 1000) * 1000)
        : mi.price_paise;
      const nameSnapshot = isHalf ? `${mi.name} (Half)` : mi.name;

      return {
        menu_item_id: line.menu_item_id,
        name_snapshot: nameSnapshot,
        unit_price_paise: basePricePaise + modPaise,
        quantity: line.quantity,
        modifiers: line.modifiers.map((m) => ({
          modifier_id: m.modifier_id,
          name: modMap.get(m.modifier_id)!.name,
          price_paise: modMap.get(m.modifier_id)!.price_paise,
        })),
        notes: line.notes ?? null,
      };
    });
  }

  /** Link every table touched by a temporary customer order/reassignment cleanly until Captain cleans it. */
  private async linkTempCustomerTables(
    orgId: string,
    outletId: string,
    tempCustomerId: string,
    tableIds: string[],
    db: PoolClient,
  ): Promise<void> {
    const uniqueTableIds = [...new Set(tableIds.filter(Boolean))];
    for (const tableId of uniqueTableIds) {
      await db.query(
        `INSERT INTO temp_customer_tables (org_id, outlet_id, temp_customer_id, table_id, status)
         VALUES ($1, $2, $3, $4, 'ACTIVE')
         ON CONFLICT (org_id, temp_customer_id, table_id)
         DO UPDATE SET status = 'ACTIVE', cleaned_at = NULL, cleaned_by = NULL, updated_at = now()`,
        [orgId, outletId, tempCustomerId, tableId],
      );
    }
  }

  /** Fetch the full order + items within an already-open tenant context. */
  private async getOrderInTx(orgId: string, orderId: string, db: PoolClient) {
    const { rows: orderRows } = await db.query(
      `SELECT o.*, t.table_number FROM orders o
       LEFT JOIN tables t ON t.id = o.table_id
       WHERE o.id = $1 AND o.org_id = $2`,
      [orderId, orgId],
    );
    if (!orderRows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
    const { rows: itemRows } = await db.query(
      `SELECT ${ORDER_ITEM_SELECT_FIELDS}
       FROM order_items oi
       LEFT JOIN tables tt ON tt.id = oi.target_table_id
       WHERE oi.order_id = $1 AND oi.org_id = $2 ORDER BY oi.created_at`,
      [orderId, orgId],
    );
    return { ...orderRows[0], items: itemRows };
  }
}
