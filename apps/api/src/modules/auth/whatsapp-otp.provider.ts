import { Injectable, Logger } from '@nestjs/common';
import { getConfig } from '../../config/config.js';
import type { MessagingProvider } from './messaging.provider.js';

/**
 * Customer OTP WhatsApp / Dev Delivery Provider.
 *
 * Modes:
 * - 'meta': Official Meta WhatsApp Cloud API authentication template (production default).
 * - 'evolution_dev': Temporary local Docker Evolution API (NODE_ENV !== 'production' only,
 *   isolated container & instance per ADR 0002; never calls instance management APIs).
 * - 'mock': Dev/test console logging fallback.
 */
@Injectable()
export class WhatsAppOtpProvider implements MessagingProvider {
  private readonly logger = new Logger(WhatsAppOtpProvider.name);
  private readonly timeoutMs = 8_000;

  async sendOtp(to: string, code: string, orgId: string): Promise<void> {
    const config = getConfig();
    const provider = config.WHATSAPP_PROVIDER;

    if (provider === 'evolution_dev') {
      if (config.NODE_ENV === 'production') {
        throw new Error('evolution_dev OTP provider is forbidden in production.');
      }
      await this.sendViaEvolutionDev(to, code, orgId, config.EVOLUTION_API_URL, config.EVOLUTION_API_KEY, config.EVOLUTION_INSTANCE_NAME);
      return;
    }

    if (provider === 'meta') {
      await this.sendViaMetaCloud(to, code, orgId, config.WHATSAPP_PHONE_NUMBER_ID, config.WHATSAPP_ACCESS_TOKEN);
      return;
    }

    const maskedPhone = to.replace(/\d(?=\d{4})/g, '*');
    this.logger.log(`[DEV OTP] org=${orgId} to=${maskedPhone} code=${config.NODE_ENV === 'production' ? '[REDACTED]' : code}`);
  }

  private async sendViaEvolutionDev(
    to: string,
    code: string,
    orgId: string,
    baseUrl?: string,
    apiKey?: string,
    instanceName = 'dineflow_otp',
  ): Promise<void> {
    if (!baseUrl) {
      this.logger.warn(`[EVOLUTION-DEV OTP] EVOLUTION_API_URL not set; skipping remote send for org=${orgId}`);
      return;
    }

    const cleanBase = baseUrl.replace(/\/+$/, '');
    const digitsOnly = to.replace(/\D/g, '');
    const url = `${cleanBase}/message/sendText/${encodeURIComponent(instanceName)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { apikey: apiKey } : {}),
        },
        body: JSON.stringify({
          number: digitsOnly,
          text: `Your DineFlow verification OTP is *${code}*. It expires in 5 minutes. Do not share this code with anyone.`,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `[EVOLUTION-DEV OTP] Delivery returned ${res.status} for instance=${instanceName} org=${orgId}: ${body.slice(0, 160)}`,
        );
      } else {
        this.logger.log(`[EVOLUTION-DEV OTP] Delivered OTP via instance=${instanceName} for org=${orgId}`);
      }
    } catch (err) {
      this.logger.warn(
        `[EVOLUTION-DEV OTP] Could not reach Evolution at ${cleanBase} (${instanceName}): ${(err as Error).message}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async sendViaMetaCloud(
    to: string,
    code: string,
    orgId: string,
    phoneNumberId?: string,
    accessToken?: string,
  ): Promise<void> {
    if (!phoneNumberId || !accessToken) {
      this.logger.warn(`[META OTP] Missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN for org=${orgId}`);
      return;
    }

    const digitsOnly = to.replace(/\D/g, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: digitsOnly,
          type: 'template',
          template: {
            name: 'otp_code',
            language: { code: 'en' },
            components: [
              {
                type: 'body',
                parameters: [{ type: 'text', text: code }],
              },
            ],
          },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(`[META OTP] Cloud API error ${res.status} for org=${orgId}: ${body.slice(0, 160)}`);
      }
    } catch (err) {
      this.logger.warn(`[META OTP] Cloud API request failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

