import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import type { PoolClient } from 'pg';
import { generateSecret, generateSync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { TokenService } from '../token.service.js';
import { StaffAuthService } from '../staff-auth.service.js';
import { CustomerOtpService } from '../customer-otp.service.js';
import { hashPassword, hmacOtp } from '../crypto.js';
import { resolveScopedOutletId, assertStaffOutletAccess } from '../../../common/utils/outlet-scope.utils.js';
import * as dbClient from '../../../db/client.js';

vi.mock('../../../config/config.js', () => ({
  getConfig: () => ({
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!',
    OTP_HMAC_PEPPER: 'test-otp-pepper-at-least-32-chars-long!',
    QR_TOKEN_SECRET: 'test-qr-secret-at-least-32-chars-long!!',
    REDIS_URL: 'redis://localhost:6380',
    DATABASE_URL: 'postgresql://dineflow_app:pass@localhost:5433/dineflow',
    NODE_ENV: 'test',
  }),
}));

describe('Auth, MFA, RBAC Outlet Scope & Transactional RLS (Slice 2)', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const userId = '22222222-2222-4222-8222-222222222222';
  const outletA = '33333333-3333-4333-8333-333333333333';
  const outletB = '44444444-4444-4444-8444-444444444444';
  const originalEnv = process.env['NODE_ENV'];
  const originalEnforceMfa = process.env['ENFORCE_ADMIN_MFA'];

  let tokenService: TokenService;
  let redisStore: Map<string, string>;
  let mockRedis: {
    get: ReturnType<typeof vi.fn>;
    incr: ReturnType<typeof vi.fn>;
    expire: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    ttl: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    tokenService = new TokenService(new JwtService({}));
    redisStore = new Map();
    mockRedis = {
      get: vi.fn(async (k: string) => redisStore.get(k) ?? null),
      incr: vi.fn(async (k: string) => {
        const next = String(Number(redisStore.get(k) ?? '0') + 1);
        redisStore.set(k, next);
        return Number(next);
      }),
      expire: vi.fn(async () => 1),
      del: vi.fn(async (k: string) => {
        redisStore.delete(k);
        return 1;
      }),
      set: vi.fn(async (k: string, v: string, ...args: unknown[]) => {
        if (args.includes('NX') && redisStore.has(k)) {
          return null;
        }
        redisStore.set(k, v);
        return 'OK';
      }),
      ttl: vi.fn(async () => -1),
    };
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
    process.env['ENFORCE_ADMIN_MFA'] = originalEnforceMfa;
  });

  describe('TokenService domain separation', () => {
    it('rejects pre_mfa token on verifyAccessToken and rejects access token on verifyPreMfaToken', () => {
      const preMfaToken = tokenService.signPreMfaToken({
        sub: userId,
        org: orgId,
        role: 'OWNER',
      });
      expect(tokenService.verifyPreMfaToken(preMfaToken)).toMatchObject({
        sub: userId,
        org: orgId,
        purpose: 'pre_mfa',
        type: 'pre_mfa',
      });
      expect(tokenService.verifyAccessToken(preMfaToken)).toBeNull();

      const staffAccess = tokenService.signAccessToken({
        sub: userId,
        org: orgId,
        role: 'OWNER',
        type: 'staff_access',
      });
      expect(tokenService.verifyPreMfaToken(staffAccess)).toBeNull();
      expect(tokenService.verifyAccessToken(staffAccess)).toMatchObject({
        sub: userId,
        type: 'staff_access',
      });
    });
  });

  describe('StaffAuthService MFA, Replay, Encryption & RLS', () => {
    it('denies login when no active staff membership exists (no WAITER fallback)', async () => {
      const passwordHash = await hashPassword('StrongPass123!');
      const queryMock = vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: userId,
            password_hash: passwordHash,
            is_active: true,
            totp_secret_enc: null,
            totp_enrolled_at: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [] }); // empty membership

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      const svc = new StaffAuthService(tokenService, mockRedis as never);
      await expect(
        svc.login(orgId, 'staff@example.com', 'StrongPass123!', '1.2.3.4'),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('enforces MFA enrollment for OWNER/MANAGER in production/ENFORCE_ADMIN_MFA mode', async () => {
      process.env['ENFORCE_ADMIN_MFA'] = 'true';
      const passwordHash = await hashPassword('StrongPass123!');
      const queryMock = vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: userId,
            password_hash: passwordHash,
            is_active: true,
            totp_secret_enc: null,
            totp_enrolled_at: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ role: 'OWNER', outlet_id: null }] });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      const svc = new StaffAuthService(tokenService, mockRedis as never);
      await expect(
        svc.login(orgId, 'owner@example.com', 'StrongPass123!', '1.2.3.4'),
      ).rejects.toMatchObject({ status: 403, code: 'MFA_REQUIRED' });
    });

    it('rejects wrong TOTP code (fixes otplib object truthiness bug), accepts real encrypted TOTP once, and blocks replay', async () => {
      const svc = new StaffAuthService(tokenService, mockRedis as never);
      const rawSecret = generateSecret();
      const encryptedSecret = svc.encryptTotpSecret(rawSecret);
      expect(encryptedSecret.split(':')).toHaveLength(3);
      expect(encryptedSecret).not.toContain(rawSecret);

      const preMfaToken = tokenService.signPreMfaToken({
        sub: userId,
        org: orgId,
        role: 'OWNER',
      });

      const queryMock = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM staff_users') && sql.includes('totp_secret_enc')) {
          return { rows: [{ totp_secret_enc: encryptedSecret, recovery_codes: [] }] };
        }
        if (sql.includes('SELECT recovery_codes FROM staff_users')) {
          return { rows: [{ recovery_codes: [] }] };
        }
        if (sql.includes('FROM staff_memberships')) {
          return { rows: [{ role: 'OWNER', outlet_id: null }] };
        }
        return { rows: [] };
      });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      // 1. Invalid code must be rejected with 401 MFA_INVALID (never truthy pass!)
      await expect(svc.verifyMfa(preMfaToken, '000000', '1.2.3.4')).rejects.toMatchObject({
        status: 401,
        code: 'MFA_INVALID',
      });

      // 2. Valid current TOTP code succeeds and returns accessToken
      const validCode = generateSync({
        secret: rawSecret,
        crypto: new NobleCryptoPlugin(),
        base32: new ScureBase32Plugin(),
      });
      const res = await svc.verifyMfa(preMfaToken, validCode, '1.2.3.4');
      expect(res.requiresMfa).toBe(false);
      expect(res.accessToken.length).toBeGreaterThan(20);

      // 3. Replaying the exact same TOTP code within window is rejected
      await expect(svc.verifyMfa(preMfaToken, validCode, '1.2.3.4')).rejects.toMatchObject({
        status: 401,
        code: 'MFA_INVALID',
      });
    });

    it('rejects tampered/forged preMfaToken and enforces atomic refresh reuse revocation', async () => {
      const svc = new StaffAuthService(tokenService, mockRedis as never);
      await expect(svc.verifyMfa('forged.jwt.token-value-123456', '123456')).rejects.toMatchObject({
        status: 401,
        code: 'TOKEN_INVALID',
      });

      const queryMock = vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'rt-1',
            user_id: userId,
            family_id: 'fam-1',
            is_revoked: true,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }],
        })
        .mockResolvedValueOnce({ rows: [] });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      await expect(svc.refreshTokens(orgId, 'raw-refresh-token-12345')).rejects.toMatchObject({
        status: 401,
        code: 'TOKEN_REUSE_DETECTED',
      });

      const familyUpdateCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('UPDATE staff_refresh_tokens SET is_revoked = true WHERE family_id'),
      );
      expect(familyUpdateCall).toBeDefined();
    });
  });

  describe('CustomerOtpService Transactional Attempts & devCode Gating', () => {
    it('omits devCode outside development/test (e.g. staging or production)', async () => {
      process.env['NODE_ENV'] = 'production';
      const messaging = { sendOtp: vi.fn(async () => {}) };
      const otpSvc = new CustomerOtpService(tokenService, messaging as never, mockRedis as never);

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as PoolClient),
      );

      const res = await otpSvc.requestOtp(orgId, '+919876543210', '1.2.3.4');
      expect(res.devCode).toBeUndefined();
    });

    it('commits attempt increment on invalid guess and returns OTP_INVALID cleanly', async () => {
      const otpSvc = new CustomerOtpService(tokenService, { sendOtp: vi.fn() } as never, mockRedis as never);
      const validHash = hmacOtp('123456', 'test-otp-pepper-at-least-32-chars-long!');
      const queryMock = vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            id: 'otp-1',
            code_hash: validHash,
            attempts: 0,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            verified_at: null,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ attempts: 1 }] });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      await expect(otpSvc.verifyOtp(orgId, '+919876543210', '999999')).rejects.toMatchObject({
        status: 401,
        code: 'OTP_INVALID',
      });
      const incCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('attempts = attempts + 1'),
      );
      expect(incCall).toBeDefined();
    });
  });

  describe('Outlet Scope Utilities', () => {
    it('enforces assigned outlet for outlet-scoped staff while letting org-wide OWNER query freely', () => {
      expect(resolveScopedOutletId(undefined, outletB)).toBe(outletB);
      expect(resolveScopedOutletId(outletA, undefined)).toBe(outletA);
      expect(resolveScopedOutletId(outletA, outletA)).toBe(outletA);
      expect(() => resolveScopedOutletId(outletA, outletB)).toThrowError(
        expect.objectContaining({ status: 403 }),
      );
      expect(() => assertStaffOutletAccess(outletA, outletB)).toThrowError(
        expect.objectContaining({ status: 403 }),
      );
    });
  });
});

