import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { WhatsAppCloudAdapter, verifyMetaWebhookSignature } from '../whatsapp-cloud.adapter.js';
import { CustomerConsentController, WhatsAppWebhookController } from '../messaging.controller.js';

describe('WhatsAppCloudAdapter & Webhook Hardening (Slice 4)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('verifies Meta X-Hub-Signature-256 constant-time and rejects forged signatures', () => {
    const rawBody = Buffer.from('{"entry":[]}', 'utf8');
    const secret = 'meta-app-secret-value-12345';
    const sig = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');

    expect(verifyMetaWebhookSignature(rawBody, sig, secret)).toBe(true);
    expect(verifyMetaWebhookSignature(rawBody, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyMetaWebhookSignature(rawBody, undefined, secret)).toBe(false);
    expect(verifyMetaWebhookSignature(undefined, sig, secret)).toBe(false);
  });

  it('sends templated messages to official Meta Graph API endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.HBgLMTEyMw==' }] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const adapter = new WhatsAppCloudAdapter({
      phoneNumberId: '1234567890',
      accessToken: 'meta-access-token',
    });
    const res = await adapter.sendOtp('+919876543210', '654321', 'org-1');

    expect(res.provider).toBe('META');
    expect(res.status).toBe('SENT');
    expect(res.providerMessageId).toBe('wamid.HBgLMTEyMw==');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v21.0/1234567890/messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects customer consent modification for a mismatched phone number (403 FORBIDDEN)', () => {
    const controller = new CustomerConsentController({ recordConsent: vi.fn() } as never);
    expect(() =>
      controller.recordConsent(
        { sub: 'c1', org: 'org-1', phone: '+919876543210', type: 'customer_access' },
        {
          phone: '+919999999999',
          purpose: 'MARKETING_WHATSAPP',
          granted: false,
          source: 'WEB_CHECKOUT',
          noticeVersion: 'v1.0',
        },
      ),
    ).toThrowError(expect.objectContaining({ status: 403 }));
  });

  it('rejects unsigned POST webhook calls with 401 WEBHOOK_SIGNATURE_INVALID', () => {
    process.env['WHATSAPP_APP_SECRET'] = 'secret-for-test';
    const controller = new WhatsAppWebhookController({ handleInboundWebhook: vi.fn() } as never);
    expect(() =>
      controller.handleWebhook(
        { rawBody: Buffer.from('{}'), headers: {} } as never,
        {},
      ),
    ).toThrowError(expect.objectContaining({ status: 401, code: 'WEBHOOK_SIGNATURE_INVALID' }));
  });
});

