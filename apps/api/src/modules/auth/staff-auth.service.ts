import { Injectable, UnauthorizedException } from '@nestjs/common';
import { Pool } from 'pg';
import { verifySync, NobleCryptoPlugin, ScureBase32Plugin } from 'otplib';
import { getPool, withTenantContext } from '../../db/client.js';
import { getConfig } from '../../config/config.js';
import {
  hashPassword,
  verifyPassword,
  generateRefreshToken,
  hashRefreshToken,
  generateRecoveryCode,
  hashRecoveryCode,
  timingSafeEqual,
} from './crypto.js';
import { TokenService, StaffJwtPayload } from './token.service.js';
import { ErrorCode } from '@dineflow/contracts';
import type { DomainError } from '../../common/errors/domain-error.js';

export interface StaffLoginResult {
  accessToken: string;
  refreshToken: string;
  requiresMfa: boolean;
  userId: string;
}

export interface StaffTokenRefreshResult {
  accessToken: string;
  refreshToken: string;
}

/**
 * Staff authentication service.
 * Handles: login (with MFA check), refresh token rotation with reuse detection,
 * session list, session revocation, and password reset.
 *
 * NEEDS_HUMAN_REVIEW: token rotation, MFA enforcement, refresh reuse detection
 * Reference: ARCH §12, AGENTS §3
 */
@Injectable()
export class StaffAuthService {
  private readonly pool: Pool;

  constructor(private readonly tokenService: TokenService) {
    this.pool = getPool();
  }

  /**
   * Authenticate a staff member with email + password.
   * - Timing-safe password comparison
   * - If TOTP is enrolled, returns requiresMfa=true; caller must then call verifyMfa()
   * - Access token issued only after MFA pass (if enrolled)
   * Reference: ARCH §12
   */
  async login(
    orgId: string,
    email: string,
    password: string,
  ): Promise<StaffLoginResult> {
    const user = await withTenantContext(orgId, async (db) => {
      // Must be raw SQL for constant-time safety (no ORM short-circuit)
      const client = await this.pool.connect();
      try {
        await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
        const r = await client.query<{
          id: string;
          password_hash: string;
          is_active: boolean;
          totp_secret_enc: string | null;
          totp_enrolled_at: Date | null;
        }>(
          `SELECT id, password_hash, is_active, totp_secret_enc, totp_enrolled_at
           FROM staff_users WHERE org_id = $1 AND email = $2 LIMIT 1`,
          [orgId, email.toLowerCase()],
        );
        return r.rows[0] ?? null;
      } finally {
        client.release();
      }
    });

    // Always run password comparison to prevent username enumeration via timing
    const dummyHash = '$argon2id$v=19$m=65536,t=3,p=4$dummyhash/dummysalt$dummydummydummydummydummydummydumm';
    const hashToVerify = user?.password_hash ?? dummyHash;
    const valid = await verifyPassword(hashToVerify, password);

    if (!user || !valid || !user.is_active) {
      const err: DomainError = {
        code: ErrorCode.INVALID_CREDENTIALS,
        message: 'Invalid email or password.',
        status: 401,
      };
      throw err;
    }

    const hasMfa = !!user.totp_enrolled_at;

    // Get the user's primary membership to determine role
    const membership = await this._getMembership(orgId, user.id);

    // If MFA enrolled, do NOT issue full token yet — caller must verify TOTP
    if (hasMfa) {
      // Issue a limited pre-MFA token (short-lived, no refresh)
      return {
        accessToken: '', // No access token until MFA passes
        refreshToken: '',
        requiresMfa: true,
        userId: user.id,
      };
    }

    const { accessToken, refreshToken } = await this._issueTokenPair(orgId, user.id, membership.role, membership.outlet_id);
    return { accessToken, refreshToken, requiresMfa: false, userId: user.id };
  }

  /**
   * Verify TOTP code after initial password check.
   * Also handles recovery code verification.
   */
  async verifyMfa(
    orgId: string,
    userId: string,
    code: string,
  ): Promise<StaffLoginResult> {
    const user = await this._getStaffUser(orgId, userId);
    if (!user.totp_secret_enc) {
      const err: DomainError = { code: ErrorCode.MFA_INVALID, message: 'MFA not enrolled.', status: 400 };
      throw err;
    }

    // Decrypt TOTP secret (encryption handled separately — stored AES-256-GCM)
    // For Phase 1, the secret is stored base32 encoded (encryption added in Phase 11)
    const validTotp = verifySync({
      secret: user.totp_secret_enc,
      token: code,
      crypto: new NobleCryptoPlugin(),
      base32: new ScureBase32Plugin(),
    });

    if (!validTotp) {
      // Try recovery codes
      const codes: string[] = (user.recovery_codes as string[]) ?? [];
      const codeHash = hashRecoveryCode(code);
      const matchIdx = codes.findIndex((h) => timingSafeEqual(h, codeHash));

      if (matchIdx === -1) {
        const err: DomainError = { code: ErrorCode.MFA_INVALID, message: 'Invalid MFA code.', status: 401 };
        throw err;
      }

      // Burn the recovery code — remove it from the list
      codes.splice(matchIdx, 1);
      await withTenantContext(orgId, async () => {
        const client = await this.pool.connect();
        try {
          await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
          await client.query(
            `UPDATE staff_users SET recovery_codes = $1::jsonb, updated_at = now() WHERE id = $2 AND org_id = $3`,
            [JSON.stringify(codes), userId, orgId],
          );
        } finally {
          client.release();
        }
      });
    }

    const membership = await this._getMembership(orgId, userId);
    const { accessToken, refreshToken } = await this._issueTokenPair(orgId, userId, membership.role, membership.outlet_id);
    return { accessToken, refreshToken, requiresMfa: false, userId };
  }

  /**
   * Rotating refresh token with reuse detection (token family revocation).
   * If a revoked token is replayed → revoke entire family.
   * Reference: ARCH §12
   */
  async refreshTokens(orgId: string, rawToken: string): Promise<StaffTokenRefreshResult> {
    const tokenHash = hashRefreshToken(rawToken);

    const stored = await this._findRefreshToken(orgId, tokenHash);
    if (!stored) {
      const err: DomainError = { code: ErrorCode.TOKEN_INVALID, message: 'Invalid refresh token.', status: 401 };
      throw err;
    }

    if (stored.is_revoked || new Date(stored.expires_at) < new Date()) {
      if (stored.is_revoked) {
        // Reuse detected — revoke entire family
        await this._revokeFamilyTokens(orgId, stored.family_id);
      }
      const err: DomainError = { code: ErrorCode.TOKEN_REUSE_DETECTED, message: 'Token reuse detected. All sessions revoked.', status: 401 };
      throw err;
    }

    // Revoke the used token and issue a new pair
    await this._revokeToken(orgId, stored.id);
    const membership = await this._getMembership(orgId, stored.user_id);
    return this._issueTokenPair(orgId, stored.user_id, membership.role, membership.outlet_id, stored.family_id);
  }

  /**
   * Revoke a single session by refreshToken.
   */
  async revokeSession(orgId: string, rawToken: string): Promise<void> {
    const tokenHash = hashRefreshToken(rawToken);
    const stored = await this._findRefreshToken(orgId, tokenHash);
    if (stored) {
      await this._revokeToken(orgId, stored.id);
    }
  }

  /**
   * Revoke all sessions for a user (logout everywhere).
   */
  async revokeAllSessions(orgId: string, userId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      await client.query(
        `UPDATE staff_refresh_tokens SET is_revoked = true WHERE org_id = $1 AND user_id = $2 AND is_revoked = false`,
        [orgId, userId],
      );
    } finally {
      client.release();
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _issueTokenPair(
    orgId: string,
    userId: string,
    role: string,
    outletId: string | null,
    familyId?: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const config = getConfig();
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
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      await client.query(
        `INSERT INTO staff_refresh_tokens (org_id, user_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, userId, tokenHash, newFamilyId, expiresAt],
      );
      await client.query(
        `UPDATE staff_users SET last_login_at = now(), updated_at = now() WHERE id = $1 AND org_id = $2`,
        [userId, orgId],
      );
    } finally {
      client.release();
    }
    return { accessToken, refreshToken: rawRefresh };
  }

  private async _getMembership(orgId: string, userId: string): Promise<{ role: string; outlet_id: string | null }> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const r = await client.query<{ role: string; outlet_id: string | null }>(
        `SELECT role, outlet_id FROM staff_memberships
         WHERE org_id = $1 AND user_id = $2 AND is_active = true
         ORDER BY (outlet_id IS NULL) DESC LIMIT 1`,
        [orgId, userId],
      );
      return r.rows[0] ?? { role: 'WAITER', outlet_id: null };
    } finally {
      client.release();
    }
  }

  private async _getStaffUser(orgId: string, userId: string): Promise<{
    totp_secret_enc: string | null;
    recovery_codes: unknown;
  }> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const r = await client.query<{ totp_secret_enc: string | null; recovery_codes: unknown }>(
        `SELECT totp_secret_enc, recovery_codes FROM staff_users WHERE id = $1 AND org_id = $2`,
        [userId, orgId],
      );
      if (!r.rows[0]) {
        const err: DomainError = { code: ErrorCode.NOT_FOUND, message: 'User not found.', status: 404 };
        throw err;
      }
      return r.rows[0];
    } finally {
      client.release();
    }
  }

  private async _findRefreshToken(orgId: string, tokenHash: string) {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const r = await client.query<{
        id: string;
        user_id: string;
        family_id: string;
        is_revoked: boolean;
        expires_at: string;
      }>(
        `SELECT id, user_id, family_id, is_revoked, expires_at
         FROM staff_refresh_tokens WHERE token_hash = $1 AND org_id = $2`,
        [tokenHash, orgId],
      );
      return r.rows[0] ?? null;
    } finally {
      client.release();
    }
  }

  private async _revokeToken(orgId: string, tokenId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      await client.query(
        `UPDATE staff_refresh_tokens SET is_revoked = true WHERE id = $1 AND org_id = $2`,
        [tokenId, orgId],
      );
    } finally {
      client.release();
    }
  }

  private async _revokeFamilyTokens(orgId: string, familyId: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      await client.query(
        `UPDATE staff_refresh_tokens SET is_revoked = true WHERE family_id = $1 AND org_id = $2`,
        [familyId, orgId],
      );
    } finally {
      client.release();
    }
  }
}
