import { Logger } from '@nestjs/common';
import crypto from 'node:crypto';
import type { MessagingProvider, SendTemplateParams, SendResult } from './messaging.provider.js';
import { TEMPLATE_REGISTRY, renderTemplateText } from './template.registry.js';
import { ESTIMATED_MESSAGE_COST_PAISE } from './budget.engine.js';

export interface WhatsAppCloudCredentials {
  phoneNumberId?: string;
  accessToken?: string;
  apiVersion?: string;
}

/**
 * Verifies Meta WhatsApp Cloud API X-Hub-Signature-256 header (`sha256=<hex>`)
 * using timing-safe comparison against the raw request body Buffer.
 */
export function verifyMetaWebhookSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | string[] | undefined,
  appSecret: string | undefined,
): boolean {
  if (!rawBody || !appSecret) return false;
  const headerVal = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!headerVal || !headerVal.startsWith('sha256=')) return false;

  const receivedHex = headerVal.slice(7).toLowerCase();
  if (!/^[0-9a-f]+$/.test(receivedHex)) return false;

  const expectedHex = crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'hex');
  const receivedBuf = Buffer.from(receivedHex, 'hex');
  return expectedBuf.length === receivedBuf.length && crypto.timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * Official Meta WhatsApp Cloud API Adapter (Graph API v21.0).
 * Replaces unofficial WhatsApp-Web bridges per AGENTS §2 rule 11 and ARCH §20.
 */
export class WhatsAppCloudAdapter implements MessagingProvider {
  readonly name = 'META' as const;
  private readonly logger = new Logger(WhatsAppCloudAdapter.name);
  private readonly defaultPhoneNumberId: string;
  private readonly defaultAccessToken: string;
  private readonly apiVersion: string;
  private readonly timeoutMs = 8000;

  constructor(creds?: WhatsAppCloudCredentials) {
    this.defaultPhoneNumberId = creds?.phoneNumberId || process.env['WHATSAPP_PHONE_NUMBER_ID'] || '';
    this.defaultAccessToken = creds?.accessToken || process.env['WHATSAPP_ACCESS_TOKEN'] || '';
    this.apiVersion = creds?.apiVersion || process.env['WHATSAPP_API_VERSION'] || 'v21.0';
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    const costPaise = ESTIMATED_MESSAGE_COST_PAISE[params.category] ?? 0n;
    const def = TEMPLATE_REGISTRY[params.templateName];
    if (!def) {
      return {
        providerMessageId: '',
        provider: 'META',
        status: 'FAILED',
        costMinorPaise: 0n,
        rawResponse: { error: `Unknown template ${params.templateName}` },
      };
    }

    if (!this.defaultPhoneNumberId || !this.defaultAccessToken) {
      this.logger.warn('[META-WA] WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN missing');
      return {
        providerMessageId: '',
        provider: 'META',
        status: 'FAILED',
        costMinorPaise: 0n,
        rawResponse: { error: 'WhatsApp Cloud API credentials not configured' },
      };
    }

    const toDigits = params.to.replace(/\D/g, '');
    const languageCode = params.language || 'en';
    const bodyParameters = Object.values(params.params).map((val) => ({
      type: 'text',
      text: String(val),
    }));

    const endpoint = `https://graph.facebook.com/${this.apiVersion}/${this.defaultPhoneNumberId}/messages`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.defaultAccessToken}`,
          ...(params.idempotencyKey ? { 'Idempotency-Key': params.idempotencyKey } : {}),
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: toDigits,
          type: 'template',
          template: {
            name: def.name,
            language: { code: languageCode },
            ...(bodyParameters.length > 0
              ? { components: [{ type: 'body', parameters: bodyParameters }] }
              : {}),
          },
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });

      const responseData = (await response.json().catch(() => ({}))) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string };
      };

      if (!response.ok) {
        this.logger.warn(`[META-WA] Send failed (${response.status}): ${JSON.stringify(responseData)}`);
        return {
          providerMessageId: '',
          provider: 'META',
          status: 'FAILED',
          costMinorPaise: 0n,
          rawResponse: responseData,
        };
      }

      const providerMsgId = responseData.messages?.[0]?.id || `wamid_${Date.now()}`;
      return {
        providerMessageId: providerMsgId,
        provider: 'META',
        status: 'SENT',
        costMinorPaise: costPaise,
        rawResponse: responseData,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[META-WA] Request failed for ${params.templateName}: ${message}`);
      return {
        providerMessageId: '',
        provider: 'META',
        status: 'FAILED',
        costMinorPaise: 0n,
        rawResponse: { error: message },
      };
    }
  }

  async sendOtp(to: string, code: string, orgId: string): Promise<SendResult> {
    const renderedPreview = renderTemplateText('auth_otp_v1', { code });
    this.logger.debug(`[META-WA] Dispatching OTP template for org=${orgId}: ${renderedPreview.slice(0, 20)}...`);
    return this.sendTemplate({
      to,
      templateName: 'auth_otp_v1',
      category: 'AUTHENTICATION',
      language: 'en',
      params: { code },
      orgId,
    });
  }
}

