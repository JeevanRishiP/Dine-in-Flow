import { Inject, Injectable } from '@nestjs/common';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
import { Pool } from 'pg';
import crypto from 'node:crypto';
import { getPool, withTenantContextRaw } from '../../db/client.js';
import { getConfig } from '../../config/config.js';
import { generateOtpCode, hmacOtp, timingSafeEqual, generateRefreshToken, hashRefreshToken } from './crypto.js';
import { MESSAGING_PROVIDER, type MessagingProvider } from './messaging.provider.js';
import { TokenService, type CustomerJwtPayload } from './token.service.js';
import { ErrorCode } from '@dineflow/contracts';
import { domainError } from '../../common/errors/domain-error.js';
import type Redis from 'ioredis';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const OTP_TTL_SEC = 300;          // 5 minutes
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SEC = 30;
const OTP_PER_PHONE_PER_HOUR = 5;
const OTP_PER_IP_PER_HOUR = 10;

export interface OtpRequestResult {
  cooldownSeconds?: number;
  devCode?: string;
}

export interface OtpVerifyResult {
  accessToken: string;
  refreshToken: string;
  customerId: string;
  isNewCustomer: boolean;
  phone?: string;
  displayName?: string | null;
  loyaltyPoints?: number;
}

/**
 * Customer OTP authentication service.
 * Implements: send OTP, verify OTP, issue JWT, rate limiting via Redis.
 *
 * NEEDS_HUMAN_REVIEW: OTP rate limits, HMAC pepper usage
 * Reference: ARCH §12, AGENTS §3
 */
@Injectable()
export class CustomerOtpService {
  private readonly pool: Pool;

  constructor(
    private readonly tokenService: TokenService,
    @Inject(MESSAGING_PROVIDER) private readonly messaging: MessagingProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.pool = getPool();
  }

  /**
   * Normalize phone to E.164. Throws VALIDATION_ERROR if invalid.
   */
  normalizePhone(phone: string, defaultCountry = 'IN'): string {
    if (!isValidPhoneNumber(phone, defaultCountry as 'IN')) {
      throw domainError(ErrorCode.VALIDATION_ERROR, 'Invalid phone number.', 422);
    }
    return parsePhoneNumber(phone, defaultCountry as 'IN').format('E.164');
  }

  /**
   * Request an OTP for a phone number.
   * Enforces per-phone + per-IP rate limits via Redis token bucket.
   * Stores HMAC of code in Postgres.
   */
  async requestOtp(
    orgId: string,
    rawPhone: string,
    clientIp: string,
  ): Promise<OtpRequestResult> {
    const targetOrgId = orgId || '7762b6af-d052-4e74-b917-39e3c56e7914';
    const phone = this.normalizePhone(rawPhone);
    const config = getConfig();

    // ── Rate limits via Redis ──────────────────────────────────────────────
    await this._enforceRateLimit(`otp:phone:${targetOrgId}:${phone}`, OTP_PER_PHONE_PER_HOUR, 3600);
    await this._enforceRateLimit(`otp:ip:${this._hashIp(clientIp)}`, OTP_PER_IP_PER_HOUR, 3600);

    // ── Resend cooldown check via Redis ────────────────────────────────────
    const cooldownKey = `otp:cooldown:${targetOrgId}:${phone}`;
    const ttl = await this.redis.ttl(cooldownKey);
    if (ttl > 0) {
      throw domainError(ErrorCode.OTP_COOLDOWN, `Wait ${ttl} seconds before requesting a new code.`, 429, { cooldownSeconds: ttl });
    }

    // ── Generate + store OTP ───────────────────────────────────────────────
    const code = generateOtpCode(6);
    const codeHash = hmacOtp(code, config.OTP_HMAC_PEPPER);
    const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
    const ipHash = this._hashIp(clientIp);

    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [targetOrgId]);
      await client.query(
        `INSERT INTO customer_otp_codes (org_id, phone_e164, code_hash, expires_at, ip_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetOrgId, phone, codeHash, expiresAt, ipHash],
      );
    } finally {
      client.release();
    }

    // Set resend cooldown
    await this.redis.set(cooldownKey, '1', 'EX', OTP_RESEND_COOLDOWN_SEC);

    // Send OTP (mock in dev, real provider in prod)
    await this.messaging.sendOtp(phone, code, targetOrgId);

    return process.env['NODE_ENV'] !== 'production' ? { devCode: code } : {};
  }

  /**
   * Verify OTP code and issue tokens.
   * - Constant-time comparison
   * - Increments attempt counter; locks after max attempts
   * - Creates customer record on first verify (upsert)
   */
  async verifyOtp(
    orgId: string,
    rawPhone: string,
    code: string,
  ): Promise<OtpVerifyResult> {
    const targetOrgId = orgId || '7762b6af-d052-4e74-b917-39e3c56e7914';
    const phone = this.normalizePhone(rawPhone);
    const config = getConfig();

    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [targetOrgId]);

      // Find the most recent unverified, non-expired OTP
      const r = await client.query<{
        id: string;
        code_hash: string;
        attempts: number;
        expires_at: string;
        verified_at: string | null;
      }>(
        `SELECT id, code_hash, attempts, expires_at, verified_at
         FROM customer_otp_codes
         WHERE org_id = $1 AND phone_e164 = $2
           AND verified_at IS NULL
         ORDER BY sent_at DESC LIMIT 1`,
        [targetOrgId, phone],
      );

      const otp = r.rows[0];

      if (!otp) {
        throw domainError(ErrorCode.OTP_INVALID, 'No pending OTP found. Request a new code.', 401);
      }
      if (new Date(otp.expires_at) < new Date()) {
        throw domainError(ErrorCode.OTP_EXPIRED, 'OTP has expired. Request a new code.', 401);
      }
      if (otp.attempts >= OTP_MAX_ATTEMPTS) {
        throw domainError(ErrorCode.OTP_MAX_ATTEMPTS, 'Too many attempts. Request a new code.', 429);
      }

      // Increment attempts before comparison (prevents racing)
      await client.query(
        `UPDATE customer_otp_codes SET attempts = attempts + 1 WHERE id = $1`,
        [otp.id],
      );

      const incomingHash = hmacOtp(code, config.OTP_HMAC_PEPPER);
      if (!timingSafeEqual(incomingHash, otp.code_hash)) {
        const remaining = OTP_MAX_ATTEMPTS - (otp.attempts + 1);
        throw domainError(
          ErrorCode.OTP_INVALID,
          `Invalid code. ${remaining} attempt(s) remaining.`,
          401,
          { attemptsRemaining: remaining },
        );
      }

      // Mark as verified
      await client.query(
        `UPDATE customer_otp_codes SET verified_at = now() WHERE id = $1`,
        [otp.id],
      );

      // Upsert customer
      const custResult = await client.query<{ id: string; is_new: boolean }>(
        `INSERT INTO customers (org_id, phone_e164)
         VALUES ($1, $2)
         ON CONFLICT (org_id, phone_e164)
         DO UPDATE SET phone_verified_at = now(), updated_at = now()
         RETURNING id,
           (xmax = 0) AS is_new`,
        [targetOrgId, phone],
      );
      const { id: customerId, is_new: isNewCustomer } = custResult.rows[0]!;

      // Issue refresh token
      const rawRefresh = generateRefreshToken();
      const tokenHash = hashRefreshToken(rawRefresh);
      const familyId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO customer_refresh_tokens (org_id, customer_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetOrgId, customerId, tokenHash, familyId, expiresAt],
      );

      const payload: CustomerJwtPayload = {
        sub: customerId,
        org: targetOrgId,
        phone,
        type: 'customer_access',
      };
      const accessToken = this.tokenService.signAccessToken(payload);

      // Fetch customer display_name
      const profileRes = await client.query<{ display_name: string | null }>(
        `SELECT display_name FROM customers WHERE id = $1`,
        [customerId]
      );
      const displayName = profileRes.rows[0]?.display_name || null;

      // Fetch loyalty points balance
      const loyaltyRes = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(CASE WHEN entry_type = 'EARN' THEN amount_paise ELSE -amount_paise END), 0) as balance
         FROM loyalty_ledger WHERE org_id = $1 AND customer_id = $2`,
        [targetOrgId, customerId]
      );
      const loyaltyPoints = Number(loyaltyRes.rows[0]?.balance || 0);

      return {
        accessToken,
        refreshToken: rawRefresh,
        customerId,
        isNewCustomer,
        phone,
        displayName,
        loyaltyPoints,
      };
    } finally {
      client.release();
    }
  }

  async getProfile(orgId: string, customerId: string) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!customerId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Customer authentication required.', 401);
    }
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query<{
        id: string;
        phone_e164: string;
        display_name: string | null;
        created_at: string;
      }>(
        `SELECT id, phone_e164, display_name, created_at FROM customers WHERE org_id = $1 AND id = $2`,
        [orgId, customerId],
      );
      const cust = res.rows[0];
      if (!cust) {
        throw domainError(ErrorCode.NOT_FOUND, 'Customer profile not found.', 404);
      }
      const loyaltyRes = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(CASE WHEN entry_type = 'EARN' THEN amount_paise ELSE -amount_paise END), 0) as balance
         FROM loyalty_ledger WHERE org_id = $1 AND customer_id = $2`,
        [orgId, customerId],
      );
      const points = Number(loyaltyRes.rows[0]?.balance || 0);
      return {
        id: cust.id,
        phone: cust.phone_e164,
        displayName: cust.display_name || '',
        loyaltyPoints: points,
        loyaltyTier: points > 500 ? 'Platinum Diner' : points > 200 ? 'Gold VIP' : 'Silver Club',
        createdAt: cust.created_at,
      };
    });
  }

  async updateProfile(orgId: string, customerId: string, displayName: string) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!customerId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Customer authentication required.', 401);
    }
    await withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `UPDATE customers SET display_name = $1, updated_at = now() WHERE org_id = $2 AND id = $3`,
        [displayName, orgId, customerId],
      );
      if (res.rowCount === 0) {
        throw domainError(ErrorCode.NOT_FOUND, 'Customer profile not found.', 404);
      }
    });
    return this.getProfile(orgId, customerId);
  }

  // ─── Diner Profiles (Taste Preferences & Plate Personalization) ─────────────

  async listDinerProfiles(orgId: string, customerId: string) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!customerId) {
      return [];
    }
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `SELECT id, org_id, customer_id, name, relationship_tag, spice_preference,
                dietary_preference, kitchen_instructions, notes, preferences, created_at, updated_at
         FROM diner_profiles
         WHERE org_id = $1 AND customer_id = $2
         ORDER BY created_at ASC`,
        [orgId, customerId],
      );
      return res.rows;
    });
  }

  async createDinerProfile(
    orgId: string,
    customerId: string,
    dto: {
      name: string;
      relationshipTag?: string;
      spicePreference?: string;
      dietaryPreference?: string;
      kitchenInstructions?: string[];
      notes?: string;
      preferences?: Record<string, unknown>;
    },
  ) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!customerId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Customer authentication required.', 401);
    }
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `INSERT INTO diner_profiles
           (org_id, customer_id, name, relationship_tag, spice_preference,
            dietary_preference, kitchen_instructions, notes, preferences)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          orgId,
          customerId,
          dto.name,
          dto.relationshipTag ?? 'FRIEND',
          dto.spicePreference ?? 'MEDIUM',
          dto.dietaryPreference ?? 'ANY',
          dto.kitchenInstructions ?? [],
          dto.notes ?? null,
          JSON.stringify(dto.preferences ?? {}),
        ],
      );
      return res.rows[0];
    });
  }

  async updateDinerProfile(
    orgId: string,
    customerId: string,
    id: string,
    dto: {
      name?: string;
      relationshipTag?: string;
      spicePreference?: string;
      dietaryPreference?: string;
      kitchenInstructions?: string[];
      notes?: string;
      preferences?: Record<string, unknown>;
    },
  ) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!customerId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Customer authentication required.', 401);
    }
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `UPDATE diner_profiles
         SET name                = COALESCE($4, name),
             relationship_tag    = COALESCE($5, relationship_tag),
             spice_preference    = COALESCE($6, spice_preference),
             dietary_preference  = COALESCE($7, dietary_preference),
             kitchen_instructions = COALESCE($8, kitchen_instructions),
             notes               = COALESCE($9, notes),
             preferences         = COALESCE($10::jsonb, preferences),
             updated_at          = now()
         WHERE org_id = $1 AND id = $2 AND customer_id = $3
         RETURNING *`,
        [
          orgId,
          id,
          customerId,
          dto.name ?? null,
          dto.relationshipTag ?? null,
          dto.spicePreference ?? null,
          dto.dietaryPreference ?? null,
          dto.kitchenInstructions ?? null,
          dto.notes ?? null,
          dto.preferences ? JSON.stringify(dto.preferences) : null,
        ],
      );
      if (!res.rows[0]) {
        throw domainError(ErrorCode.NOT_FOUND, 'Diner profile not found.', 404);
      }
      return res.rows[0];
    });
  }

  async deleteDinerProfile(orgId: string, customerId: string, id: string) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!customerId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Customer authentication required.', 401);
    }
    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query(
        `DELETE FROM diner_profiles WHERE org_id = $1 AND id = $2 AND customer_id = $3`,
        [orgId, id, customerId],
      );
      if (res.rowCount === 0) {
        throw domainError(ErrorCode.NOT_FOUND, 'Diner profile not found.', 404);
      }
      return { success: true, id };
    });
  }

  /**
   * Rotate customer refresh token with reuse detection.
   */
  async refreshTokens(orgId: string, rawToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const tokenHash = hashRefreshToken(rawToken);
    const client = await this.pool.connect();
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const r = await client.query<{
        id: string;
        customer_id: string;
        family_id: string;
        is_revoked: boolean;
        expires_at: string;
      }>(
        `SELECT id, customer_id, family_id, is_revoked, expires_at
         FROM customer_refresh_tokens WHERE token_hash = $1 AND org_id = $2`,
        [tokenHash, orgId],
      );
      const stored = r.rows[0];
      if (!stored) {
        throw domainError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token.', 401);
      }
      if (stored.is_revoked || new Date(stored.expires_at) < new Date()) {
        if (stored.is_revoked) {
          // Reuse — revoke entire family
          await client.query(
            `UPDATE customer_refresh_tokens SET is_revoked = true WHERE family_id = $1 AND org_id = $2`,
            [stored.family_id, orgId],
          );
        }
        throw domainError(ErrorCode.TOKEN_REUSE_DETECTED, 'Token reuse detected. All sessions revoked.', 401);
      }

      // Revoke old
      await client.query(`UPDATE customer_refresh_tokens SET is_revoked = true WHERE id = $1`, [stored.id]);

      // Get customer phone for new token
      const custR = await client.query<{ phone_e164: string }>(
        `SELECT phone_e164 FROM customers WHERE id = $1 AND org_id = $2`,
        [stored.customer_id, orgId],
      );
      const phone = custR.rows[0]?.phone_e164 ?? '';

      // Issue new pair
      const rawRefresh = generateRefreshToken();
      const newHash = hashRefreshToken(rawRefresh);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await client.query(
        `INSERT INTO customer_refresh_tokens (org_id, customer_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, stored.customer_id, newHash, stored.family_id, expiresAt],
      );

      const payload: CustomerJwtPayload = {
        sub: stored.customer_id,
        org: orgId,
        phone,
        type: 'customer_access',
      };
      return { accessToken: this.tokenService.signAccessToken(payload), refreshToken: rawRefresh };
    } finally {
      client.release();
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async _enforceRateLimit(key: string, limit: number, windowSec: number): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, windowSec);
    }
    if (count > limit) {
      throw domainError(
        ErrorCode.RATE_LIMITED,
        'Too many OTP requests. Try again later.',
        429,
        { retryAfterSeconds: await this.redis.ttl(key) },
      );
    }
  }

  private _hashIp(ip: string): string {
    // One-way hash so raw IPs are never stored
    return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
  }
}
