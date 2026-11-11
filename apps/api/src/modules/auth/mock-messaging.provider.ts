import { Injectable, Logger } from '@nestjs/common';
import type { MessagingProvider } from './messaging.provider.js';

/**
 * Mock SMS provider — logs OTP to console instead of sending SMS.
 * Used in development and tests. Never use in production.
 * Reference: ARCH §18
 */
@Injectable()
export class MockMessagingProvider implements MessagingProvider {
  private readonly logger = new Logger(MockMessagingProvider.name);

  async sendOtp(to: string, code: string, orgId: string): Promise<void> {
    this.logger.warn(
      { to, orgId },
      `[MOCK SMS] OTP for ${to}: ${code}  ← This is a mock. Set NODE_ENV=production to use a real provider.`,
    );
  }
}
