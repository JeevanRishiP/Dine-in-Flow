/**
 * MessagingProvider — pluggable interface for OTP SMS delivery.
 * Production: swap in Twilio/MSG91/Exotel implementation via DI.
 * Reference: ARCH §18, AGENTS §2 rule 11 (no unofficial WhatsApp libs)
 */
export interface MessagingProvider {
  sendOtp(to: string, code: string, orgId: string): Promise<void>;
}

export const MESSAGING_PROVIDER = Symbol('MESSAGING_PROVIDER');
