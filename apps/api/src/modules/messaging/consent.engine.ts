import type { TemplateCategory } from './template.registry.js';

const OPT_OUT_KEYWORDS = new Set([
  'STOP',
  'UNSUBSCRIBE',
  'CANCEL',
  'QUIT',
  'END',
  'STOPALL',
  'OPT-OUT',
  'OPTOUT',
]);

/**
 * Checks if an inbound WhatsApp message body is an opt-out command.
 * Reference: ARCH §20 ("honor STOP/unsubscribe immediately")
 */
export function isOptOutKeyword(messageBody: string): boolean {
  if (!messageBody) return false;
  const clean = messageBody.trim().toUpperCase();
  return OPT_OUT_KEYWORDS.has(clean);
}

/**
 * Checks whether the current time falls inside quiet hours.
 * Default: 21:00 IST to 09:00 IST (15:30 UTC to 03:30 UTC).
 *
 * Overnight window check:
 * If start > end (e.g., 15 to 3), quiet hours are active if hour >= start OR hour < end.
 */
export function isWithinQuietHours(
  date: Date,
  startHourUtc: number = 15,
  endHourUtc: number = 3,
): boolean {
  const currentHour = date.getUTCHours();
  if (startHourUtc > endHourUtc) {
    return currentHour >= startHourUtc || currentHour < endHourUtc;
  }
  return currentHour >= startHourUtc && currentHour < endHourUtc;
}

export interface ConsentEvaluationResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Pure rule engine for evaluating message send eligibility under DPDP consent,
 * quiet hours, and frequency capping rules.
 *
 * Rules (ARCH §20):
 *  - AUTHENTICATION: exempt from marketing consent and quiet hours.
 *  - UTILITY: transactional order/receipt/bill communication; exempt from quiet hours.
 *  - MARKETING: strictly requires explicit opt-in, blocked during quiet hours,
 *    and capped at 1 send per 7 days.
 */
export function evaluateMessageConsent(
  category: TemplateCategory,
  options: {
    consentGranted: boolean;
    inQuietHours: boolean;
    daysSinceLastMarketing: number | null;
  },
): ConsentEvaluationResult {
  if (category === 'AUTHENTICATION') {
    return { allowed: true };
  }

  if (category === 'UTILITY') {
    return { allowed: true };
  }

  if (category === 'MARKETING') {
    if (!options.consentGranted) {
      return {
        allowed: false,
        reason: 'Customer has not granted MARKETING_WHATSAPP consent.',
      };
    }

    if (options.inQuietHours) {
      return {
        allowed: false,
        reason: 'Marketing messages are prohibited during quiet hours (21:00 to 09:00).',
      };
    }

    if (
      options.daysSinceLastMarketing !== null &&
      options.daysSinceLastMarketing < 7
    ) {
      return {
        allowed: false,
        reason: `Frequency cap active: customer received a marketing message ${options.daysSinceLastMarketing.toFixed(1)} days ago (min 7 days required).`,
      };
    }

    return { allowed: true };
  }

  return { allowed: false, reason: `Unrecognized template category: ${category}` };
}
