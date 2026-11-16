import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatNormalizedPhone,
  isValidPhoneNumber,
  isValidEmail,
  isValidOtp,
  resolveCustomerAuthOrgId,
} from './auth-utils.ts';

describe('CustomerAuthModal utils (auth-utils.ts)', () => {
  describe('formatNormalizedPhone', () => {
    it('prepends +91 when raw digits do not have a leading plus sign', () => {
      assert.equal(formatNormalizedPhone('9876543210'), '+919876543210');
      assert.equal(formatNormalizedPhone(' 98765 43210 '), '+919876543210');
    });

    it('preserves existing plus sign for international numbers', () => {
      assert.equal(formatNormalizedPhone('+919876543210'), '+919876543210');
      assert.equal(formatNormalizedPhone('+14155552671'), '+14155552671');
    });

    it('returns empty string for empty input', () => {
      assert.equal(formatNormalizedPhone(''), '');
      assert.equal(formatNormalizedPhone('   '), '');
    });
  });

  describe('isValidPhoneNumber', () => {
    it('accepts valid 10-digit Indian numbers', () => {
      assert.equal(isValidPhoneNumber('9876543210'), true);
      assert.equal(isValidPhoneNumber('+919876543210'), true);
    });

    it('rejects numbers that are too short or invalid', () => {
      assert.equal(isValidPhoneNumber('123'), false);
      assert.equal(isValidPhoneNumber('abcdefghij'), false);
      assert.equal(isValidPhoneNumber(''), false);
    });
  });

  describe('isValidEmail', () => {
    it('validates common email patterns', () => {
      assert.equal(isValidEmail('diner@example.com'), true);
      assert.equal(isValidEmail('user.name+tag@sub.domain.org'), true);
    });

    it('rejects invalid email formats', () => {
      assert.equal(isValidEmail('not-an-email'), false);
      assert.equal(isValidEmail('user@'), false);
      assert.equal(isValidEmail('@example.com'), false);
      assert.equal(isValidEmail(''), false);
    });
  });

  describe('isValidOtp', () => {
    it('accepts exact 6-digit numeric codes', () => {
      assert.equal(isValidOtp('123456'), true);
      assert.equal(isValidOtp('000000'), true);
      assert.equal(isValidOtp(' 987654 '), true);
    });

    it('rejects non-6-digit or non-numeric codes', () => {
      assert.equal(isValidOtp('12345'), false);
      assert.equal(isValidOtp('1234567'), false);
      assert.equal(isValidOtp('12345a'), false);
      assert.equal(isValidOtp(''), false);
    });
  });

  describe('resolveCustomerAuthOrgId', () => {
    it('returns activeOrgId if provided', () => {
      assert.equal(resolveCustomerAuthOrgId('org_custom_123'), 'org_custom_123');
    });

    it('falls back safely when activeOrgId is undefined', () => {
      const resolved = resolveCustomerAuthOrgId(undefined);
      assert.equal(typeof resolved, 'string');
    });
  });
});
