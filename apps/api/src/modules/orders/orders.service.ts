import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import {
  assertCustomerAccessScope,
  type CustomerAccessScope,
} from '../../common/utils/ownership.utils.js';
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
  type PriceLineInput,
} from './pricing.engine.js';
import type {
  QuoteOrderSchema,
  PlaceOrderSchema,
  UpdateOrderStatusSchema,
  UpdateItemStatusSchema,
  OrderQuerySchema,
} from './orders.dto.js';
import type { z } from 'zod';

type QuoteOrderInput    = z.infer<typeof QuoteOrderSchema>;
type PlaceOrderInput    = z.infer<typeof PlaceOrderSchema>;
type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;
type UpdateItemStatusInput  = z.infer<typeof UpdateItemStatusSchema>;
type OrderQueryInput    = z.infer<typeof OrderQuerySchema>;

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
  'id, menu_item_id, name_snapshot, unit_price_paise, quantity, line_total_paise, modifiers, notes, status, created_at, updated_at';

@Injectable()
export class OrdersService {
  private static readonly UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // ─── Quote ───────────────────────────────────────────────────────────────────

  async quoteOrder(orgId: string, dto: QuoteOrderInput) {
    return withTenantContextRaw(orgId, async (db) => {
      const pricingInput = await this.buildPricingInput(orgId, dto.items, db);
      const quote = computeQuote({
        lines: pricingInput,
        taxConfig: DEFAULT_GST_CONFIG,  // TODO Phase 5: load per-outlet tax_config
        discountHook: NOOP_DISCOUNT,    // TODO Phase 7: loyalty/coupon hooks
        tipPaise: dto.tip_paise ?? 0,
      });
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

      for (const ord of rows) {
        const { rows: itemRows } = await db.query(
          `SELECT ${ORDER_ITEM_SELECT_FIELDS}
           FROM order_items WHERE order_id = $1 AND org_id = $2 ORDER BY created_at`,
          [ord.id, targetOrgId],
        );
        (ord as any).items = itemRows;
      }

      return rows;
    });
  }

  async getOrder(orgId: string, orderId: string, scope?: CustomerAccessScope) {
    const targetOrgId = await this.resolveOrderOrgId(orgId, orderId);

    return withTenantContextRaw(targetOrgId, async (db) => {
      const order = await this.getOrderInTx(targetOrgId, orderId, db);
      if (scope) {
        let sessionCustomerId: string | null = null;
        if (order.session_id) {
          const { rows: sRows } = await db.query<{ customer_id: string | null }>(
            `SELECT customer_id FROM table_sessions WHERE id = $1 AND org_id = $2`,
            [order.session_id, targetOrgId],
          );
          sessionCustomerId = sRows[0]?.customer_id ?? null;
        }
        assertCustomerAccessScope(scope, {
          session_id: order.session_id,
          customer_id: order.customer_id,
          session_customer_id: sessionCustomerId,
        });
      }
      return order;
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
        const { rows: sRows } = await db.query<{ id: string; customer_id: string | null }>(
          `SELECT id, customer_id FROM table_sessions WHERE id = $1 AND org_id = $2`,
          [sessionId, orgId],
        );
        const sess = sRows[0];
        if (!sess) throw domainError(ErrorCode.NOT_FOUND, 'Session not found.', 404);
        assertCustomerAccessScope(scope, {
          session_id: sess.id,
          session_customer_id: sess.customer_id,
        });
      }

      const { rows: orders } = await db.query(
        `SELECT o.*, t.table_number,
                (SELECT p.status FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_status,
                (SELECT p.method FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_method,
                (SELECT p.settled_at FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at DESC LIMIT 1) as payment_settled_at
         FROM orders o
         LEFT JOIN tables t ON t.id = o.table_id
         WHERE o.session_id = $1 AND o.org_id = $2
         ORDER BY o.created_at DESC`,
        [sessionId, orgId],
      );
      for (const ord of orders) {
        const { rows: itemRows } = await db.query(
          `SELECT ${ORDER_ITEM_SELECT_FIELDS}
           FROM order_items WHERE order_id = $1 AND org_id = $2 ORDER BY created_at`,
          [ord.id, orgId],
        );
        ord.items = itemRows;
      }
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
        id: string; table_id: string; outlet_id: string; status: string; customer_id: string | null;
      }>(
        `SELECT id, table_id, outlet_id, status, customer_id FROM table_sessions
         WHERE id = $1 AND org_id = $2`,
        [dto.session_id, targetOrgId],
      );
      const session = sessionRows[0];
      if (!session) throw domainError(ErrorCode.NOT_FOUND, 'Session not found.', 404);
      if (actorType === 'CUSTOMER' && scope) {
        assertCustomerAccessScope(scope, {
          session_id: session.id,
          session_customer_id: session.customer_id,
        });
      }
      if (session.status !== 'OPEN') {
        throw domainError(ErrorCode.VALIDATION_ERROR, 'Session is not open.', 400);
      }

      // ── 3. Server-side pricing (AGENTS §2 rule 2) ─────────────────────────────
      const pricingInput = await this.buildPricingInput(targetOrgId, dto.items, db);
      const quote = computeQuote({
        lines: pricingInput,
        taxConfig: DEFAULT_GST_CONFIG,
        discountHook: NOOP_DISCOUNT,
        tipPaise: dto.tip_paise ?? 0,
      });

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

      // ── 5. Write order + items + events atomically ──────────────────────────
      const { rows: orderRows } = await db.query<{ id: string }>(
        `INSERT INTO orders (org_id, outlet_id, table_id, session_id, idempotency_key,
                             status, subtotal_paise, tax_paise, discount_paise, total_paise, notes)
         VALUES ($1, $2, $3, $4, $5, 'PENDING', $6, $7, 0, $8, $9)
         RETURNING id`,
        [
          targetOrgId, session.outlet_id, session.table_id, session.id,
          dto.idempotency_key,
          quote.subtotal_paise, quote.tax_paise,
          quote.total_paise,
          dto.notes ?? null,
        ],
      );
      const orderId = orderRows[0]!.id;

      for (const line of quote.lines) {
        await db.query(
          `INSERT INTO order_items (org_id, order_id, menu_item_id, name_snapshot,
                                    unit_price_paise, quantity, line_total_paise, modifiers, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            targetOrgId, orderId, line.menu_item_id, line.name_snapshot,
            line.unit_price_paise, line.quantity, line.line_total_paise,
            JSON.stringify(line.modifiers),
            // find notes from the original dto for this line
            dto.items.find((i) => i.menu_item_id === line.menu_item_id)?.notes ?? null,
          ],
        );
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
        [targetOrgId, orderId, JSON.stringify({ session_id: session.id, total_paise: quote.total_paise })],
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
  ) {
    const targetOrgId = await this.resolveOrderOrgId(orgId, orderId);

    return withTenantContextRaw(targetOrgId, async (db) => {
      const { rows } = await db.query<{ status: OrderStatus }>(
        `SELECT status FROM orders WHERE id = $1 AND org_id = $2`,
        [orderId, targetOrgId],
      );
      const order = rows[0];
      if (!order) throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
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
        [targetOrgId, orderId, JSON.stringify({ from: order.status, to: dto.status })],
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
  ) {
    if (!OrdersService.UUID_RE.test(itemId)) {
      throw domainError(ErrorCode.NOT_FOUND, 'Order item not found.', 404);
    }
    const targetOrgId = await this.resolveOrderOrgId(orgId, orderId);

    return withTenantContextRaw(targetOrgId, async (db) => {
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

  /**
   * Build PriceLineInput from the DTO items by fetching server-side prices from DB.
   * Prices and availability are NEVER taken from the client.
   * Reference: AGENTS §2 rule 2
   */
  private async buildPricingInput(
    orgId: string,
    items: Array<{ menu_item_id: string; quantity: number; modifiers: Array<{ modifier_id: string }>; portion?: 'FULL' | 'HALF'; notes?: string | null }>,
    db: PoolClient,
  ): Promise<PriceLineInput[]> {
    const itemIds = [...new Set(items.map((i) => i.menu_item_id))];
    const { rows: menuItems } = await db.query<{
      id: string; name: string; price_paise: number; is_available: boolean;
      allow_half_portion?: boolean; half_price_paise?: number | null;
    }>(
      `SELECT id, name, price_paise, is_available, allow_half_portion, half_price_paise
       FROM menu_items WHERE id = ANY($1) AND org_id = $2`,
      [itemIds, orgId],
    );
    const menuItemMap = new Map(menuItems.map((m) => [m.id, m]));

    // Validate all items exist and are available
    for (const item of items) {
      const mi = menuItemMap.get(item.menu_item_id);
      if (!mi) throw domainError(ErrorCode.NOT_FOUND, `Menu item ${item.menu_item_id} not found.`, 404);
      if (!mi.is_available) {
        throw domainError(ErrorCode.VALIDATION_ERROR, `'${mi.name}' is currently unavailable.`, 400);
      }
      if (item.portion === 'HALF' && !mi.allow_half_portion) {
        throw domainError(ErrorCode.VALIDATION_ERROR, `'${mi.name}' does not offer a half plate option.`, 400);
      }
    }

    const modifierIds = [...new Set(items.flatMap((i) => i.modifiers.map((m) => m.modifier_id)))];
    const modMap = new Map<string, { price_paise: number; name: string }>();
    if (modifierIds.length > 0) {
      const { rows: mods } = await db.query<{ id: string; name: string; price_paise: number }>(
        `SELECT id, name, price_paise FROM modifiers WHERE id = ANY($1) AND org_id = $2`,
        [modifierIds, orgId],
      );
      for (const m of mods) modMap.set(m.id, { price_paise: m.price_paise, name: m.name });
    }

    return items.map((line) => {
      const mi = menuItemMap.get(line.menu_item_id)!;
      const modPaise = line.modifiers.reduce((sum, m) => {
        const mod = modMap.get(m.modifier_id);
        if (!mod) throw domainError(ErrorCode.NOT_FOUND, `Modifier ${m.modifier_id} not found.`, 404);
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
       FROM order_items WHERE order_id = $1 AND org_id = $2 ORDER BY created_at`,
      [orderId, orgId],
    );
    return { ...orderRows[0], items: itemRows };
  }
}
