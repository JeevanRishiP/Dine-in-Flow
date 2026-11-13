import { Injectable, Inject, Optional } from '@nestjs/common';
import crypto from 'node:crypto';
import type Redis from 'ioredis';
import { verifySync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { getPool, withTenantContextRaw } from '../../db/client.js';
import { getConfig } from '../../config/config.js';
import {
  verifyPassword,
  generateRefreshToken,
  hashRefreshToken,
  hashRecoveryCode,
  timingSafeEqual,
} from './crypto.js';
import { TokenService, StaffJwtPayload } from './token.service.js';
import { REDIS_CLIENT } from './customer-otp.service.js';
import { encryptToken, decryptToken } from '../feedback/token-cipher.js';
import { ErrorCode } from '@dineflow/contracts';
import { domainError, type DomainError } from '../../common/errors/domain-error.js';

const LOGIN_MAX_FAILS = 10;
const LOGIN_IP_LIMIT = 30;
const LOGIN_WINDOW_SEC = 900; // 15 minutes
const MFA_MAX_FAILS = 5;
const MFA_WINDOW_SEC = 300; // 5 minutes
const TOTP_REPLAY_TTL_SEC = 90;

export interface StaffLoginResult {
  accessToken: string;
  refreshToken: string;
  requiresMfa: boolean;
  preMfaToken?: string;
  userId: string;
  username?: string;
  email?: string;
  displayName?: string;
  orgId?: string;
  orgSlug?: string;
}

export interface StaffTokenRefreshResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Staff authentication service.
 * Handles: login (with MFA enforcement & pre-MFA token), TOTP replay/rate-limits,
 * AES-256-GCM TOTP decryption, transactional RLS, and atomic refresh token rotation.
 *
 * NEEDS_HUMAN_REVIEW: token rotation, MFA enforcement, refresh reuse detection
 * Reference: ARCH §12, AGENTS §3
 */
@Injectable()
export class StaffAuthService {
  constructor(
    private readonly tokenService: TokenService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  private mfaEncryptionKey(): string {
    return process.env['MFA_ENCRYPTION_KEY'] || getConfig().JWT_SECRET;
  }

  encryptTotpSecret(plainSecret: string): string {
    return encryptToken(plainSecret, this.mfaEncryptionKey());
  }

  private decryptTotpSecret(stored: string): string {
    if (stored.split(':').length === 3) {
      return decryptToken(stored, this.mfaEncryptionKey());
    }
    if (process.env['NODE_ENV'] === 'production') {
      throw domainError(
        ErrorCode.MFA_INVALID,
        'TOTP secret must be encrypted at rest in production.',
        500,
      );
    }
    return stored;
  }

  private hashKeyPart(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
  }

  private async enforceSlidingFailureCap(key: string, max: number): Promise<void> {
    if (!this.redis) return;
    const raw = await this.redis.get(key);
    const count = raw ? Number(raw) : 0;
    if (count >= max) {
      throw domainError(ErrorCode.RATE_LIMITED, 'Too many authentication attempts. Try again later.', 429);
    }
  }

  private async incrementFailureCounter(key: string, windowSec: number): Promise<void> {
    if (!this.redis) return;
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSec);
    }
  }

  private async clearFailureCounter(key: string): Promise<void> {
    if (!this.redis) return;
    await this.redis.del(key);
  }

  /**
   * Resolve organization automatically when Workspace Slug is omitted, then authenticate.
   * Supports username or email so staff only need username + password.
   */
  async loginWithOptionalOrg(params: {
    orgId?: string;
    orgSlug?: string;
    identifier: string;
    password: string;
    clientIp?: string;
  }): Promise<StaffLoginResult> {
    const clientIp = params.clientIp ?? 'unknown';
    const normalizedIdentifier = params.identifier.trim().toLowerCase();
    const pool = getPool();

    if (params.orgId) {
      const orgRes = await pool.query<{ id: string; slug: string }>(
        'SELECT id, slug::text AS slug FROM organizations WHERE id = $1 AND is_active = true',
        [params.orgId],
      );
      if (!orgRes.rows[0]) {
        throw domainError(ErrorCode.NOT_FOUND, 'Organization not found.', 404);
      }
      return this.login(orgRes.rows[0].id, normalizedIdentifier, params.password, clientIp, orgRes.rows[0].slug);
    }

    if (params.orgSlug) {
      const orgRes = await pool.query<{ id: string; slug: string }>(
        'SELECT id, slug::text AS slug FROM organizations WHERE slug = $1 AND is_active = true',
        [params.orgSlug.trim().toLowerCase()],
      );
      if (!orgRes.rows[0]) {
        throw domainError(ErrorCode.NOT_FOUND, 'Organization not found.', 404);
      }
      return this.login(orgRes.rows[0].id, normalizedIdentifier, params.password, clientIp, orgRes.rows[0].slug);
    }

    const candidatesRes = await pool.query<{ org_id: string; org_slug: string }>(
      'SELECT org_id, org_slug FROM resolve_staff_login_candidates($1)',
      [normalizedIdentifier],
    );
    const candidates = candidatesRes.rows;

    if (candidates.length === 0) {
      // Constant-time failure parity before rejecting unknown identifier
      const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummyhash/dummysalt$dummydummydummydummydummydummydumm';
      await verifyPassword(dummyHash, params.password);
      throw domainError(ErrorCode.INVALID_CREDENTIALS, 'Invalid username or password.', 401);
    }

    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      return this.login(candidate.org_id, normalizedIdentifier, params.password, clientIp, candidate.org_slug);
    }

    const matches: StaffLoginResult[] = [];
    for (const candidate of candidates) {
      try {
        const res = await this.login(candidate.org_id, normalizedIdentifier, params.password, clientIp, candidate.org_slug);
        matches.push(res);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (code !== ErrorCode.INVALID_CREDENTIALS) {
          throw err;
        }
      }
    }

    if (matches.length === 1) {
      return matches[0]!;
    }
    if (matches.length > 1) {
      throw domainError(
        ErrorCode.CONFLICT,
        'Multiple restaurants share this username and password. Open Advanced and enter your Workspace Slug.',
        409,
      );
    }
    throw domainError(ErrorCode.INVALID_CREDENTIALS, 'Invalid username or password.', 401);
  }

  /**
   * Authenticate a staff member with username or email + password.
   * - Timing-safe password comparison
   * - Enforces MFA only when enrolled or ENFORCE_ADMIN_MFA=true
   * - Returns short-lived preMfaToken when requiresMfa=true; caller must call verifyMfa()
   */
  async login(
    orgId: string,
    email: string,
    password: string,
    clientIp = 'unknown',
    orgSlug?: string,
  ): Promise<StaffLoginResult> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const failKey = `staff:login:fail:${orgId}:${this.hashKeyPart(normalizedEmail)}`;
    const ipKey = `staff:login:ip:${this.hashKeyPart(clientIp)}`;

    await this.enforceSlidingFailureCap(ipKey, LOGIN_IP_LIMIT);
    await this.enforceSlidingFailureCap(failKey, LOGIN_MAX_FAILS);

    const user = await withTenantContextRaw(orgId, async (client) => {
      const r = await client.query<{
        id: string;
        username?: string | null;
        email?: string | null;
        display_name?: string | null;
        password_hash: string;
        is_active: boolean;
        totp_secret_enc: string | null;
        totp_enrolled_at: Date | null;
      }>(
        `SELECT id, username::text AS username, email::text AS email, display_name,
                password_hash, is_active, totp_secret_enc, totp_enrolled_at
         FROM staff_users WHERE org_id = $1 AND (username = $2 OR email = $2) LIMIT 1`,
        [orgId, normalizedEmail],
      );
      return r.rows[0] ?? null;
    });

    // Always run password comparison to prevent username enumeration via timing
    const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummyhash/dummysalt$dummydummydummydummydummydummydumm';
    const hashToVerify = user?.password_hash ?? dummyHash;
    const valid = await verifyPassword(hashToVerify, password);

    if (!user || !valid || !user.is_active) {
      await this.incrementFailureCounter(ipKey, LOGIN_WINDOW_SEC);
      await this.incrementFailureCounter(failKey, LOGIN_WINDOW_SEC);
      const err: DomainError = {
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid username or password.',
        status: 401,
      };
      throw err;
    }

    const membership = await this._getMembership(orgId, user.id);
    if (!membership) {
      throw domainError(ErrorCode.FORBIDDEN, 'No active staff membership found for this organization.', 403);
    }

    await this.clearFailureCounter(failKey);

    const hasMfa = !!user.totp_enrolled_at;
    const mfaRequiredForRole =
      (membership.role === 'OWNER' || membership.role === 'MANAGER') &&
      (process.env['NODE_ENV'] === 'production' || process.env['ENFORCE_ADMIN_MFA'] === 'true');

    if (hasMfa) {
      const preMfaToken = this.tokenService.signPreMfaToken({
        sub: user.id,
        org: orgId,
        role: membership.role,
      });
      return {
        accessToken: '',
        refreshToken: '',
        requiresMfa: true,
        preMfaToken,
        userId: user.id,
        ...(user.username ? { username: user.username } : {}),
        ...(user.email ? { email: user.email } : {}),
        ...(user.display_name ? { displayName: user.display_name } : {}),
        orgId,
        ...(orgSlug ? { orgSlug } : {}),
      };
    }

    if (mfaRequiredForRole) {
      throw domainError(
        ErrorCode.MFA_REQUIRED,
        'MFA enrollment is required for OWNER and MANAGER accounts.',
        403,
      );
    }

    const { accessToken, refreshToken } = await this._issueTokenPair(orgId, user.id, membership.role, membership.outlet_id);
    return {
      accessToken,
      refreshToken,
      requiresMfa: false,
      userId: user.id,
      ...(user.username ? { username: user.username } : {}),
      ...(user.email ? { email: user.email } : {}),
      ...(user.display_name ? { displayName: user.display_name } : {}),
      orgId,
      ...(orgSlug ? { orgSlug } : {}),
    };
  }

  /**
   * Verify TOTP or recovery code using the cryptographic preMfaToken from login().
   */
  async verifyMfa(
    preMfaToken: string,
    code: string,
    clientIp = 'unknown',
  ): Promise<StaffLoginResult> {
    const preMfa = this.tokenService.verifyPreMfaToken(preMfaToken);
    if (!preMfa) {
      throw domainError(ErrorCode.TOKEN_INVALID, 'Invalid or expired pre-MFA session.', 401);
    }
    const { org: orgId, sub: userId } = preMfa;

    const failKey = `staff:mfa:fail:${orgId}:${userId}`;
    const ipFailKey = `staff:mfa:ip:${this.hashKeyPart(clientIp)}`;
    await this.enforceSlidingFailureCap(ipFailKey, LOGIN_IP_LIMIT);
    await this.enforceSlidingFailureCap(failKey, MFA_MAX_FAILS);

    const user = await this._getStaffUser(orgId, userId);
    if (!user.totp_secret_enc) {
      throw domainError(ErrorCode.MFA_INVALID, 'MFA not enrolled.', 400);
    }

    const secret = this.decryptTotpSecret(user.totp_secret_enc);
    let validTotp = false;
    try {
      const totpRes = verifySync({
        secret,
        token: code,
        crypto: new NobleCryptoPlugin(),
        base32: new ScureBase32Plugin(),
      });
      validTotp = (totpRes as { valid?: boolean } | boolean) === true ||
        (typeof totpRes === 'object' && totpRes !== null && totpRes.valid === true);
    } catch {
      validTotp = false;
    }

    if (validTotp) {
      if (this.redis) {
        const replayKey = `staff:mfa:used:${orgId}:${userId}:${this.hashKeyPart(code)}`;
        const setRes = await this.redis.set(replayKey, '1', 'EX', TOTP_REPLAY_TTL_SEC, 'NX');
        if (setRes !== 'OK') {
          await this.incrementFailureCounter(failKey, MFA_WINDOW_SEC);
          throw domainError(ErrorCode.MFA_INVALID, 'TOTP code has already been used.', 401);
        }
      }
    } else {
      // Check one-time hashed recovery codes inside committed tenant TX
      const recoveryMatched = await withTenantContextRaw(orgId, async (client) => {
        const r = await client.query<{ recovery_codes: unknown }>(
          `SELECT recovery_codes FROM staff_users WHERE id = $1 AND org_id = $2 FOR UPDATE`,
          [userId, orgId],
        );
        const codes: string[] = (r.rows[0]?.recovery_codes as string[]) ?? [];
        const codeHash = hashRecoveryCode(code);
        const matchIdx = codes.findIndex((h) => timingSafeEqual(h, codeHash));
        if (matchIdx === -1) return false;

        codes.splice(matchIdx, 1);
        await client.query(
          `UPDATE staff_users SET recovery_codes = $1::jsonb, updated_at = now() WHERE id = $2 AND org_id = $3`,
          [JSON.stringify(codes), userId, orgId],
        );
        return true;
      });

      if (!recoveryMatched) {
        await this.incrementFailureCounter(ipFailKey, LOGIN_WINDOW_SEC);
        await this.incrementFailureCounter(failKey, MFA_WINDOW_SEC);
        throw domainError(ErrorCode.MFA_INVALID, 'Invalid MFA code.', 401);
      }
    }

    await this.clearFailureCounter(failKey);

    const membership = await this._getMembership(orgId, userId);
    if (!membership) {
      throw domainError(ErrorCode.FORBIDDEN, 'No active staff membership found for this organization.', 403);
    }

    const { accessToken, refreshToken } = await this._issueTokenPair(orgId, userId, membership.role, membership.outlet_id);
    return { accessToken, refreshToken, requiresMfa: false, userId };
  }

  /**
   * Atomic rotating refresh token with reuse detection (token family revocation).
   * Commits family revocation even on error paths before throwing TOKEN_REUSE_DETECTED.
   */
  async refreshTokens(orgId: string, rawToken: string): Promise<StaffTokenRefreshResult> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const tokenHash = hashRefreshToken(rawToken);
    const rawRefresh = generateRefreshToken();
    const newHash = hashRefreshToken(rawRefresh);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const outcome = await withTenantContextRaw(orgId, async (client) => {
      const r = await client.query<{
        id: string;
        user_id: string;
        family_id: string;
        is_revoked: boolean;
        expires_at: string;
      }>(
        `SELECT id, user_id, family_id, is_revoked, expires_at
         FROM staff_refresh_tokens WHERE token_hash = $1 AND org_id = $2
         FOR UPDATE`,
        [tokenHash, orgId],
      );
      const stored = r.rows[0];
      if (!stored) {
        return { status: 'INVALID' as const };
      }

      if (stored.is_revoked) {
        await client.query(
          `UPDATE staff_refresh_tokens SET is_revoked = true WHERE family_id = $1 AND org_id = $2`,
          [stored.family_id, orgId],
        );
        return { status: 'REUSED' as const };
      }

      if (new Date(stored.expires_at) < new Date()) {
        return { status: 'EXPIRED' as const };
      }

      const claimed = await client.query<{ id: string }>(
        `UPDATE staff_refresh_tokens
         SET is_revoked = true
         WHERE id = $1 AND org_id = $2 AND is_revoked = false
         RETURNING id`,
        [stored.id, orgId],
      );
      if (claimed.rowCount === 0) {
        await client.query(
          `UPDATE staff_refresh_tokens SET is_revoked = true WHERE family_id = $1 AND org_id = $2`,
          [stored.family_id, orgId],
        );
        return { status: 'REUSED' as const };
      }

      const mRes = await client.query<{ role: string; outlet_id: string | null }>(
        `SELECT role, outlet_id FROM staff_memberships
         WHERE org_id = $1 AND user_id = $2 AND is_active = true
         ORDER BY (outlet_id IS NULL) DESC LIMIT 1`,
        [orgId, stored.user_id],
      );
      const membership = mRes.rows[0];
      if (!membership) {
        return { status: 'NO_MEMBERSHIP' as const };
      }

      await client.query(
        `INSERT INTO staff_refresh_tokens (org_id, user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, stored.user_id, newHash, stored.family_id, expiresAt],
      );
      await client.query(
        `UPDATE staff_users SET last_login_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2`,
        [stored.user_id, orgId],
      );

      const payload: StaffJwtPayload = {
        sub: stored.user_id,
        org: orgId,
        role: membership.role,
        ...(membership.outlet_id ? { outletId: membership.outlet_id } : {}),
        type: 'staff_access',
      };
      const accessToken = this.tokenService.signAccessToken(payload);
      return { status: 'OK' as const, accessToken, refreshToken: rawRefresh };
    });

    if (outcome.status === 'INVALID') {
      throw domainError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token.', 401);
    }
    if (outcome.status === 'REUSED' || outcome.status === 'EXPIRED') {
      throw domainError(
        ErrorCode.TOKEN_REUSE_DETECTED,
        'Token reuse detected or expired. All sessions revoked.',
        401,
      );
    }
    if (outcome.status === 'NO_MEMBERSHIP') {
      throw domainError(ErrorCode.FORBIDDEN, 'No active staff membership found.', 403);
    }
    return { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
  }

  /**
   * Revoke a single session by refreshToken.
   */
  async revokeSession(orgId: string, rawToken: string): Promise<void> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const tokenHash = hashRefreshToken(rawToken);
    await withTenantContextRaw(orgId, async (client) => {
      await client.query(
        `UPDATE staff_refresh_tokens SET is_revoked = true WHERE token_hash = $1 AND org_id = $2`,
        [tokenHash, orgId],
      );
    });
  }

  /**
   * Revoke all sessions for a user (logout everywhere).
   */
  async revokeAllSessions(orgId: string, userId: string): Promise<void> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    await withTenantContextRaw(orgId, async (client) => {
      await client.query(
        `UPDATE staff_refresh_tokens SET is_revoked = true WHERE org_id = $1 AND user_id = $2 AND is_revoked = false`,
        [orgId, userId],
      );
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _issueTokenPair(
    orgId: string,
    userId: string,
    role: string,
    outletId: string | null,
    familyId?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const payload: StaffJwtPayload = {
      sub: userId,
      org: orgId,
      role,
      ...(outletId ? { outletId } : {}),
      type: 'staff_access',
    };
    const accessToken = this.tokenService.signAccessToken(payload);
    const rawRefresh = generateRefreshToken();
    const tokenHash = hashRefreshToken(rawRefresh);
    const newFamilyId = familyId ?? crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    await withTenantContextRaw(orgId, async (client) => {
      await client.query(
        `INSERT INTO staff_refresh_tokens (org_id, user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, userId, tokenHash, newFamilyId, expiresAt],
      );
      await client.query(
        `UPDATE staff_users SET last_login_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2`,
        [userId, orgId],
      );
    });
    return { accessToken, refreshToken: rawRefresh };
  }

  private async _getMembership(
    orgId: string,
    userId: string,
  ): Promise<{ role: string; outlet_id: string | null } | null> {
    return withTenantContextRaw(orgId, async (client) => {
      const r = await client.query<{ role: string; outlet_id: string | null }>(
        `SELECT role, outlet_id FROM staff_memberships
         WHERE org_id = $1 AND user_id = $2 AND is_active = true
         ORDER BY (outlet_id IS NULL) DESC LIMIT 1`,
        [orgId, userId],
      );
      return r.rows[0] ?? null;
    });
  }

  private async _getStaffUser(
    orgId: string,
    userId: string,
  ): Promise<{
    totp_secret_enc: string | null;
    recovery_codes: unknown;
  }> {
    return withTenantContextRaw(orgId, async (client) => {
      const r = await client.query<{ totp_secret_enc: string | null; recovery_codes: unknown }>(
        `SELECT totp_secret_enc, recovery_codes FROM staff_users WHERE id = $1 AND org_id = $2`,
        [userId, orgId],
      );
      if (!r.rows[0]) {
        throw domainError(ErrorCode.NOT_FOUND, 'User not found.', 404);
      }
      return r.rows[0];
    });
  }
}
