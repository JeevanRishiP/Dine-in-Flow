/**
 * Razorpay Payment Gateway Adapter — Card, NetBanking, Wallet payments.
 *
 * Routes: CARD, NETBANKING, WALLET payment methods (user spec).
 * SDK:    razorpay (official npm package)
 * Mode:   Sandbox (rzp_test_* key) by default; PRODUCTION via RAZORPAY_KEY_ID starting with rzp_live_
 *
 * Key design decisions:
 *  - createPayment: creates a Razorpay Order; returns orderId + key_id for
 *    the client-side Razorpay Checkout JS to open the payment modal.
 *  - verifyWebhook: validates HMAC-SHA256 signature on raw body (AGENTS §2 rule 9).
 *    Uses `razorpay.webhooks.constructEvent` pattern (verify via crypto directly
 *    since razorpay SDK exposes Utils.verifyWebhookSignature).
 *  - fetchPayment: uses razorpay.orders.fetchPayments() for reconciliation.
 *  - refund: razorpay.payments.refund() with idempotency_key forwarded.
 *
 * NEEDS_HUMAN_REVIEW: Razorpay sandbox credentials, webhook secret
 * Reference: ARCH §11 (PaymentProvider interface), AGENTS §2 rule 9
 */

import Razorpay from 'razorpay';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { getConfig } from '../../config/config.js';
import type {
  PaymentProvider,
  CreatePaymentInput,
  CreatePaymentResult,
  NormalizedEvent,
  NormalizedPayment,
  NormalizedRefund,
  RefundInput,
} from './payment-provider.interface.js';

const logger = new Logger('RazorpayAdapter');

// Map Razorpay payment status → our normalized status
const STATUS_MAP: Record<string, 'PENDING' | 'PAID' | 'FAILED'> = {
  created:    'PENDING',
  authorized: 'PENDING',
  captured:   'PAID',
  refunded:   'PAID',     // still PAID at the payment level; refund recorded separately
  failed:     'FAILED',
};

const ORDER_STATUS_MAP: Record<string, 'PENDING' | 'PAID' | 'FAILED'> = {
  created:   'PENDING',
  attempted: 'PENDING',
  paid:      'PAID',
};

function getClient(): Razorpay {
  const cfg = getConfig();
  return new Razorpay({
    key_id:     cfg.RAZORPAY_KEY_ID!,
    key_secret: cfg.RAZORPAY_KEY_SECRET!,
  });
}

export const RazorpayAdapter: PaymentProvider = {
  name: 'razorpay',

  // ─── Create Payment ─────────────────────────────────────────────────────────

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const rzp = getClient();
    const cfg = getConfig();

    // Receipt = idempotency key (unique per payment attempt, stable for retries)
    const receipt = input.idempotencyKey.replace(/-/g, '').slice(0, 40); // Razorpay: max 40 chars
    const returnUrl = `${cfg.APP_BASE_URL}/payment/razorpay/return?orderId=${input.orderId}`;

    const order = await rzp.orders.create({
      amount:          input.amountPaise,   // integer paise — Razorpay uses smallest currency unit
      currency:        input.currency,
      receipt,
      notes: {
        orderId:  input.orderId,
        method:   input.method,
        ...input.notes,
      },
    });

    const orderId = order.id as string;
    logger.log(`Created Razorpay order: ${orderId} amount=${input.amountPaise}`);

    return {
      providerOrderId: orderId,
      checkoutPayload: {
        provider:        'razorpay',
        method:          input.method,
        key:             cfg.RAZORPAY_KEY_ID!,   // public key for client-side Checkout JS
        order_id:        orderId,
        amount:          input.amountPaise,
        currency:        input.currency,
        callback_url:    returnUrl,
        name:            'DineFlow Restaurant',
        prefill: {
          contact: input.customerPhone ?? '',
          name:    input.customerName ?? '',
        },
      },
    };
  },

  // ─── Verify Webhook ─────────────────────────────────────────────────────────
  // Razorpay signs webhooks with HMAC-SHA256 of the raw body using the webhook secret.
  // Header: X-Razorpay-Signature
  // Reference: https://razorpay.com/docs/webhooks/validate-test/

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; eventId: string; event: NormalizedEvent } {
    const cfg = getConfig();
    const sigHeader = headers['x-razorpay-signature'];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;

    if (!sig) {
      logger.warn('Razorpay webhook missing X-Razorpay-Signature');
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    // Compute expected HMAC
    const expected = createHmac('sha256', cfg.RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    let valid = false;
    try {
      valid = timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(sig, 'hex'),
      );
    } catch {
      valid = false;
    }

    if (!valid) {
      logger.warn('Razorpay webhook signature mismatch');
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as Record<string, unknown>;
    } catch {
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    // Extract event data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Razorpay webhook nested payload: fully untyped
    const payloadRaw = (body['payload'] as any) ?? {};
    const paymentEntity = (payloadRaw['payment']?.['entity'] ?? {}) as Record<string, unknown>;
    const orderEntity   = (payloadRaw['order']?.['entity']   ?? {}) as Record<string, unknown>;
    const eventId       = `${body['event'] as string}:${(paymentEntity['id'] as string | undefined) ?? ''}`;

    const rzpStatus = (paymentEntity['status'] as string) ?? 'created';
    const amount    = typeof paymentEntity['amount'] === 'number' ? paymentEntity['amount'] as number : 0;

    const event: NormalizedEvent = {
      eventId,
      providerOrderId:   (paymentEntity['order_id'] as string) ?? (orderEntity['id'] as string) ?? '',
      providerPaymentId: paymentEntity['id'] as string | undefined,
      status:            STATUS_MAP[rzpStatus] ?? 'PENDING',
      amountPaise:       amount,
      currency:          (paymentEntity['currency'] as string) ?? 'INR',
      method:            paymentEntity['method'] as string | undefined,
      feePaise:          typeof paymentEntity['fee'] === 'number' ? paymentEntity['fee'] as number : undefined,
      raw:               body,
    };

    return { valid: true, eventId, event };
  },

  // ─── Fetch Payment (Reconciliation) ─────────────────────────────────────────

  async fetchPayment(providerOrderId: string): Promise<NormalizedPayment> {
    const rzp = getClient();
    const order = await rzp.orders.fetch(providerOrderId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Razorpay SDK return type not fully typed
    const o = (order as unknown) as Record<string, unknown>;

    const status = ORDER_STATUS_MAP[(o['status'] as string) ?? 'created'] ?? 'PENDING';
    const amount = typeof o['amount'] === 'number' ? o['amount'] as number : 0;

    return {
      providerOrderId,
      status,
      amountPaise: amount,
      currency:    (o['currency'] as string) ?? 'INR',
    };
  },

  // ─── Refund ─────────────────────────────────────────────────────────────────

  async refund(input: RefundInput): Promise<NormalizedRefund> {
    const rzp = getClient();

    const refund = await rzp.payments.refund(input.providerPaymentId, {
      amount: input.amountPaise,
      notes:  { reason: input.reason, idempotencyKey: input.idempotencyKey },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Razorpay SDK return type not fully typed
    const r = (refund as unknown) as Record<string, unknown>;

    const rzpStatus = (r['status'] as string) ?? 'pending';
    const refundStatusMap: Record<string, NormalizedRefund['status']> = {
      pending:    'PENDING',
      processing: 'PROCESSING',
      processed:  'SUCCEEDED',
      failed:     'FAILED',
    };

    return {
      providerRefundId: r['id'] as string,
      status:           refundStatusMap[rzpStatus] ?? 'PENDING',
      amountPaise:      typeof r['amount'] === 'number' ? r['amount'] as number : input.amountPaise,
    };
  },
};

function buildEmptyEvent(): NormalizedEvent {
  return {
    eventId:         '',
    providerOrderId: '',
    status:          'FAILED',
    amountPaise:     0,
    currency:        'INR',
    raw:             null,
  };
}
