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
import { getRedis } from '../../common/redis/redis.client.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';
import { PhonePeAdapter } from './phonepe.adapter.js';
import { RazorpayAdapter } from './razorpay.adapter.js';
import type { PaymentProvider, PaymentMethod, TenantPaymentCredentials } from './payment-provider.interface.js';
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
            session_id: string;
            customer_id: string | null;
            session_customer_id: string | null;
            temp_customer_id?: string | null;
            session_temp_customer_id?: string | null;
          }>(
            `SELECT o.session_id, o.customer_id, ts.customer_id AS session_customer_id,
                    o.temp_customer_id, ts.temp_customer_id AS session_temp_customer_id
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
        temp_customer_id?: string | null;
        session_temp_customer_id?: string | null;
      }>(
        `SELECT o.id, o.total_paise, o.status, o.session_id, o.customer_id,
                ts.customer_id AS session_customer_id,
                o.temp_customer_id, ts.temp_customer_id AS session_temp_customer_id
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
      const tenantCredentials = await this.getTenantPaymentCredentials(targetOrgId, db);
      const result = await provider.createPayment({
        orderId:        order.id,
        idempotencyKey: dto.idempotency_key,
        amountPaise,
        currency:       'INR',
        method:         dto.method as PaymentMethod,
        returnUrl:      dto.return_url ?? ``,
        customerPhone:  dto.customer_phone,
        customerName:   dto.customer_name,
        tenantCredentials,
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

    // Gapless GST invoice generation on staff payment confirmation
    await this.generateGstInvoiceInTx(db, orgId, orderId, paymentId);

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

  // ─── Tenant Credentials Helpers ───────────────────────────────────────────

  /**
   * Resolve custom tenant-scoped payment gateway credentials stored on the organization.
   * Falls back to undefined (which causes adapters to use environment defaults).
   */
  async getTenantPaymentCredentials(
    orgId: string,
    client?: PoolClient,
  ): Promise<TenantPaymentCredentials | undefined> {
    const runner = client ?? getPool();
    try {
      const res = await runner.query<{ settings: Record<string, unknown> | null }>(
        `SELECT settings FROM organizations WHERE id = $1`,
        [orgId],
      );
      const rows = res?.rows ?? [];
      const settings = (rows[0]?.settings ?? {}) as Record<string, unknown>;
      const paymentCreds = (settings['payment_credentials'] ?? settings['phonepe']) as
        | Record<string, unknown>
        | undefined;
      if (paymentCreds && typeof paymentCreds === 'object') {
        const merchantId = typeof paymentCreds['merchantId'] === 'string' ? paymentCreds['merchantId'] : undefined;
        const saltKey = typeof paymentCreds['saltKey'] === 'string' ? paymentCreds['saltKey'] : undefined;
        const saltIndex = typeof paymentCreds['saltIndex'] === 'number' ? paymentCreds['saltIndex'] : undefined;
        if (merchantId || saltKey || saltIndex !== undefined) {
          return { merchantId, saltKey, saltIndex };
        }
      }
    } catch (err) {
      this.logger.debug(`Could not load tenant payment credentials for org=${orgId}:`, err);
    }
    return undefined;
  }

  /**
   * Inbound webhook resolver: finds tenant credentials matching a custom merchantId.
   */
  async findTenantCredentialsByMerchantId(merchantId: string): Promise<TenantPaymentCredentials | undefined> {
    const pool = getPool();
    try {
      const res = await pool.query<{ settings: Record<string, unknown> | null }>(
        `SELECT settings FROM organizations
         WHERE is_active = true
           AND (
             settings->'payment_credentials'->>'merchantId' = $1
             OR settings->'phonepe'->>'merchantId' = $1
           )
         LIMIT 1`,
        [merchantId],
      );
      const rows = res?.rows ?? [];
      if (rows[0]?.settings) {
        const paymentCreds = (rows[0].settings['payment_credentials'] ?? rows[0].settings['phonepe']) as
          | Record<string, unknown>
          | undefined;
        if (paymentCreds && typeof paymentCreds === 'object') {
          return {
            merchantId: typeof paymentCreds['merchantId'] === 'string' ? paymentCreds['merchantId'] : undefined,
            saltKey: typeof paymentCreds['saltKey'] === 'string' ? paymentCreds['saltKey'] : undefined,
            saltIndex: typeof paymentCreds['saltIndex'] === 'number' ? paymentCreds['saltIndex'] : undefined,
          };
        }
      }
    } catch (err) {
      this.logger.debug(`Could not resolve credentials for merchantId=${merchantId}:`, err);
    }
    return undefined;
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

    // Resolve tenant credentials if custom merchantId is present in PhonePe payload
    let tenantCredentials: TenantPaymentCredentials | undefined;
    if (provider === 'phonepe') {
      try {
        const parsed = JSON.parse(rawBody.toString('utf8'));
        if (parsed.response) {
          const decoded = JSON.parse(Buffer.from(parsed.response, 'base64').toString('utf8'));
          const merchantId = decoded.data?.merchantId;
          if (merchantId) {
            tenantCredentials = await this.findTenantCredentialsByMerchantId(merchantId);
          }
        }
      } catch {
        // Fall back to default verification
      }
    }

    const { valid, eventId, event } = adapter.verifyWebhook(rawBody, headers, tenantCredentials);

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

      // Process: find the payment and update status inside locked transaction
      await this.processWebhookEvent(client, inboxId, provider, event);
      return { received: true };
    } finally {
      client.release();
    }
  }

  private async processWebhookEvent(
    inboxClient: PoolClient,
    inboxId: string,
    provider: string,
    event: ReturnType<PaymentProvider['verifyWebhook']>['event'],
  ) {
    // 1. Resolve payment across tenants via SECURITY DEFINER helper requiring verified inboxId
    const { rows } = await inboxClient.query<{
      id: string; org_id: string; order_id: string; amount_paise: string | number; status: string;
    }>(
      `SELECT id, org_id, order_id, amount_paise, status
       FROM resolve_payment_by_provider_order($1, $2, $3)`,
      [provider, event.providerOrderId, inboxId],
    );
    const payment = rows[0];

    if (!payment) {
      await inboxClient.query(
        `UPDATE webhook_inbox SET status = 'SKIPPED', processed_at = now() WHERE id = $1`,
        [inboxId],
      );
      this.logger.warn(`No payment found for providerOrderId=${event.providerOrderId}`);
      return;
    }

    // 2. Process payment/order state changes inside forced RLS tenant context
    await withTenantContextRaw(payment.org_id, async (db) => {
      // 2a. Acquire row lock on payment record to prevent race conditions from concurrent webhook retries
      const { rows: lockedRows } = await db.query<{
        id: string;
        org_id: string;
        order_id: string;
        amount_paise: string | number;
        status: string;
        provider_payment_id: string | null;
      }>(
        `SELECT id, org_id, order_id, amount_paise, status, provider_payment_id
         FROM payments
         WHERE id = $1 AND org_id = $2
         FOR UPDATE`,
        [payment.id, payment.org_id],
      );
      const lockedPayment = lockedRows[0];
      if (!lockedPayment) {
        this.logger.warn(`Payment record not found under lock: id=${payment.id}`);
        return;
      }

      // 2b. Strict idempotency guard: if already settled as PAID, early-return to prevent duplicate outbox capture
      if (lockedPayment.status === 'PAID') {
        this.logger.log(
          `Payment ${lockedPayment.id} already settled (PAID). Skipping duplicate state transition and outbox capture.`,
        );
        return;
      }

      // 2c. AMOUNT MISMATCH check — compare via BigInt so bigint string vs number cannot false-fail
      if (BigInt(event.amountPaise) !== BigInt(lockedPayment.amount_paise)) {
        await db.query(
          `UPDATE payments SET status = 'MISMATCH', raw_response = $1, updated_at = now()
           WHERE id = $2 AND org_id = $3`,
          [JSON.stringify(event.raw), lockedPayment.id, lockedPayment.org_id],
        );
        this.logger.warn(
          `AMOUNT MISMATCH: payment=${lockedPayment.id} expected=${lockedPayment.amount_paise} got=${event.amountPaise}`,
        );
        return;
      }

      const newStatus = event.status === 'PAID' ? 'PAID'
                      : event.status === 'FAILED' ? 'FAILED'
                      : lockedPayment.status;

      await db.query(
        `UPDATE payments SET
           status = $1::payment_status,
           provider_payment_id = COALESCE($2, provider_payment_id),
           fee_paise = COALESCE($3, fee_paise),
           settled_at = CASE WHEN $1::text = 'PAID' THEN now() ELSE settled_at END,
           raw_response = $4,
           updated_at = now()
         WHERE id = $5 AND org_id = $6`,
        [
          newStatus,
          event.providerPaymentId ?? null,
          event.feePaise ?? null,
          JSON.stringify(event.raw),
          lockedPayment.id,
          lockedPayment.org_id,
        ],
      );

      if (event.status === 'PAID') {
        await db.query(
          `UPDATE orders SET status = 'CONFIRMED', updated_at = now()
           WHERE id = $1 AND org_id = $2 AND status NOT IN ('CANCELLED', 'SERVED', 'BILLED')`,
          [lockedPayment.order_id, lockedPayment.org_id],
        );
        await db.query(
          `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
           VALUES ($1, 'payment', $2, 'PAYMENT_CAPTURED', $3)`,
          [
            lockedPayment.org_id,
            lockedPayment.id,
            JSON.stringify({ order_id: lockedPayment.order_id, amount_paise: event.amountPaise }),
          ],
        );

        // 2d. Gapless Legal GST Invoice Generation inside transaction
        await this.generateGstInvoiceInTx(
          db,
          lockedPayment.org_id,
          lockedPayment.order_id,
          lockedPayment.id,
        );
      }

      this.logger.log(`Webhook processed: payment=${lockedPayment.id} status=${newStatus}`);
    });

    await inboxClient.query(
      `UPDATE webhook_inbox SET status = 'PROCESSED', processed_at = now() WHERE id = $1`,
      [inboxId],
    );
  }

  /**
   * Generates a gapless legal GST invoice inside an active transaction.
   * Locks and increments invoice_counters atomically per outlet per fiscal year.
   * Emits an INVOICE_GENERATED outbox event.
   */
  private async generateGstInvoiceInTx(
    db: PoolClient,
    orgId: string,
    orderId: string,
    paymentId: string,
  ): Promise<void> {
    // 1. Idempotency check: see if invoice already exists for this order
    const { rows: existingInvoices } = await db.query<{ id: string; invoice_ref: string }>(
      `SELECT id, invoice_ref FROM invoices WHERE order_id = $1 AND org_id = $2`,
      [orderId, orgId],
    );
    if (existingInvoices[0]) {
      this.logger.log(`Invoice already exists for order=${orderId}: ${existingInvoices[0].invoice_ref}`);
      return;
    }

    // 2. Load order and outlet metadata
    const { rows: orderRows } = await db.query<{
      id: string;
      outlet_id: string;
      subtotal_paise: number;
      tax_paise: number;
      discount_paise: number;
      total_paise: number;
      customer_id: string | null;
      buyer_name: string | null;
      outlet_settings: Record<string, unknown> | null;
      org_settings: Record<string, unknown> | null;
    }>(
      `SELECT o.id, o.outlet_id, o.subtotal_paise, o.tax_paise, o.discount_paise, o.total_paise,
              o.customer_id,
              c.display_name AS buyer_name,
              ou.settings AS outlet_settings,
              org.settings AS org_settings
       FROM orders o
       JOIN outlets ou ON ou.id = o.outlet_id AND ou.org_id = o.org_id
       JOIN organizations org ON org.id = o.org_id
       LEFT JOIN customers c ON c.id = o.customer_id AND c.org_id = o.org_id
       WHERE o.id = $1 AND o.org_id = $2`,
      [orderId, orgId],
    );

    const order = orderRows[0];
    if (!order) {
      this.logger.warn(`Cannot generate invoice: order not found id=${orderId}`);
      return;
    }

    // 3. Indian Fiscal Year calculation (April 1 to March 31)
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth(); // 0 = Jan, 3 = Apr
    const fiscalYear = currentMonth >= 3 ? currentYear : currentYear - 1;

    // 4. Lock & increment invoice_counters atomically (Gapless per outlet per fiscal year)
    const counterRes = await db.query<{ last_no: number }>(
      `INSERT INTO invoice_counters (outlet_id, fiscal_year, last_no)
       VALUES ($1, $2, 1)
       ON CONFLICT (outlet_id, fiscal_year)
       DO UPDATE SET last_no = invoice_counters.last_no + 1
       RETURNING last_no`,
      [order.outlet_id, fiscalYear],
    );
    const counterRows = counterRes?.rows ?? [];
    const invoiceNo = counterRows[0]?.last_no ?? 1;

    // Extract seller GSTIN from outlet settings or organization settings
    const outletSettings = (order.outlet_settings ?? {}) as Record<string, unknown>;
    const orgSettings = (order.org_settings ?? {}) as Record<string, unknown>;
    const sellerGstin =
      typeof outletSettings['gstin'] === 'string'
        ? (outletSettings['gstin'] as string)
        : typeof orgSettings['gstin'] === 'string'
          ? (orgSettings['gstin'] as string)
          : 'URP'; // Unregistered Person / URP fallback

    // 5% default restaurant GST breakup (2.5% CGST + 2.5% SGST)
    const cgstPaise = Math.round(Number(order.tax_paise) / 2);
    const sgstPaise = Number(order.tax_paise) - cgstPaise;
    const taxBreakup = {
      cgst_rate: 0.025,
      cgst_paise: cgstPaise,
      sgst_rate: 0.025,
      sgst_paise: sgstPaise,
    };

    // 5. Insert invoice record
    const invRes = await db.query<{ id: string; invoice_ref: string }>(
      `INSERT INTO invoices (
         org_id, outlet_id, order_id, payment_id,
         invoice_no, fiscal_year, buyer_name, seller_gstin,
         tax_breakup, subtotal_paise, tax_paise, discount_paise, total_paise, currency
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'INR')
       RETURNING id, invoice_ref`,
      [
        orgId,
        order.outlet_id,
        order.id,
        paymentId,
        invoiceNo,
        fiscalYear,
        order.buyer_name ?? 'Guest Diner',
        sellerGstin,
        JSON.stringify(taxBreakup),
        order.subtotal_paise,
        order.tax_paise,
        order.discount_paise,
        order.total_paise,
      ],
    );
    const invRows = invRes?.rows ?? [];
    const invoiceId = invRows[0]?.id;
    const invoiceRef = invRows[0]?.invoice_ref ?? `INV-${order.outlet_id}-${fiscalYear}-${invoiceNo}`;

    // 6. Record outbox event for invoice generation
    if (invoiceId) {
      await db.query(
        `INSERT INTO outbox_events (org_id, aggregate, aggregate_id, event_type, payload)
         VALUES ($1, 'invoice', $2, 'INVOICE_GENERATED', $3)`,
        [
          orgId,
          invoiceId,
          JSON.stringify({
            order_id: order.id,
            invoice_ref: invoiceRef,
            total_paise: order.total_paise,
          }),
        ],
      );
    }

    this.logger.log(`Generated GST invoice ${invoiceRef} (id=${invoiceId}) for order=${order.id}`);
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
         FROM payments WHERE id = $1 AND org_id = $2
         FOR UPDATE`,
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

      const newPaymentStatus = (alreadyRefunded + dto.amount_paise) >= payment.amount_paise
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
                o.session_id, o.customer_id, ts.customer_id AS session_customer_id,
                o.temp_customer_id, ts.temp_customer_id AS session_temp_customer_id
         FROM payments p
         JOIN orders o ON o.id = p.order_id AND o.org_id = p.org_id
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         LEFT JOIN refunds r ON r.payment_id = p.id AND r.org_id = p.org_id
         WHERE p.id = $1 AND p.org_id = $2`,
        [paymentId, orgId],
      );
      if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Payment not found.', 404);
      assertCustomerAccessScope(scope, rows[0]);
      const {
        session_id: _sid,
        customer_id: _cid,
        session_customer_id: _scid,
        temp_customer_id: _tcid,
        session_temp_customer_id: _stcid,
        ...payment
      } = rows[0];
      return payment;
    });
  }

  // ─── Reconciliation (called by scheduled job) ────────────────────────────

  async reconcilePendingPayments(): Promise<void> {
    // Coordinate across replicas with a Redis leader lease
    if (process.env['NODE_ENV'] !== 'test') {
      try {
        const redis = getRedis();
        const acquired = await redis.set('locks:payment_reconcile', '1', 'EX', 240, 'NX');
        if (acquired !== 'OK') {
          this.logger.debug('Skipping payment reconciliation; another replica holds the lease.');
          return;
        }
      } catch (err) {
        this.logger.warn('Redis lock unavailable for reconciliation; proceeding locally', err);
      }
    }

    const pool = getPool();
    const { rows } = await pool.query<{
      id: string; org_id: string; provider: string; provider_order_id: string; order_id: string;
    }>(`SELECT id, org_id, provider, provider_order_id, order_id FROM list_pending_payments_for_reconcile($1)`, [50]);

    for (const row of rows) {
      try {
        const adapter = row.provider === 'phonepe' ? PhonePeAdapter : RazorpayAdapter;
        const tenantCredentials = await this.getTenantPaymentCredentials(row.org_id);
        const payment = tenantCredentials
          ? await adapter.fetchPayment(row.provider_order_id, tenantCredentials)
          : await adapter.fetchPayment(row.provider_order_id);

        if (payment.status !== 'PENDING') {
          await withTenantContextRaw(row.org_id, async (db) => {
            await db.query(
              `UPDATE payments SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
              [payment.status, row.id, row.org_id],
            );
            if (payment.status === 'PAID') {
              await db.query(
                `UPDATE orders SET status = 'CONFIRMED', updated_at = now()
                 WHERE id = $1 AND org_id = $2 AND status NOT IN ('CANCELLED', 'SERVED', 'BILLED')`,
                [row.order_id, row.org_id],
              );
            }
          });
          this.logger.log(`Reconciled: payment=${row.id} → ${payment.status}`);
        }
      } catch (err) {
        this.logger.error(`Reconcile failed for payment=${row.id}`, err);
      }
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
      await this.generateGstInvoiceInTx(db, org_id, order_id, paymentId);
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
        temp_customer_id?: string | null;
        session_temp_customer_id?: string | null;
      }>(
        `SELECT p.id, p.org_id, p.order_id, p.status, p.provider, p.provider_order_id, p.amount_paise,
                o.session_id, o.customer_id, ts.customer_id AS session_customer_id,
                o.temp_customer_id, ts.temp_customer_id AS session_temp_customer_id
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
        const tenantCredentials = await this.getTenantPaymentCredentials(payment.org_id);
        const fetched = tenantCredentials
          ? await adapter.fetchPayment(payment.provider_order_id, tenantCredentials)
          : await adapter.fetchPayment(payment.provider_order_id);
        if (fetched.status === 'PAID') {
          return withTenantContextRaw(payment.org_id, async (db) => {
            const { rows: lockedRows } = await db.query<{ id: string; status: string }>(
              `SELECT id, status FROM payments WHERE id = $1 AND org_id = $2 FOR UPDATE`,
              [payment.id, payment.org_id],
            );
            if (lockedRows[0]?.status === 'PAID') {
              return { success: true, paymentId: payment.id, status: 'PAID', settled: true };
            }

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
            await this.generateGstInvoiceInTx(db, payment.org_id, payment.order_id, payment.id);
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
        id: string;
        session_id: string;
        customer_id: string | null;
        session_customer_id: string | null;
        temp_customer_id?: string | null;
        session_temp_customer_id?: string | null;
      }>(
        `SELECT p.id, o.session_id, o.customer_id, ts.customer_id AS session_customer_id,
                o.temp_customer_id, ts.temp_customer_id AS session_temp_customer_id
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

  /**
   * Public gateway return check — requires the exact (orderId, merchantTransactionId) UUID pair
   * passed in PhonePe's redirectUrl, verifies with PhonePe/Razorpay S2S API, and returns only status.
   * Needed when PhonePe opens in a new tab (`target="_blank"`) or another device without sessionStorage.
   */
  async reconcilePublicReturn(orderId: string, merchantTransactionId: string) {
    const pool = getPool();
    const { rows } = await pool.query<{
      payment_id: string;
      org_id: string;
      status: string;
    }>(
      `SELECT payment_id, org_id, status FROM resolve_payment_by_tx_pair($1, $2)`,
      [orderId, merchantTransactionId],
    );
    const match = rows[0];
    if (!match) {
      throw domainError(ErrorCode.NOT_FOUND, 'Payment transaction not found.', 404);
    }

    const result = await this.verifyPaymentStatus(match.org_id, match.payment_id);
    return {
      success: result.success,
      status: result.status,
      settled: result.settled,
    };
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

