/**
 * PhonePe Payment Gateway Adapter — UPI payments (UPI intent, UPI QR, collect).
 *
 * Routes: all UPI and UPI_INTENT payment methods (user spec).
 * Mode:   Sandbox (https://api-preprod.phonepe.com/apis/pg-sandbox) by default in dev;
 *         PRODUCTION (https://api.phonepe.com/apis/hermes) via PHONEPE_ENV.
 *
 * Key design decisions:
 *  - createPayment: initiates a Standard Checkout transaction on PhonePe PG API;
 *    returns the real hosted PhonePe Simulator / Checkout URL as checkoutPayload.redirectUrl.
 *  - verifyWebhook: validates X-VERIFY checksum on the raw body; decodes base64 payload.
 *  - fetchPayment: queries PhonePe order status check API for real-time reconciliation.
 *  - refund: PhonePe refund API with idempotencyKey.
 *
 * Reference: ARCH §11 (PaymentProvider interface), AGENTS §2 rule 9
 */

import crypto from 'node:crypto';
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

const logger = new Logger('PhonePeAdapter');

// Map PhonePe state strings → our normalized status
const STATE_MAP: Record<string, 'PENDING' | 'PAID' | 'FAILED'> = {
  PENDING:   'PENDING',
  COMPLETED: 'PAID',
  SUCCESS:   'PAID',
  PAYMENT_SUCCESS: 'PAID',
  FAILED:    'FAILED',
  EXPIRED:   'FAILED',
  CANCELLED: 'FAILED',
};

function getPhonePeBaseUrl(): string {
  const cfg = getConfig();
  return cfg.PHONEPE_ENV === 'PRODUCTION'
    ? 'https://api.phonepe.com/apis/hermes'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

function getCredentials() {
  const cfg = getConfig();
  const merchantId = cfg.PHONEPE_CLIENT_ID || 'PGTESTPAYUAT86';
  const saltKey = cfg.PHONEPE_CLIENT_SECRET || '96434309-7796-489d-8924-ab56988a6076';
  const saltIndex = cfg.PHONEPE_CLIENT_VERSION || 1;
  return { merchantId, saltKey, saltIndex };
}

export const PhonePeAdapter: PaymentProvider = {
  name: 'phonepe',

  // ─── Create Payment ─────────────────────────────────────────────────────────

  async createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult> {
    const cfg = getConfig();
    const { merchantId, saltKey, saltIndex } = getCredentials();
    const baseUrl = getPhonePeBaseUrl();

    // Use idempotencyKey as merchantTransactionId (stable, unique per payment attempt)
    const merchantOrderId = input.idempotencyKey;
    const returnUrl = `${cfg.APP_BASE_URL}/payment/phonepe/return?orderId=${input.orderId}&merchantTransactionId=${merchantOrderId}`;
    const webhookBase = cfg.WEBHOOK_PUBLIC_URL || cfg.APP_BASE_URL;
    const callbackUrl = `${webhookBase}/v1/webhooks/phonepe`;

    const payload = {
      merchantId,
      merchantTransactionId: merchantOrderId,
      merchantUserId: `CUST_${input.orderId.replace(/-/g, '').slice(0, 16)}`,
      amount: input.amountPaise, // PhonePe accepts integer paise
      redirectUrl: returnUrl,
      redirectMode: 'REDIRECT',
      callbackUrl,
      paymentInstrument: {
        type: 'PAY_PAGE',
      },
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const stringToHash = base64Payload + '/pg/v1/pay' + saltKey;
    const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
    const xVerify = `${sha256}###${saltIndex}`;

    logger.log(`Initiating PhonePe payment: merchantTransactionId=${merchantOrderId} amount=${input.amountPaise} paise`);

    const res = await fetch(`${baseUrl}/pg/v1/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify,
        'accept': 'application/json',
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    const json = (await res.json()) as {
      success: boolean;
      code?: string;
      message?: string;
      data?: {
        instrumentResponse?: {
          redirectInfo?: {
            url?: string;
          };
        };
      };
    };

    if (!json.success || !json.data?.instrumentResponse?.redirectInfo?.url) {
      const errMsg = json.message || json.code || JSON.stringify(json);
      logger.error(`PhonePe initiate payment failed: ${errMsg}`);
      throw new Error(`PhonePe initiate payment failed: ${errMsg}`);
    }

    const redirectUrl = json.data.instrumentResponse.redirectInfo.url;
    logger.log(`PhonePe Sandbox payment URL generated: ${redirectUrl}`);

    return {
      providerOrderId: merchantOrderId,
      checkoutPayload: {
        provider: 'phonepe',
        method: 'UPI',
        redirectUrl,
        merchantOrderId,
      },
    };
  },

  // ─── Verify Webhook ─────────────────────────────────────────────────────────

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): { valid: boolean; eventId: string; event: NormalizedEvent } {
    const { saltKey } = getCredentials();

    const xVerifyHeader = headers['x-verify'] ?? headers['X-VERIFY'];
    const xVerify = Array.isArray(xVerifyHeader) ? xVerifyHeader[0] : xVerifyHeader;

    if (!xVerify) {
      logger.warn('PhonePe webhook missing X-VERIFY header');
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    let parsedBody: { response?: string };
    try {
      parsedBody = JSON.parse(rawBody.toString('utf8'));
    } catch {
      logger.warn('PhonePe webhook body is not valid JSON');
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    const responseB64 = parsedBody.response;
    if (!responseB64) {
      logger.warn('PhonePe webhook body missing "response" base64 field');
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    // Verify SHA256 checksum: sha256(responseB64 + saltKey) + '###' + saltIndex
    const expectedHash = crypto
      .createHash('sha256')
      .update(responseB64 + saltKey)
      .digest('hex');
    const receivedHash = xVerify.split('###')[0];

    if (expectedHash !== receivedHash) {
      logger.warn('PhonePe webhook signature mismatch');
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    // Decode and parse payload
    let decodedJson: {
      success?: boolean;
      code?: string;
      data?: {
        merchantTransactionId?: string;
        transactionId?: string;
        amount?: number;
        state?: string;
      };
    };
    try {
      decodedJson = JSON.parse(Buffer.from(responseB64, 'base64').toString('utf8'));
    } catch {
      logger.warn('PhonePe webhook decoded payload is not valid JSON');
      return { valid: false, eventId: '', event: buildEmptyEvent() };
    }

    const data = decodedJson.data || {};
    const merchantTransactionId = data.merchantTransactionId || '';
    const state = data.state || decodedJson.code || 'PENDING';
    const amount = typeof data.amount === 'number' ? data.amount : 0;

    const normalizedEvent: NormalizedEvent = {
      eventId: merchantTransactionId,
      providerOrderId: merchantTransactionId,
      status: STATE_MAP[state] ?? 'PENDING',
      amountPaise: amount,
      currency: 'INR',
      method: 'UPI',
      raw: decodedJson,
    };

    logger.log(`PhonePe webhook verified: orderId=${merchantTransactionId} status=${normalizedEvent.status}`);
    return { valid: true, eventId: merchantTransactionId, event: normalizedEvent };
  },

  // ─── Fetch Payment (Reconciliation) ─────────────────────────────────────────

  async fetchPayment(providerOrderId: string): Promise<NormalizedPayment> {
    const { merchantId, saltKey, saltIndex } = getCredentials();
    const baseUrl = getPhonePeBaseUrl();

    const path = `/pg/v1/status/${merchantId}/${providerOrderId}`;
    const stringToHash = path + saltKey;
    const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
    const xVerify = `${sha256}###${saltIndex}`;

    logger.log(`Querying PhonePe payment status: ${providerOrderId}`);

    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify,
        'X-MERCHANT-ID': merchantId,
        'accept': 'application/json',
      },
    });

    if (res.status === 204 || !res.ok) {
      logger.warn(`PhonePe status returned HTTP ${res.status} for ${providerOrderId}`);
      return {
        providerOrderId,
        status: 'PENDING',
        amountPaise: 0,
        currency: 'INR',
      };
    }

    let json: {
      success?: boolean;
      code?: string;
      data?: {
        state?: string;
        amount?: number;
      };
    };
    try {
      json = (await res.json()) as any;
    } catch {
      return {
        providerOrderId,
        status: 'PENDING',
        amountPaise: 0,
        currency: 'INR',
      };
    }

    const data = json.data || {};
    const state = data.state || json.code || 'PENDING';
    const amount = typeof data.amount === 'number' ? data.amount : 0;

    logger.log(`PhonePe status for ${providerOrderId}: state=${state}`);

    return {
      providerOrderId,
      status: STATE_MAP[state] ?? 'PENDING',
      amountPaise: amount,
      currency: 'INR',
    };
  },

  // ─── Refund ─────────────────────────────────────────────────────────────────

  async refund(input: RefundInput): Promise<NormalizedRefund> {
    const { merchantId, saltKey, saltIndex } = getCredentials();
    const baseUrl = getPhonePeBaseUrl();

    const refundTransactionId = input.idempotencyKey;
    const payload = {
      merchantId,
      merchantUserId: 'CUST_REFUND',
      originalTransactionId: input.providerPaymentId,
      merchantTransactionId: refundTransactionId,
      amount: input.amountPaise,
      callbackUrl: `${getConfig().WEBHOOK_PUBLIC_URL || getConfig().APP_BASE_URL}/v1/webhooks/phonepe`,
    };

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64');
    const stringToHash = base64Payload + '/pg/v1/refund' + saltKey;
    const sha256 = crypto.createHash('sha256').update(stringToHash).digest('hex');
    const xVerify = `${sha256}###${saltIndex}`;

    const res = await fetch(`${baseUrl}/pg/v1/refund`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': xVerify,
        'accept': 'application/json',
      },
      body: JSON.stringify({ request: base64Payload }),
    });

    const json = (await res.json()) as {
      success?: boolean;
      data?: { state?: string };
    };

    const isSuccess = json.success && json.data?.state === 'COMPLETED';

    return {
      providerRefundId: refundTransactionId,
      status: isSuccess ? 'SUCCEEDED' : 'PENDING',
      amountPaise: input.amountPaise,
    };
  },
};

function buildEmptyEvent(): NormalizedEvent {
  return {
    eventId: '',
    providerOrderId: '',
    status: 'FAILED',
    amountPaise: 0,
    currency: 'INR',
    raw: null,
  };
}
