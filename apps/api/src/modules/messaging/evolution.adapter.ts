import { Injectable, Logger } from '@nestjs/common';
import type {
  MessagingProvider,
  SendTemplateParams,
  SendResult,
} from './messaging.provider.js';
import { renderTemplateText } from './template.registry.js';
import { ESTIMATED_MESSAGE_COST_PAISE } from './budget.engine.js';

export interface EvolutionAdapterConfig {
  baseUrl?: string;
  apiKey?: string;
  instanceName?: string;
}

/**
 * Evolution API WhatsApp Adapter
 *
 * Connects to a running Evolution API Docker instance.
 *
 * CRITICAL SAFETY INVARIANTS:
 *  - Scoped strictly to the configured instanceName (default: 'dineflow').
 *  - NEVER calls instance management APIs (delete/create/logout/restart) to prevent
 *    affecting other active projects sharing the Evolution Docker container.
 *  - All requests use an explicit timeout (8s) to prevent hanging.
 */
@Injectable()
export class EvolutionAdapter implements MessagingProvider {
  readonly name = 'EVOLUTION' as const;
  private readonly logger = new Logger(EvolutionAdapter.name);

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly instanceName: string;

  constructor(config?: EvolutionAdapterConfig) {
    this.baseUrl = (
      config?.baseUrl ||
      process.env['EVOLUTION_API_URL'] ||
      'http://localhost:8080'
    ).replace(/\/$/, '');
    this.apiKey =
      config?.apiKey ||
      process.env['EVOLUTION_API_KEY'] ||
      '';
    this.instanceName =
      config?.instanceName ||
      process.env['EVOLUTION_INSTANCE_NAME'] ||
      'dineflow';
  }

  /**
   * Cleans an E.164 phone number into the numeric format expected by Evolution API (e.g. 919876543210).
   */
  private cleanPhoneNumber(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    const renderedText = renderTemplateText(
      params.templateName,
      params.params,
      params.language || 'en',
    );
    const cleanedPhone = this.cleanPhoneNumber(params.to);

    const cost = ESTIMATED_MESSAGE_COST_PAISE[params.category] ?? 15n;
    const url = `${this.baseUrl}/message/sendText/${encodeURIComponent(this.instanceName)}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { apikey: this.apiKey } : {}),
        },
        body: JSON.stringify({
          number: cleanedPhone,
          text: renderedText,
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(
          `[EVOLUTION] Send failed (HTTP ${response.status}) on instance '${this.instanceName}': ${errorText}`,
        );
        return {
          providerMessageId: `failed-${Date.now()}`,
          provider: 'EVOLUTION',
          status: 'FAILED',
          costMinorPaise: 0n,
          rawResponse: { status: response.status, error: errorText },
        };
      }

      const json = await response.json().catch(() => ({}));
      const messageId =
        (json as any)?.key?.id ||
        (json as any)?.messageId ||
        `evo-${Date.now()}`;

      this.logger.log(
        `[EVOLUTION] Message sent successfully to ${params.to} (id: ${messageId}) via instance '${this.instanceName}'`,
      );

      return {
        providerMessageId: messageId,
        provider: 'EVOLUTION',
        status: 'SENT',
        costMinorPaise: cost,
        rawResponse: json,
      };
    } catch (err: any) {
      this.logger.warn(
        `[EVOLUTION] Network / connection error sending to ${params.to} on instance '${this.instanceName}': ${err.message}`,
      );
      return {
        providerMessageId: `err-${Date.now()}`,
        provider: 'EVOLUTION',
        status: 'FAILED',
        costMinorPaise: 0n,
        rawResponse: { error: err.message },
      };
    }
  }

  async sendOtp(to: string, code: string, orgId: string): Promise<SendResult> {
    return this.sendTemplate({
      to,
      templateName: 'auth_otp_v1',
      category: 'AUTHENTICATION',
      params: { code },
      orgId,
    });
  }
}
