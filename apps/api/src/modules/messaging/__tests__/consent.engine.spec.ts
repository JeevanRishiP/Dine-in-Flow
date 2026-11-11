import { describe, it, expect } from 'vitest';
import {
  isOptOutKeyword,
  isWithinQuietHours,
  evaluateMessageConsent,
} from '../consent.engine.js';

describe('Consent & Quiet Hours Engine (Phase 9)', () => {
  describe('Inbound Opt-out Detection', () => {
    it('recognizes STOP, UNSUBSCRIBE, CANCEL, QUIT, and END keywords', () => {
      expect(isOptOutKeyword('STOP')).toBe(true);
      expect(isOptOutKeyword('stop')).toBe(true);
      expect(isOptOutKeyword('  UNSUBSCRIBE  ')).toBe(true);
      expect(isOptOutKeyword('cancel')).toBe(true);
      expect(isOptOutKeyword('QUIT')).toBe(true);
      expect(isOptOutKeyword('end')).toBe(true);
    });

    it('rejects regular conversational text', () => {
      expect(isOptOutKeyword('Hello')).toBe(false);
      expect(isOptOutKeyword('Please stop the noise')).toBe(false);
      expect(isOptOutKeyword('Thank you for the food')).toBe(false);
      expect(isOptOutKeyword('')).toBe(false);
    });
  });

  describe('Quiet Hours (21:00 to 09:00 IST / 15:30 to 03:30 UTC)', () => {
    it('correctly identifies night hours as quiet hours (UTC 16 = 21:30 IST)', () => {
      const nightDate = new Date('2026-10-26T16:00:00Z');
      expect(isWithinQuietHours(nightDate, 15, 3)).toBe(true);

      const midnightDate = new Date('2026-10-26T20:00:00Z');
      expect(isWithinQuietHours(midnightDate, 15, 3)).toBe(true);

      const earlyMorningDate = new Date('2026-10-26T02:00:00Z');
      expect(isWithinQuietHours(earlyMorningDate, 15, 3)).toBe(true);
    });

    it('allows daytime hours outside quiet hours (UTC 06 = 11:30 IST)', () => {
      const daytimeDate = new Date('2026-10-26T06:00:00Z');
      expect(isWithinQuietHours(daytimeDate, 15, 3)).toBe(false);

      const afternoonDate = new Date('2026-10-26T10:00:00Z');
      expect(isWithinQuietHours(afternoonDate, 15, 3)).toBe(false);
    });
  });

  describe('Message Consent Evaluation', () => {
    it('always allows AUTHENTICATION and UTILITY messages even without marketing consent', () => {
      const authRes = evaluateMessageConsent('AUTHENTICATION', {
        consentGranted: false,
        inQuietHours: true,
        daysSinceLastMarketing: 0,
      });
      expect(authRes.allowed).toBe(true);

      const utilityRes = evaluateMessageConsent('UTILITY', {
        consentGranted: false,
        inQuietHours: true,
        daysSinceLastMarketing: 0,
      });
      expect(utilityRes.allowed).toBe(true);
    });

    it('blocks MARKETING messages if consent is not granted', () => {
      const mktRes = evaluateMessageConsent('MARKETING', {
        consentGranted: false,
        inQuietHours: false,
        daysSinceLastMarketing: 14,
      });
      expect(mktRes.allowed).toBe(false);
      expect(mktRes.reason).toContain('not granted');
    });

    it('blocks MARKETING messages during quiet hours', () => {
      const mktRes = evaluateMessageConsent('MARKETING', {
        consentGranted: true,
        inQuietHours: true,
        daysSinceLastMarketing: 14,
      });
      expect(mktRes.allowed).toBe(false);
      expect(mktRes.reason).toContain('quiet hours');
    });

    it('blocks MARKETING messages if sent within 7 days of previous marketing message', () => {
      const mktRes = evaluateMessageConsent('MARKETING', {
        consentGranted: true,
        inQuietHours: false,
        daysSinceLastMarketing: 3.5,
      });
      expect(mktRes.allowed).toBe(false);
      expect(mktRes.reason).toContain('Frequency cap active');
    });

    it('allows MARKETING message when consent is granted, outside quiet hours, and frequency cap cleared', () => {
      const mktRes = evaluateMessageConsent('MARKETING', {
        consentGranted: true,
        inQuietHours: false,
        daysSinceLastMarketing: 8,
      });
      expect(mktRes.allowed).toBe(true);
    });
  });
});
