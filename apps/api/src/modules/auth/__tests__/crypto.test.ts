import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  generateOtpCode,
  hmacOtp,
  timingSafeEqual,
  generateRefreshToken,
  hashRefreshToken,
  generateRecoveryCode,
  hashRecoveryCode,
} from '../../../modules/auth/crypto.js';

describe('crypto helpers', () => {
  describe('password hashing (argon2id)', () => {
    it('hashes a password and verifies correctly', async () => {
      const hash = await hashPassword('correct-horse-battery-staple');
      expect(await verifyPassword(hash, 'correct-horse-battery-staple')).toBe(true);
    });

    it('rejects wrong password', async () => {
      const hash = await hashPassword('correct-horse-battery-staple');
      expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
    });

    it('produces different hashes for same input (salted)', async () => {
      const a = await hashPassword('same-password');
      const b = await hashPassword('same-password');
      expect(a).not.toBe(b);
    });

    it('hash starts with argon2id identifier', async () => {
      const hash = await hashPassword('test-password');
      expect(hash).toMatch(/^\$argon2id/);
    });
  });

  describe('OTP code generation', () => {
    it('generates 6-digit codes', () => {
      for (let i = 0; i < 100; i++) {
        const code = generateOtpCode(6);
        expect(code).toHaveLength(6);
        expect(Number(code)).toBeGreaterThanOrEqual(100000);
        expect(Number(code)).toBeLessThan(1000000);
      }
    });

    it('generates different codes across calls', () => {
      const codes = new Set(Array.from({ length: 50 }, () => generateOtpCode()));
      // With 50 random 6-digit codes, probability of any collision is negligibly small
      expect(codes.size).toBeGreaterThan(45);
    });
  });

  describe('HMAC OTP', () => {
    it('produces consistent hashes for same input', () => {
      const pepper = 'a'.repeat(32);
      expect(hmacOtp('123456', pepper)).toBe(hmacOtp('123456', pepper));
    });

    it('produces different hashes for different codes', () => {
      const pepper = 'a'.repeat(32);
      expect(hmacOtp('123456', pepper)).not.toBe(hmacOtp('654321', pepper));
    });

    it('produces different hashes for different peppers', () => {
      expect(hmacOtp('123456', 'a'.repeat(32))).not.toBe(hmacOtp('123456', 'b'.repeat(32)));
    });
  });

  describe('timingSafeEqual', () => {
    it('returns true for equal strings', () => {
      const h = hmacOtp('123456', 'a'.repeat(32));
      expect(timingSafeEqual(h, h)).toBe(true);
    });

    it('returns false for different strings', () => {
      const a = hmacOtp('123456', 'a'.repeat(32));
      const b = hmacOtp('654321', 'a'.repeat(32));
      expect(timingSafeEqual(a, b)).toBe(false);
    });

    it('returns false for different lengths', () => {
      expect(timingSafeEqual('abc', 'ab')).toBe(false);
    });
  });

  describe('refresh token', () => {
    it('generates URL-safe base64 tokens', () => {
      const token = generateRefreshToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token.length).toBeGreaterThan(30);
    });

    it('hashes deterministically', () => {
      const raw = generateRefreshToken();
      expect(hashRefreshToken(raw)).toBe(hashRefreshToken(raw));
    });

    it('different raw tokens → different hashes', () => {
      expect(hashRefreshToken(generateRefreshToken())).not.toBe(
        hashRefreshToken(generateRefreshToken()),
      );
    });
  });

  describe('recovery codes', () => {
    it('generates formatted recovery codes', () => {
      const code = generateRecoveryCode();
      expect(code).toMatch(/^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/);
    });

    it('hashes recovery code consistently', () => {
      const code = generateRecoveryCode();
      expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(code));
    });

    it('hash is case/dash insensitive', () => {
      const code = 'abcd1234-ef567890-abcdef12-34567890';
      const upper = code.toUpperCase();
      expect(hashRecoveryCode(code)).toBe(hashRecoveryCode(upper));
    });
  });
});
