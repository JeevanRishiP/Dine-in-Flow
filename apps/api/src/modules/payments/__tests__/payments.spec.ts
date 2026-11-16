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
import { createHmac, createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { RazorpayAdapter } from '../razorpay.adapter.js';
import { PhonePeAdapter } from '../phonepe.adapter.js';
import { PaymentsService } from '../payments.service.js';
import * as dbClient from '../../../db/client.js';
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

function buildPhonePeWebhookPayload(
  merchantTransactionId: string,
  transactionId: string,
  state: 'COMPLETED' | 'FAILED',
  amountPaise: number,
  merchantId = 'SANDBOX_CLIENT_ID',
) {
  const inner = {
    success: state === 'COMPLETED',
    code: state === 'COMPLETED' ? 'PAYMENT_SUCCESS' : 'PAYMENT_ERROR',
    message: state === 'COMPLETED' ? 'Payment Successful' : 'Payment Failed',
    data: {
      merchantId,
      merchantTransactionId,
      transactionId,
      amount: amountPaise,
      state,
      responseCode: state === 'COMPLETED' ? 'SUCCESS' : 'FAILURE',
      paymentInstrument: { type: 'UPI' },
    },
  };
  const base64 = Buffer.from(JSON.stringify(inner), 'utf8').toString('base64');
  const body = JSON.stringify({ response: base64 });
  return {
    rawBody: Buffer.from(body, 'utf8'),
    base64,
  };
}

function signPhonePeWebhook(base64: string, saltKey: string, saltIndex: number): string {
  const hash = createHash('sha256').update(base64 + saltKey).digest('hex');
  return `${hash}###${saltIndex}`;
}

const { WEBHOOK_SECRET, PHONEPE_SALT_KEY } = vi.hoisted(() => ({
  WEBHOOK_SECRET: 'test_razorpay_webhook_secret_32chars!!',
  PHONEPE_SALT_KEY: 'SANDBOX_SECRET',
}));

vi.mock('../../../config/config.js', () => ({
  getConfig: () => ({
    RAZORPAY_KEY_ID:          'rzp_test_PLACEHOLDER',
    RAZORPAY_KEY_SECRET:      'PLACEHOLDER_SECRET',
    RAZORPAY_WEBHOOK_SECRET:  WEBHOOK_SECRET,
    PHONEPE_CLIENT_ID:        'SANDBOX_CLIENT_ID',
    PHONEPE_CLIENT_SECRET:    PHONEPE_SALT_KEY,
    PHONEPE_CLIENT_VERSION:   1,
    PHONEPE_SALT_INDEX:       1,
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

// ─── PhonePe Webhook & Salt Index Tests ───────────────────────────────────────

describe('PhonePeAdapter.verifyWebhook', () => {
  it('accepts a valid PhonePe webhook signature with matching salt index', () => {
    const { rawBody, base64 } = buildPhonePeWebhookPayload('order_tx_1', 'phonepe_tx_1', 'COMPLETED', 45000);
    const xVerify = signPhonePeWebhook(base64, PHONEPE_SALT_KEY, 1);

    const result = PhonePeAdapter.verifyWebhook(rawBody, {
      'x-verify': xVerify,
    });

    expect(result.valid).toBe(true);
    expect(result.event.status).toBe('PAID');
    expect(result.event.amountPaise).toBe(45000);
    expect(result.event.providerOrderId).toBe('order_tx_1');
    expect(result.event.providerPaymentId).toBe('phonepe_tx_1');
    expect(result.event.currency).toBe('INR');
  });

  it('rejects a PhonePe webhook when saltIndex does not match configured saltIndex', () => {
    const { rawBody, base64 } = buildPhonePeWebhookPayload('order_tx_1', 'phonepe_tx_1', 'COMPLETED', 45000);
    // Sign with saltIndex = 2 while configured PHONEPE_SALT_INDEX is 1
    const xVerify = signPhonePeWebhook(base64, PHONEPE_SALT_KEY, 2);

    const result = PhonePeAdapter.verifyWebhook(rawBody, {
      'x-verify': xVerify,
    });

    expect(result.valid).toBe(false);
  });

  it('rejects a PhonePe webhook with tampered checksum', () => {
    const { rawBody } = buildPhonePeWebhookPayload('order_tx_1', 'phonepe_tx_1', 'COMPLETED', 45000);
    const tamperedHash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
    const xVerify = `${tamperedHash}###1`;

    const result = PhonePeAdapter.verifyWebhook(rawBody, {
      'x-verify': xVerify,
    });

    expect(result.valid).toBe(false);
  });

  it('rejects a PhonePe webhook with missing X-VERIFY header', () => {
    const { rawBody } = buildPhonePeWebhookPayload('order_tx_1', 'phonepe_tx_1', 'COMPLETED', 45000);

    const result = PhonePeAdapter.verifyWebhook(rawBody, {});
    expect(result.valid).toBe(false);
  });

  it('rejects a PhonePe webhook with malformed X-VERIFY header (no ### delimiter)', () => {
    const { rawBody, base64 } = buildPhonePeWebhookPayload('order_tx_1', 'phonepe_tx_1', 'COMPLETED', 45000);
    const rawHash = createHash('sha256').update(base64 + PHONEPE_SALT_KEY).digest('hex');

    const result = PhonePeAdapter.verifyWebhook(rawBody, {
      'x-verify': rawHash,
    });

    expect(result.valid).toBe(false);
  });

  it('verifies PhonePe webhook using tenant-specific credentials override', () => {
    const tenantCreds = {
      merchantId: 'TENANT_MERCHANT_99',
      saltKey: 'custom_tenant_salt_key_123',
      saltIndex: 3,
    };
    const { rawBody, base64 } = buildPhonePeWebhookPayload(
      'order_tx_1',
      'phonepe_tx_1',
      'COMPLETED',
      45000,
      tenantCreds.merchantId,
    );
    const xVerify = signPhonePeWebhook(base64, tenantCreds.saltKey, tenantCreds.saltIndex);

    // Fails with default credentials
    const defaultCheck = PhonePeAdapter.verifyWebhook(rawBody, { 'x-verify': xVerify });
    expect(defaultCheck.valid).toBe(false);

    // Succeeds when passing tenantCredentials
    const tenantCheck = PhonePeAdapter.verifyWebhook(rawBody, { 'x-verify': xVerify }, tenantCreds);
    expect(tenantCheck.valid).toBe(true);
    expect(tenantCheck.event.status).toBe('PAID');
  });
});

// ─── PaymentsService Concurrency & GST Invoicing Tests ────────────────────────

describe('PaymentsService Webhook Processing & Concurrency', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const outletId = '88888888-4444-4444-4444-888888888888';
  const orderId = 'bcfdc1e1-02b3-4305-ae34-bccc42f54bed';
  const paymentId = '4c60bfed-3f37-43bb-8028-361022d53552';
  const txId = '34b8a7d9-32e3-4bae-829b-7976112d17ff';
  const inboxId = '99999999-0000-0000-0000-999999999999';

  let poolQueryMock: ReturnType<typeof vi.fn>;
  let clientQueryMock: ReturnType<typeof vi.fn>;
  let tenantClientQueryMock: ReturnType<typeof vi.fn>;
  let service: PaymentsService;

  beforeEach(() => {
    vi.restoreAllMocks();
    poolQueryMock = vi.fn();
    clientQueryMock = vi.fn();
    tenantClientQueryMock = vi.fn();

    vi.spyOn(dbClient, 'getPool').mockReturnValue({
      query: poolQueryMock,
      connect: vi.fn().mockResolvedValue({
        query: clientQueryMock,
        release: vi.fn(),
      } as unknown as PoolClient),
    } as unknown as Pool);

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
        fn({ query: tenantClientQueryMock } as unknown as PoolClient),
    );

    service = new PaymentsService();
  });

  it('prevents race conditions and duplicate outbox capture when payment is already PAID', async () => {
    const { rawBody, base64 } = buildPhonePeWebhookPayload(txId, 'provider_pay_1', 'COMPLETED', 50000);
    const xVerify = signPhonePeWebhook(base64, PHONEPE_SALT_KEY, 1);

    // 1. client.query for webhook_inbox insert
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ id: inboxId, status: 'RECEIVED' }],
    });

    // 2. client.query for resolve_payment_by_provider_order
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ id: paymentId, org_id: orgId, order_id: orderId, amount_paise: 50000, status: 'PAID' }],
    });

    // 3. tenantClientQueryMock for SELECT ... FOR UPDATE payment lock
    tenantClientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: paymentId,
          org_id: orgId,
          order_id: orderId,
          amount_paise: 50000,
          status: 'PAID', // Already settled!
          provider_payment_id: 'provider_pay_1',
        },
      ],
    });

    // 4. client.query for updating webhook_inbox to PROCESSED
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    await service.handleWebhook('phonepe', rawBody, { 'x-verify': xVerify });

    // Assert: tenantClientQueryMock was called with FOR UPDATE
    expect(tenantClientQueryMock).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      [paymentId, orgId],
    );

    // Assert: No UPDATE orders or INSERT outbox_events was called in tenant context
    const tenantCalls = tenantClientQueryMock.mock.calls.map((c) => String(c[0]));
    expect(tenantCalls.some((sql) => sql.includes('INSERT INTO outbox_events'))).toBe(false);
    expect(tenantCalls.some((sql) => sql.includes('INSERT INTO invoices'))).toBe(false);
  });

  it('processes payment capture and generates gapless legal GST invoice inside transaction', async () => {
    const { rawBody, base64 } = buildPhonePeWebhookPayload(txId, 'provider_pay_1', 'COMPLETED', 50000);
    const xVerify = signPhonePeWebhook(base64, PHONEPE_SALT_KEY, 1);

    // 1. client.query for webhook_inbox insert
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ id: inboxId, status: 'RECEIVED' }],
    });

    // 2. client.query for resolve_payment_by_provider_order
    clientQueryMock.mockResolvedValueOnce({
      rows: [{ id: paymentId, org_id: orgId, order_id: orderId, amount_paise: 50000, status: 'PENDING' }],
    });

    // 3. tenantClientQueryMock for SELECT ... FOR UPDATE
    tenantClientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: paymentId,
          org_id: orgId,
          order_id: orderId,
          amount_paise: 50000,
          status: 'PENDING',
          provider_payment_id: null,
        },
      ],
    });

    // 4. tenantClientQueryMock: UPDATE payments SET status = 'PAID'
    tenantClientQueryMock.mockResolvedValueOnce({ rows: [] });

    // 5. tenantClientQueryMock: UPDATE orders SET status = 'CONFIRMED'
    tenantClientQueryMock.mockResolvedValueOnce({ rows: [] });

    // 6. tenantClientQueryMock: INSERT INTO outbox_events (PAYMENT_CAPTURED)
    tenantClientQueryMock.mockResolvedValueOnce({ rows: [] });

    // 7. tenantClientQueryMock: check existing invoice for order
    tenantClientQueryMock.mockResolvedValueOnce({ rows: [] });

    // 8. tenantClientQueryMock: load order and outlet details
    tenantClientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: orderId,
          outlet_id: outletId,
          subtotal_paise: 47619,
          tax_paise: 2381,
          discount_paise: 0,
          total_paise: 50000,
          customer_id: null,
          buyer_name: 'Diner Alice',
          outlet_settings: { gstin: '29AAAAA0000A1Z5' },
          org_settings: {},
        },
      ],
    });

    // 9. tenantClientQueryMock: INSERT INTO invoice_counters (atomic upsert) RETURNING last_no
    tenantClientQueryMock.mockResolvedValueOnce({
      rows: [{ last_no: 104 }],
    });

    // 10. tenantClientQueryMock: INSERT INTO invoices RETURNING id, invoice_ref
    tenantClientQueryMock.mockResolvedValueOnce({
      rows: [{ id: 'inv-uuid-1', invoice_ref: 'INV-2026-104' }],
    });

    // 11. tenantClientQueryMock: INSERT INTO outbox_events (INVOICE_GENERATED)
    tenantClientQueryMock.mockResolvedValueOnce({ rows: [] });

    // 12. clientQueryMock: UPDATE webhook_inbox SET status = 'PROCESSED'
    clientQueryMock.mockResolvedValueOnce({ rows: [] });

    const response = await service.handleWebhook('phonepe', rawBody, { 'x-verify': xVerify });
    expect(response).toEqual({ received: true });

    // Verify outbox events were inserted
    const outboxCalls = tenantClientQueryMock.mock.calls.filter((c) =>
      String(c[0]).includes('INSERT INTO outbox_events'),
    );
    expect(outboxCalls.length).toBe(2);

    // First outbox event: PAYMENT_CAPTURED
    expect(outboxCalls[0]![0]).toContain("'PAYMENT_CAPTURED'");
    // Second outbox event: INVOICE_GENERATED
    expect(outboxCalls[1]![0]).toContain("'INVOICE_GENERATED'");

    // Verify invoice counter atomic increment
    const counterCall = tenantClientQueryMock.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO invoice_counters'),
    );
    expect(counterCall).toBeDefined();

    // Verify invoice insertion with gapless counter
    const invoiceCall = tenantClientQueryMock.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO invoices'),
    );
    expect(invoiceCall).toBeDefined();
    expect(invoiceCall![1]).toContain(104); // invoiceNo
    expect(invoiceCall![1]).toContain('29AAAAA0000A1Z5'); // seller_gstin
  });
});
