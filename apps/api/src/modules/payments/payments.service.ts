/**
 * PaymentsService — core payment business logic.
 *
 * Provider routing (user spec):
 *   UPI / UPI_INTENT → PhonePe
 *   CARD / NETBANKING / WALLET → Razorpay
 *   CASH / DIRECT_UPI_STAFF / PAY_AT_COUNTER → staff-confirmed (no gateway)
 *
 * Security invariants (AGENTS §2):
 *  Rule 1:  All amounts integer paise — never float.
 *  Rule 2:  Amount re-derived from order at payment creation — never trusted from client.
 *  Rule 6:  payment row + order_events in same DB TX.
 *  Rule 8:  Idempotency enforced at DB level (UNIQUE org_id + idempotency_key).
 *  Rule 9:  Webhook: verify signature on raw body → insert webhook_inbox (UNIQUE) →
 *           process async idempotently. Never trust redirect for payment success.
 *
 * NEEDS_HUMAN_REVIEW: amount mismatch handling, refund amount checks, PRICE_CHANGED
 * Reference: ARCH §11
 */

import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw, getPool } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';
import { PhonePeAdapter } from './phonepe.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';
import type { PaymentProvider, PaymentMethod } from './payment-provider.interface.js';
import type { CreatePaymentDto } from './payments.dto.js';
import {
  assertCustomerAccessScope,
  type CustomerAccessScope,
} from '../../common/utils/ownership.utils.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  // ─── Provider routing ──────────────────────────────────────────────────────
  private resolveProvider(method: PaymentMethod): PaymentProvider {
    switch (method) {
      case 'UPI':
      case 'UPI_INTENT':
        return PhonePeAdapter;
      case 'CARD':
      case 'NETBANKING':
      case 'WALLET':
        return RazorpayAdapter;
      default:
        // CASH, DIRECT_UPI_STAFF, PAY_AT_COUNTER handled without a gateway
        throw domainError(ErrorCode.VALIDATION_ERROR, `Method '${method}' does not use an online gateway.`, 400);
    }
  }

  // ─── Create Payment ────────────────────────────────────────────────────────

  async createPayment(
    orgId: string,
    dto: CreatePaymentDto,
    actorId: string,
    actorType: 'STAFF' | 'CUSTOMER',
    scope?: CustomerAccessScope,
  ) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const targetOrgId = orgId;

    return withTenantContextRaw(targetOrgId, async (db) => {
      // 1. Idempotency check
      const { rows: existing } = await db.query(
        `SELECT id, status, raw_response FROM payments WHERE org_id = $1 AND idempotency_key = $2`,
        [targetOrgId, dto.idempotency_key],
      );
      if (existing[0]) {
        if (actorType === 'CUSTOMER') {
          const { rows: ordRows } = await db.query<{
            session_id: string; customer_id: string | null; session_customer_id: string | null;
          }>(
            `SELECT o.session_id, o.customer_id, ts.customer_id AS session_customer_id
             FROM orders o
             LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
             WHERE o.id = $1 AND o.org_id = $2`,
            [dto.order_id, targetOrgId],
          );
          if (!ordRows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
          assertCustomerAccessScope(scope ?? {}, ordRows[0]);
        }
        return existing[0];
      }

      // 2. Load and validate order — amount derived server-side (AGENTS §2 rule 2)
      const { rows: orderRows } = await db.query<{
        id: string;
        total_paise: number;
        status: string;
        session_id: string;
        customer_id: string | null;
        session_customer_id: string | null;
      }>(
        `SELECT o.id, o.total_paise, o.status, o.session_id, o.customer_id,
                ts.customer_id AS session_customer_id
         FROM orders o
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         WHERE o.id = $1 AND o.org_id = $2`,
        [dto.order_id, targetOrgId],
      );
      const order = orderRows[0];
      if (!order) throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
      if (actorType === 'CUSTOMER') {
        assertCustomerAccessScope(scope ?? {}, order);
      }
      if (['CANCELLED', 'BILLED'].includes(order.status)) {
        throw domainError(ErrorCode.VALIDATION_ERROR, `Cannot pay a ${order.status} order.`, 400);
      }

      // 3. Use server-derived amount — NEVER client-sent amount
      const amountPaise = order.total_paise;

      // 4. Counter / cash modes: only STAFF can mark PAID & CONFIRMED;
      //    CUSTOMER can only submit a PENDING request awaiting cashier verification.
      if (['CASH', 'DIRECT_UPI_STAFF', 'PAY_AT_COUNTER'].includes(dto.method)) {
        if (actorType === 'STAFF') {
          return this.recordStaffConfirmedPayment(targetOrgId, order.id, amountPaise, dto, actorId, actorType, db);
        }
        return this.recordCustomerCounterRequest(targetOrgId, order.id, amountPaise, dto, actorId, db);
      }

      // 5. Gateway payment
      const provider = this.resolveProvider(dto.method as PaymentMethod);
      const result = await provider.createPayment({
        orderId:        order.id,
        idempotencyKey: dto.idempotency_key,
        amountPaise,
        currency:       'INR',
        method:         dto.method as PaymentMethod,
        returnUrl:      dto.return_url ?? ``,
        customerPhone:  dto.customer_phone,
        customerName:   dto.customer_name,
      });

      // 6. Persist payment row + audit event (same TX — AGENTS §2 rule 6)
      const { rows: payRows } = await db.query<{ id: string }>(
        `INSERT INTO payments (org_id, order_id, idempotency_key, provider, provider_order_id,
                               method, amount_paise, currency, status, raw_response)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'INR', 'CREATED', $8)
         RETURNING id`,
        [
          targetOrgId, order.id, dto.idempotency_key, provider.name,
          result.providerOrderId, dto.method, amountPaise,
          JSON.stringify(result.checkoutPayload),
        ],
      );
      const paymentId = payRows[0]!.id;

      const validActorUuid =
        actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)
          ? actorId
          : null;

      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'PAYMENT_CREATED', $3, $4, $5)`,
        [targetOrgId, order.id, actorType, validActorUuid,
         JSON.stringify({ payment_id: paymentId, method: dto.method, amount_paise: amountPaise })],
      );

      this.logger.log(`Payment created: id=${paymentId} provider=${provider.name} method=${dto.method}`);
      return { id: paymentId, ...result };
    });
  }

  // ─── Mark Paid (staff-confirmed: CASH / DIRECT_UPI_STAFF / PAY_AT_COUNTER) ─

  private async recordStaffConfirmedPayment(
    orgId: string,
    orderId: string,
    amountPaise: number,
    dto: CreatePaymentDto,
    actorId: string,
    actorType: 'STAFF' | 'CUSTOMER',
    db: PoolClient,
  ) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO payments (org_id, order_id, idempotency_key, provider, method,
                             amount_paise, currency, status, settled_at, raw_response)
       VALUES ($1, $2, $3, $4, $5, $6, 'INR', 'PAID', now(), '{}')
       RETURNING id`,
      [orgId, orderId, dto.idempotency_key, 'staff', dto.method, amountPaise],
    );
    const paymentId = rows[0]!.id;

    await db.query(
      `UPDATE orders SET status = 'CONFIRMED', updated_at = now() WHERE id = $1 AND org_id = $2`,
      [orderId, orgId],
    );

    const validActorUuid =
      actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)
        ? actorId
        : null;

    await db.query(
      `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, 'PAYMENT_CONFIRMED_STAFF', $3, $4, $5)`,
      [orgId, orderId, actorType, validActorUuid,
       JSON.stringify({ payment_id: paymentId, method: dto.method, amount_paise: amountPaise })],
    );

    this.logger.log(`Staff-confirmed payment: id=${paymentId} method=${dto.method}`);
    return { id: paymentId, status: 'PAID', method: dto.method };
  }

  /**
   * Customer request to pay by cash / counter UPI: remains PENDING until cashier confirms.
   * NEVER sets status = 'PAID' or order.status = 'CONFIRMED'.
   */
  private async recordCustomerCounterRequest(
    orgId: string,
    orderId: string,
    amountPaise: number,
    dto: CreatePaymentDto,
    actorId: string,
    db: PoolClient,
  ) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO payments (org_id, order_id, idempotency_key, provider, method,
                             amount_paise, currency, status, settled_at, raw_response)
       VALUES ($1, $2, $3, $4, $5, $6, 'INR', 'PENDING', NULL, '{}')
       RETURNING id`,
      [orgId, orderId, dto.idempotency_key, 'counter_request', dto.method, amountPaise],
    );
    const paymentId = rows[0]!.id;

    const validActorUuid =
      actorId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actorId)
        ? actorId
        : null;

    await db.query(
      `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
       VALUES ($1, $2, 'PAYMENT_COUNTER_REQUESTED', 'CUSTOMER', $3, $4)`,
      [
        orgId,
        orderId,
        validActorUuid,
        JSON.stringify({ payment_id: paymentId, method: dto.method, amount_paise: amountPaise }),
      ],
    );

    this.logger.log(`Customer counter payment requested: id=${paymentId} method=${dto.method}`);
    return { id: paymentId, status: 'PENDING', method: dto.method };
  }

  // ─── Handle Webhook ─────────────────────────────────────────────────────────
  // Raw body + provider name → verify → insert webhook_inbox → process async.
  // NEVER trust redirect for success (AGENTS §2 rule 9, ARCH §11).

  async handleWebhook(
    provider: 'phonepe' | 'razorpay',
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ received: boolean }> {
    const adapter = provider === 'phonepe' ? PhonePeAdapter : RazorpayAdapter;
    const { valid, eventId, event } = adapter.verifyWebhook(rawBody, headers);

    const pool = getPool();
    const client = await pool.connect();
    try {
      // Insert into webhook_inbox — UNIQUE(provider, event_id) prevents duplicates
      const { rows } = await client.query<{ id: string; status: string }>(
        `INSERT INTO webhook_inbox (provider, event_id, signature_valid, raw_payload)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (provider, event_id) DO UPDATE SET signature_valid = EXCLUDED.signature_valid
         RETURNING id, status`,
        [provider, eventId || 'unknown_' + Date.now(), valid, JSON.stringify(event.raw ?? {})],
      );
      const inboxId = rows[0]!.id;
      const alreadyProcessed = rows[0]!.status === 'PROCESSED';

      if (!valid) {
        await client.query(
          `UPDATE webhook_inbox SET status = 'SKIPPED', processed_at = now() WHERE id = $1`,
          [inboxId],
        );
        this.logger.warn(`Webhook signature invalid: provider=${provider} eventId=${eventId}`);
        return { received: true }; // Always return 200 to prevent gateway retry storms
      }

      if (alreadyProcessed) {
        this.logger.debug(`Duplicate webhook ignored: provider=${provider} eventId=${eventId}`);
        return { received: true };
      }

      // Process: find the payment and update status
      await this.processWebhookEvent(client, inboxId, provider, event);
      return { received: true };
    } finally {
      client.release();
    }
  }

  private async processWebhookEvent(
    db: PoolClient,
    inboxId: string,
    provider: string,
    event: ReturnType<PaymentProvider['verifyWebhook']>['event'],
  ) {
    // Find payment by provider_order_id
    const { rows } = await db.query<{
      id: string; org_id: string; order_id: string; amount_paise: number; status: string;
    }>(
      `SELECT id, org_id, order_id, amount_paise, status
       FROM payments WHERE provider = $1 AND provider_order_id = $2
       LIMIT 1`,
      [provider, event.providerOrderId],
    );
    const payment = rows[0];

    if (!payment) {
      await db.query(
        `UPDATE webhook_inbox SET status = 'SKIPPED', processed_at = now() WHERE id = $1`,
        [inboxId],
      );
      this.logger.warn(`No payment found for providerOrderId=${event.providerOrderId}`);
      return;
    }

    // AMOUNT MISMATCH check — flag instead of auto-accept (AGENTS §2, ARCH §11)
    if (event.amountPaise !== payment.amount_paise) {
      await db.query(
        `UPDATE payments SET status = 'MISMATCH', raw_response = $1, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(event.raw), payment.id],
      );
      this.logger.warn(
        `AMOUNT MISMATCH: payment=${payment.id} expected=${payment.amount_paise} got=${event.amountPaise}`,
      );
      await db.query(
        `UPDATE webhook_inbox SET status = 'PROCESSED', processed_at = now() WHERE id = $1`,
        [inboxId],
      );
      return;
    }

    // Update payment status
    const newStatus = event.status === 'PAID' ? 'PAID'
                    : event.status === 'FAILED' ? 'FAILED'
                    : payment.status; // no change for PENDING

    await db.query(
      `UPDATE payments SET
         status = $1,
         provider_payment_id = COALESCE($2, provider_payment_id),
         fee_paise = COALESCE($3, fee_paise),
         settled_at = CASE WHEN $1 = 'PAID' THEN now() ELSE settled_at END,
         raw_response = $4,
         updated_at = now()
       WHERE id = $5`,
      [
        newStatus,
        event.providerPaymentId ?? null,
        event.feePaise ?? null,
        JSON.stringify(event.raw),
        payment.id,
      ],
    );

    // On successful payment: move order to CONFIRMED for kitchen new orders queue
    if (event.status === 'PAID') {
      await db.query(
        `UPDATE orders SET status = 'CONFIRMED', updated_at = now()
         WHERE id = $1 AND status NOT IN ('CANCELLED', 'SERVED', 'BILLED')`,
        [payment.order_id],
      );
      // Write to outbox for realtime propagation
      await db.query(
        `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
         VALUES ($1, 'payment', $2, 'PAYMENT_CAPTURED', $3)`,
        [
          payment.org_id, payment.id,
          JSON.stringify({ order_id: payment.order_id, amount_paise: event.amountPaise }),
        ],
      );
    }

    await db.query(
      `UPDATE webhook_inbox SET status = 'PROCESSED', processed_at = now() WHERE id = $1`,
      [inboxId],
    );

    this.logger.log(`Webhook processed: payment=${payment.id} status=${newStatus}`);
  }

  // ─── Refund ────────────────────────────────────────────────────────────────

  async createRefund(
    orgId: string,
    paymentId: string,
    dto: { amount_paise: number; reason: string; idempotency_key: string },
    actorId: string,
  ) {
    return withTenantContextRaw(orgId, async (db) => {

      // Idempotency
      const { rows: existing } = await db.query(
        `SELECT id, status FROM refunds WHERE org_id = $1 AND idempotency_key = $2`,
        [orgId, dto.idempotency_key],
      );
      if (existing[0]) return existing[0];

      const { rows: payRows } = await db.query<{
        id: string; order_id: string; amount_paise: number; status: string;
        provider: string; provider_payment_id: string;
      }>(
        `SELECT id, order_id, amount_paise, status, provider, provider_payment_id
         FROM payments WHERE id = $1 AND org_id = $2`,
        [paymentId, orgId],
      );
      const payment = payRows[0];
      if (!payment) throw domainError(ErrorCode.NOT_FOUND, 'Payment not found.', 404);
      if (!['PAID', 'PARTIALLY_REFUNDED'].includes(payment.status)) {
        throw domainError(ErrorCode.VALIDATION_ERROR, `Cannot refund a payment with status '${payment.status}'.`, 400);
      }

      // Calculate already-refunded amount to prevent over-refund
      const { rows: refRows } = await db.query<{ total: number }>(
        `SELECT COALESCE(SUM(amount_paise), 0)::bigint as total
         FROM refunds WHERE payment_id = $1 AND status != 'FAILED'`,
        [paymentId],
      );
      const alreadyRefunded = Number(refRows[0]?.total ?? 0);
      const maxRefundable = payment.amount_paise - alreadyRefunded;

      if (dto.amount_paise > maxRefundable) {
        throw domainError(
          ErrorCode.REFUND_EXCEEDS_AMOUNT,
          `Refund of ₹${dto.amount_paise / 100} exceeds refundable amount ₹${maxRefundable / 100}.`,
          400,
        );
      }

      // Call provider refund (only for gateway payments)
      let providerRefundId = `staff_refund_${dto.idempotency_key}`;
      let providerStatus: string = 'SUCCEEDED';

      if (!['staff', 'cash', 'direct_upi'].includes(payment.provider)) {
        const adapter = this.resolveProvider(
          payment.provider === 'phonepe' ? 'UPI' : 'CARD',
        );
        const refundResult = await adapter.refund({
          providerPaymentId: payment.provider_payment_id,
          amountPaise:       dto.amount_paise,
          reason:            dto.reason,
          idempotencyKey:    dto.idempotency_key,
        });
        providerRefundId = refundResult.providerRefundId;
        providerStatus   = refundResult.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'PENDING';
      }

      // Persist refund + update payment status
      const { rows: refundRows } = await db.query<{ id: string }>(
        `INSERT INTO refunds (org_id, payment_id, idempotency_key, amount_paise, reason,
                              status, provider_refund_id, initiated_by_type, initiated_by_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'STAFF', $8)
         RETURNING id`,
        [orgId, paymentId, dto.idempotency_key, dto.amount_paise, dto.reason,
         providerStatus, providerRefundId, actorId],
      );
      const refundId = refundRows[0]!.id;

      const newPaymentStatus = dto.amount_paise >= payment.amount_paise
        ? 'REFUNDED'
        : 'PARTIALLY_REFUNDED';

      await db.query(
        `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2`,
        [newPaymentStatus, paymentId],
      );
      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'REFUND_INITIATED', 'STAFF', $3, $4)`,
        [orgId, payment.order_id, actorId,
         JSON.stringify({ refund_id: refundId, amount_paise: dto.amount_paise, reason: dto.reason })],
      );

      return { id: refundId, status: providerStatus, amount_paise: dto.amount_paise };
    });
  }

  // ─── Get Payment ──────────────────────────────────────────────────────────

  async getPayment(orgId: string, paymentId: string, scope?: CustomerAccessScope) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    return withTenantContextRaw(orgId, async (db) => {
      const { rows } = await db.query(
        `SELECT p.*, r.id as refund_id, r.amount_paise as refund_amount, r.status as refund_status,
                o.session_id, o.customer_id, ts.customer_id AS session_customer_id
         FROM payments p
         JOIN orders o ON o.id = p.order_id AND o.org_id = p.org_id
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         LEFT JOIN refunds r ON r.payment_id = p.id AND r.org_id = p.org_id
         WHERE p.id = $1 AND p.org_id = $2`,
        [paymentId, orgId],
      );
      if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Payment not found.', 404);
      assertCustomerAccessScope(scope, rows[0]);
      const { session_id: _sid, customer_id: _cid, session_customer_id: _scid, ...payment } = rows[0];
      return payment;
    });
  }

  // ─── Reconciliation (called by scheduled job) ────────────────────────────

  async reconcilePendingPayments(): Promise<void> {
    // Find payments PENDING for > 5 minutes (no org context needed — system job)
    const pool = getPool();
    const client = await pool.connect();
    try {
      const { rows } = await client.query<{
        id: string; org_id: string; provider: string; provider_order_id: string; order_id: string;
      }>(
        `SELECT id, org_id, provider, provider_order_id, order_id
         FROM payments
         WHERE status IN ('CREATED', 'PENDING')
           AND created_at < now() - interval '5 minutes'
           AND provider NOT IN ('staff', 'cash', 'direct_upi')
         LIMIT 50`,
      );

      for (const row of rows) {
        try {
          const adapter = row.provider === 'phonepe' ? PhonePeAdapter : RazorpayAdapter;
          const payment = await adapter.fetchPayment(row.provider_order_id);

          if (payment.status !== 'PENDING') {
            await client.query(
              `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2`,
              [payment.status, row.id],
            );
            if (payment.status === 'PAID') {
              await client.query(
                `UPDATE orders SET status = 'CONFIRMED', updated_at = now()
                 WHERE id = $1 AND status NOT IN ('CANCELLED', 'SERVED', 'BILLED')`,
                [row.order_id],
              );
            }
            this.logger.log(`Reconciled: payment=${row.id} → ${payment.status}`);
          }
        } catch (err) {
          this.logger.error(`Reconcile failed for payment=${row.id}`, err);
        }
      }
    } finally {
      client.release();
    }
  }

  async simulatePaymentSuccess(paymentId: string) {
    if (process.env['NODE_ENV'] !== 'test') {
      throw domainError(
        ErrorCode.FORBIDDEN,
        'Payment simulation is disabled outside test environments.',
        403,
      );
    }
    const pool = getPool();
    const { rows } = await pool.query<{ id: string; org_id: string; order_id: string }>(
      `SELECT id, org_id, order_id FROM payments WHERE id = $1`,
      [paymentId],
    );
    if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Payment not found.', 404);
    const { org_id, order_id } = rows[0];

    return withTenantContextRaw(org_id, async (db) => {
      await db.query(
        `UPDATE payments SET status = 'PAID', settled_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2`,
        [paymentId, org_id],
      );
      await db.query(
        `UPDATE orders SET status = 'CONFIRMED', updated_at = now() WHERE id = $1 AND org_id = $2`,
        [order_id, org_id],
      );
      await db.query(
        `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
         VALUES ($1, $2, 'PAYMENT_CAPTURED', 'CUSTOMER', null, $3)`,
        [org_id, order_id, JSON.stringify({ payment_id: paymentId, simulated: true })],
      );
      return { success: true, paymentId, status: 'PAID' };
    });
  }

  async verifyPaymentStatus(orgId: string, paymentId: string, scope?: CustomerAccessScope) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }

    const payment = await withTenantContextRaw(orgId, async (db) => {
      const { rows } = await db.query<{
        id: string;
        org_id: string;
        order_id: string;
        status: string;
        provider: string;
        provider_order_id: string;
        amount_paise: number;
        session_id: string;
        customer_id: string | null;
        session_customer_id: string | null;
      }>(
        `SELECT p.id, p.org_id, p.order_id, p.status, p.provider, p.provider_order_id, p.amount_paise,
                o.session_id, o.customer_id, ts.customer_id AS session_customer_id
         FROM payments p
         JOIN orders o ON o.id = p.order_id AND o.org_id = p.org_id
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         WHERE p.id = $1 AND p.org_id = $2`,
        [paymentId, orgId],
      );
      if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Payment not found.', 404);
      assertCustomerAccessScope(scope, rows[0]);
      return rows[0];
    });

    if (payment.status === 'PAID') {
      return { success: true, paymentId: payment.id, status: 'PAID', settled: true };
    }

    if (payment.provider === 'phonepe' || payment.provider === 'razorpay') {
      const adapter = payment.provider === 'phonepe' ? PhonePeAdapter : RazorpayAdapter;
      try {
        const fetched = await adapter.fetchPayment(payment.provider_order_id);
        if (fetched.status === 'PAID') {
          return withTenantContextRaw(payment.org_id, async (db) => {
            await db.query(
              `UPDATE payments SET status = 'PAID', settled_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2`,
              [payment.id, payment.org_id],
            );
            await db.query(
              `UPDATE orders SET status = 'CONFIRMED', updated_at = now() WHERE id = $1 AND org_id = $2 AND status NOT IN ('CANCELLED', 'SERVED', 'BILLED')`,
              [payment.order_id, payment.org_id],
            );
            await db.query(
              `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
               VALUES ($1, $2, 'PAYMENT_CAPTURED', 'CUSTOMER', null, $3)`,
              [payment.org_id, payment.order_id, JSON.stringify({ payment_id: payment.id, verified: true })],
            );
            return { success: true, paymentId: payment.id, status: 'PAID', settled: true };
          });
        }
      } catch (err) {
        this.logger.warn(`Failed to reconcile payment ${payment.id} with provider:`, err);
      }
    }

    return { success: false, paymentId: payment.id, status: payment.status, settled: false };
  }

  async verifyPaymentByOrder(orgId: string, orderId: string, scope?: CustomerAccessScope) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const paymentId = await withTenantContextRaw(orgId, async (db) => {
      const { rows } = await db.query<{
        id: string; session_id: string; customer_id: string | null; session_customer_id: string | null;
      }>(
        `SELECT p.id, o.session_id, o.customer_id, ts.customer_id AS session_customer_id
         FROM payments p
         JOIN orders o ON o.id = p.order_id AND o.org_id = p.org_id
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         WHERE p.order_id = $1 AND p.org_id = $2
         ORDER BY p.created_at DESC LIMIT 1`,
        [orderId, orgId],
      );
      if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'No payment found for this order.', 404);
      assertCustomerAccessScope(scope, rows[0]);
      return rows[0].id;
    });
    return this.verifyPaymentStatus(orgId, paymentId, scope);
  }

  async simulatePaymentByOrder(orderId: string) {
    if (process.env['NODE_ENV'] !== 'test') {
      throw domainError(
        ErrorCode.FORBIDDEN,
        'Payment simulation is disabled outside test environments.',
        403,
      );
    }
    const pool = getPool();
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [orderId],
    );
    if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'No payment found for this order.', 404);
    return this.simulatePaymentSuccess(rows[0].id);
  }
}

