import type { TemplateCategory } from './template.registry.js';

export interface SendTemplateParams {
  to: string; // E.164 formatted phone number (e.g. +919876543210)
  templateName: string;
  category: TemplateCategory;
  language?: string;
  params: Record<string, string>;
  orgId: string;
  idempotencyKey?: string;
}

export interface SendResult {
  providerMessageId: string;
  provider: 'EVOLUTION' | 'META' | 'MOCK';
  status: 'SENT' | 'QUEUED' | 'FAILED';
  costMinorPaise: bigint;
  rawResponse?: unknown;
}

/**
 * Universal Messaging Provider interface.
 * Decouples application logic from Evolution API, Meta Cloud API, or local mocks.
 *
 * Reference: ARCH §20
 */
export interface MessagingProvider {
  readonly name: 'EVOLUTION' | 'META' | 'MOCK';

  /**
   * Sends a pre-approved template message to a customer phone number.
   */
  sendTemplate(params: SendTemplateParams): Promise<SendResult>;

  /**
   * Fast-path for authentication OTP verification messages.
   */
  sendOtp(to: string, code: string, orgId: string): Promise<SendResult>;
}

/**
 * SMS Provider interface for transactional fallback when WhatsApp is unavailable.
 */
export interface SmsProvider {
  readonly name: string;
  sendSms(to: string, message: string, dltTemplateId?: string): Promise<SendResult>;
}
