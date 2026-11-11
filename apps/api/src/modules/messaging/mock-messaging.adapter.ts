import { Injectable } from '@nestjs/common';
import type {
  MessagingProvider,
  SendTemplateParams,
  SendResult,
  SmsProvider,
} from './messaging.provider.js';
import { ESTIMATED_MESSAGE_COST_PAISE } from './budget.engine.js';
import { renderTemplateText } from './template.registry.js';

export interface RecordedMessage {
  params: SendTemplateParams;
  renderedText: string;
  sentAt: Date;
}

@Injectable()
export class MockMessagingProvider implements MessagingProvider {
  readonly name = 'MOCK' as const;
  public readonly sentMessages: RecordedMessage[] = [];
  public shouldFail = false;

  async sendTemplate(params: SendTemplateParams): Promise<SendResult> {
    if (this.shouldFail) {
      return {
        providerMessageId: `mock-fail-${Date.now()}`,
        provider: 'MOCK',
        status: 'FAILED',
        costMinorPaise: 0n,
      };
    }

    const rendered = renderTemplateText(params.templateName, params.params, params.language);
    this.sentMessages.push({
      params,
      renderedText: rendered,
      sentAt: new Date(),
    });

    const cost = ESTIMATED_MESSAGE_COST_PAISE[params.category] ?? 15n;
    return {
      providerMessageId: `mock-msg-${this.sentMessages.length}-${Date.now()}`,
      provider: 'MOCK',
      status: 'SENT',
      costMinorPaise: cost,
    };
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

  reset() {
    this.sentMessages.length = 0;
    this.shouldFail = false;
  }
}

@Injectable()
export class MockSmsProvider implements SmsProvider {
  readonly name = 'MOCK_SMS';
  public readonly sentSms: Array<{ to: string; message: string; dltTemplateId?: string }> = [];

  async sendSms(to: string, message: string, dltTemplateId?: string): Promise<SendResult> {
    this.sentSms.push({ to, message, dltTemplateId });
    return {
      providerMessageId: `mock-sms-${Date.now()}`,
      provider: 'MOCK',
      status: 'SENT',
      costMinorPaise: 20n, // ₹0.20 per SMS
    };
  }
}
