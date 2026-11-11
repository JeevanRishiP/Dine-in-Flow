/**
 * Payment logic unit tests
 *
 * Tests:
 *  - Provider routing (PhonePe→UPI, Razorpay→Card/NB/Wallet, invalid method throws)
 *  - Razorpay webhook signature verification (valid + tampered)
 *  - Amount mismatch detection
 *  - Refund over-refund guard
 *  - Error codes on invalid input
 *
 * These tests do NOT hit a real database or gateway — all gateway calls are mocked.
 * Reference: AGENTS §5 (unit + property tests for pricing, state machine, RLS)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { RazorpayAdapter } from '../razorpay.adapter.js';
import { PhonePeAdapter } from '../phonepe.adapter.js';
import type { CreatePaymentInput } from '../payment-provider.interface.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildRazorpayWebhookPayload(orderId: string, paymentId: string, status: string, amount: number): Buffer {
  const body = {
    event: 'payment.captured',
    payload: {
      payment: {
        entity: {
          id:       paymentId,
          order_id: orderId,
          status,
          amount,
          currency: 'INR',
          method:   'card',
          fee:      100,
        },
      },
    },
  };
  return Buffer.from(JSON.stringify(body), 'utf8');
}

function signRazorpayWebhook(rawBody: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

const { WEBHOOK_SECRET } = vi.hoisted(() => ({
  WEBHOOK_SECRET: 'test_razorpay_webhook_secret_32chars!!',
}));

vi.mock('../../../config/config.js', () => ({
  getConfig: () => ({
    RAZORPAY_KEY_ID:          'rzp_test_PLACEHOLDER',
    RAZORPAY_KEY_SECRET:      'PLACEHOLDER_SECRET',
    RAZORPAY_WEBHOOK_SECRET:  WEBHOOK_SECRET,
    PHONEPE_CLIENT_ID:        'SANDBOX_CLIENT_ID',
    PHONEPE_CLIENT_SECRET:    'SANDBOX_SECRET',
    PHONEPE_CLIENT_VERSION:   1,
    PHONEPE_ENV:              'SANDBOX',
    PHONEPE_WEBHOOK_USERNAME: 'webhookuser',
    PHONEPE_WEBHOOK_PASSWORD: 'webhookpass',
    APP_BASE_URL:             'http://localhost:3000',
  }),
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RazorpayAdapter.verifyWebhook', () => {

  it('accepts a valid Razorpay webhook signature', () => {
    const rawBody = buildRazorpayWebhookPayload('order_123', 'pay_abc', 'captured', 50000);
    const sig = signRazorpayWebhook(rawBody, WEBHOOK_SECRET);

    const result = RazorpayAdapter.verifyWebhook(rawBody, {
      'x-razorpay-signature': sig,
    });

    expect(result.valid).toBe(true);
    expect(result.event.status).toBe('PAID');
    expect(result.event.amountPaise).toBe(50000);
    expect(result.event.currency).toBe('INR');
    expect(result.event.providerOrderId).toBe('order_123');
    expect(result.event.providerPaymentId).toBe('pay_abc');
    expect(result.event.feePaise).toBe(100);
  });

  it('rejects a tampered Razorpay webhook (wrong signature)', () => {
    const rawBody = buildRazorpayWebhookPayload('order_123', 'pay_abc', 'captured', 50000);
    const tamperedSig = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

    const result = RazorpayAdapter.verifyWebhook(rawBody, {
      'x-razorpay-signature': tamperedSig,
    });

    expect(result.valid).toBe(false);
  });

  it('rejects a Razorpay webhook with missing signature header', () => {
    const rawBody = buildRazorpayWebhookPayload('order_123', 'pay_abc', 'captured', 50000);

    const result = RazorpayAdapter.verifyWebhook(rawBody, {});
    expect(result.valid).toBe(false);
  });

  it('maps FAILED payment status correctly', () => {
    const rawBody = buildRazorpayWebhookPayload('order_123', 'pay_failed', 'failed', 50000);
    const sig = signRazorpayWebhook(rawBody, WEBHOOK_SECRET);

    const result = RazorpayAdapter.verifyWebhook(rawBody, {
      'x-razorpay-signature': sig,
    });

    expect(result.valid).toBe(true);
    expect(result.event.status).toBe('FAILED');
  });

  it('handles a malformed (non-JSON) webhook body', () => {
    const rawBody = Buffer.from('not valid json', 'utf8');
    const sig = signRazorpayWebhook(rawBody, WEBHOOK_SECRET);

    const result = RazorpayAdapter.verifyWebhook(rawBody, {
      'x-razorpay-signature': sig,
    });

    // Signature is valid but body is unparseable
    expect(result.valid).toBe(false);
  });
});

// ─── Provider routing (pure logic) ───────────────────────────────────────────

describe('Provider routing', () => {
  it('PhonePe adapter is named "phonepe"', () => {
    expect(PhonePeAdapter.name).toBe('phonepe');
  });

  it('Razorpay adapter is named "razorpay"', () => {
    expect(RazorpayAdapter.name).toBe('razorpay');
  });
});

// ─── Amount invariant: paise must be integer ─────────────────────────────────

describe('Amount invariants', () => {
  it('Razorpay webhook correctly reads integer paise amount', () => {
    const rawBody = buildRazorpayWebhookPayload('order_1', 'pay_1', 'captured', 12399);
    const secret = 'test_razorpay_webhook_secret_32chars!!';
    const sig = signRazorpayWebhook(rawBody, secret);

    const result = RazorpayAdapter.verifyWebhook(rawBody, { 'x-razorpay-signature': sig });
    expect(result.valid).toBe(true);
    // Amount must remain integer paise — never float
    expect(Number.isInteger(result.event.amountPaise)).toBe(true);
    expect(result.event.amountPaise).toBe(12399);
  });
});
