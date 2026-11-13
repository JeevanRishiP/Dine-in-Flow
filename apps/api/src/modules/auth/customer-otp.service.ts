import { Inject, Injectable } from '@nestjs/common';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';
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
  email?: string | null;
  displayName?: string | null;
  loyaltyPoints?: number;
}

export interface GoogleLoginResult {
  registered: boolean;
  email: string;
  suggestedName?: string;
  googlePreRegToken?: string;
  accessToken?: string;
  refreshToken?: string;
  customerId?: string;
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
  constructor(
    private readonly tokenService: TokenService,
    @Inject(MESSAGING_PROVIDER) private readonly messaging: MessagingProvider,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

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
   * Stores HMAC of code in Postgres inside transactional RLS context.
   */
  async requestOtp(
    orgId: string,
    rawPhone: string,
    clientIp: string,
    opts?: { email?: string; mode?: 'LOGIN' | 'SIGNUP' },
  ): Promise<OtpRequestResult> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const targetOrgId = orgId;
    const phone = this.normalizePhone(rawPhone);
    const normalizedEmail = opts?.email?.trim().toLowerCase() || undefined;
    if (opts?.mode === 'SIGNUP' && !normalizedEmail) {
      throw domainError(ErrorCode.VALIDATION_ERROR, 'Email ID is required for registration.', 422);
    }

    if (normalizedEmail || opts?.mode === 'SIGNUP') {
      await withTenantContextRaw(targetOrgId, async (client) => {
        if (normalizedEmail) {
          const emailOwner = await client.query<{ phone_e164: string }>(
            `SELECT phone_e164 FROM customers WHERE org_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
            [targetOrgId, normalizedEmail],
          );
          if (emailOwner.rows[0] && emailOwner.rows[0].phone_e164 !== phone) {
            throw domainError(
              ErrorCode.CONFLICT,
              'This email ID is already linked to another mobile number.',
              409,
            );
          }
        }
        if (opts?.mode === 'SIGNUP') {
          const phoneRow = await client.query<{ email: string | null }>(
            `SELECT email FROM customers WHERE org_id = $1 AND phone_e164 = $2 LIMIT 1`,
            [targetOrgId, phone],
          );
          if (
            phoneRow.rows[0]?.email &&
            normalizedEmail &&
            phoneRow.rows[0].email.toLowerCase() !== normalizedEmail
          ) {
            throw domainError(
              ErrorCode.CONFLICT,
              'This mobile number is already registered with a different email ID. Please sign in.',
              409,
            );
          }
        }
      });
    }

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

    await withTenantContextRaw(targetOrgId, async (client) => {
      await client.query(
        `INSERT INTO customer_otp_codes (org_id, phone_e164, code_hash, expires_at, ip_hash)
         VALUES ($1, $2, $3, $4, $5)`,
        [targetOrgId, phone, codeHash, expiresAt, ipHash],
      );
    });

    // Set resend cooldown
    await this.redis.set(cooldownKey, '1', 'EX', OTP_RESEND_COOLDOWN_SEC);

    // Send OTP (mock in dev, real provider in prod)
    await this.messaging.sendOtp(phone, code, targetOrgId);

    const env = process.env['NODE_ENV'];
    return env === 'development' || env === 'test' ? { devCode: code } : {};
  }

  /**
   * Verify OTP code and issue tokens.
   * - Row-locked atomic attempt increment committed even on invalid guess
   * - Constant-time comparison
   * - Creates customer record on first verify (upsert)
   */
  async verifyOtp(
    orgId: string,
    rawPhone: string,
    code: string,
    opts?: { email?: string; googlePreRegToken?: string; displayName?: string },
  ): Promise<OtpVerifyResult> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const targetOrgId = orgId;
    const phone = this.normalizePhone(rawPhone);
    const config = getConfig();

    let resolvedEmail = opts?.email?.trim().toLowerCase() || null;
    let resolvedGoogleSub: string | null = null;
    let emailVerified = false;
    let suggestedName = opts?.displayName?.trim() || null;

    if (opts?.googlePreRegToken) {
      const preReg = this.tokenService.verifyGooglePreRegToken(opts.googlePreRegToken);
      if (!preReg || preReg.org !== targetOrgId) {
        throw domainError(ErrorCode.TOKEN_INVALID, 'Invalid or expired Google registration token.', 401);
      }
      resolvedEmail = preReg.email.trim().toLowerCase();
      resolvedGoogleSub = preReg.sub;
      emailVerified = true;
      if (!suggestedName && preReg.name) {
        suggestedName = preReg.name.trim();
      }
    }

    const outcome = await withTenantContextRaw(targetOrgId, async (client) => {
      // Lock the most recent unverified OTP row so parallel guesses serialize cleanly
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
         ORDER BY sent_at DESC LIMIT 1
         FOR UPDATE`,
        [targetOrgId, phone],
      );

      const otp = r.rows[0];
      if (!otp) {
        return { status: 'MISSING' as const };
      }
      if (new Date(otp.expires_at) < new Date()) {
        return { status: 'EXPIRED' as const };
      }

      const incRes = await client.query<{ attempts: number }>(
        `UPDATE customer_otp_codes
         SET attempts = attempts + 1
         WHERE id = $1 AND org_id = $2 AND attempts < $3 AND verified_at IS NULL
         RETURNING attempts`,
        [otp.id, targetOrgId, OTP_MAX_ATTEMPTS],
      );
      if (!incRes.rows[0]) {
        return { status: 'MAX_ATTEMPTS' as const };
      }

      const incomingHash = hmacOtp(code, config.OTP_HMAC_PEPPER);
      if (!timingSafeEqual(incomingHash, otp.code_hash)) {
        const remaining = Math.max(0, OTP_MAX_ATTEMPTS - incRes.rows[0].attempts);
        // Return instead of throwing inside TX so attempts + 1 commits to Postgres
        return { status: 'INVALID' as const, remaining };
      }

      // Check 1:1 email <-> mobile linkage invariant before creating/updating customer
      if (resolvedEmail) {
        const emailOwner = await client.query<{ phone_e164: string }>(
          `SELECT phone_e164 FROM customers WHERE org_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1`,
          [targetOrgId, resolvedEmail],
        );
        if (emailOwner.rows[0] && emailOwner.rows[0].phone_e164 !== phone) {
          return { status: 'EMAIL_CONFLICT' as const };
        }
      }

      const phoneRow = await client.query<{ email: string | null }>(
        `SELECT email FROM customers WHERE org_id = $1 AND phone_e164 = $2 LIMIT 1`,
        [targetOrgId, phone],
      );
      if (
        phoneRow.rows[0]?.email &&
        resolvedEmail &&
        phoneRow.rows[0].email.toLowerCase() !== resolvedEmail
      ) {
        return { status: 'PHONE_EMAIL_CONFLICT' as const };
      }

      // Mark as verified atomically
      const verifiedRes = await client.query<{ id: string }>(
        `UPDATE customer_otp_codes
         SET verified_at = now()
         WHERE id = $1 AND org_id = $2 AND verified_at IS NULL
         RETURNING id`,
        [otp.id, targetOrgId],
      );
      if (!verifiedRes.rows[0]) {
        return { status: 'MISSING' as const };
      }

      // Upsert customer with optional 1:1 email + google_sub linkage
      const custResult = await client.query<{ id: string; is_new: boolean }>(
        `INSERT INTO customers (org_id, phone_e164, email, email_verified, google_sub, display_name)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (org_id, phone_e164)
         DO UPDATE SET
           phone_verified_at = now(),
           email             = COALESCE(customers.email, EXCLUDED.email),
           email_verified    = customers.email_verified OR EXCLUDED.email_verified,
           google_sub        = COALESCE(customers.google_sub, EXCLUDED.google_sub),
           display_name      = COALESCE(customers.display_name, EXCLUDED.display_name),
           updated_at        = now()
         RETURNING id, (xmax = 0) AS is_new`,
        [targetOrgId, phone, resolvedEmail, emailVerified, resolvedGoogleSub, suggestedName],
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

      // Fetch customer display_name & email
      const profileRes = await client.query<{ display_name: string | null; email: string | null }>(
        `SELECT display_name, email FROM customers WHERE org_id = $1 AND id = $2`,
        [targetOrgId, customerId],
      );
      const displayName = profileRes.rows[0]?.display_name || null;
      const storedEmail = profileRes.rows[0]?.email || resolvedEmail || null;

      // Fetch loyalty points balance
      const loyaltyRes = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(CASE WHEN entry_type = 'EARN' THEN amount_paise ELSE -amount_paise END), 0) as balance
         FROM loyalty_ledger WHERE org_id = $1 AND customer_id = $2`,
        [targetOrgId, customerId],
      );
      const loyaltyPoints = Number(loyaltyRes.rows[0]?.balance || 0);

      return {
        status: 'OK' as const,
        result: {
          accessToken,
          refreshToken: rawRefresh,
          customerId,
          isNewCustomer,
          phone,
          email: storedEmail,
          displayName,
          loyaltyPoints,
        },
      };
    });

    if (outcome.status === 'MISSING') {
      throw domainError(ErrorCode.OTP_INVALID, 'No pending OTP found. Request a new code.', 401);
    }
    if (outcome.status === 'EXPIRED') {
      throw domainError(ErrorCode.OTP_EXPIRED, 'OTP has expired. Request a new code.', 401);
    }
    if (outcome.status === 'MAX_ATTEMPTS') {
      throw domainError(ErrorCode.OTP_MAX_ATTEMPTS, 'Too many attempts. Request a new code.', 429);
    }
    if (outcome.status === 'EMAIL_CONFLICT') {
      throw domainError(
        ErrorCode.CONFLICT,
        'This email ID is already linked to a different mobile number.',
        409,
      );
    }
    if (outcome.status === 'PHONE_EMAIL_CONFLICT') {
      throw domainError(
        ErrorCode.CONFLICT,
        'This mobile number is already linked to a different email ID.',
        409,
      );
    }
    if (outcome.status === 'INVALID') {
      throw domainError(
        ErrorCode.OTP_INVALID,
        `Invalid code. ${outcome.remaining} attempt(s) remaining.`,
        401,
        { attemptsRemaining: outcome.remaining },
      );
    }
    return outcome.result;
  }

  /**
   * Sign in with Google OAuth ID token (or dev test email when GOOGLE_CLIENT_ID is unset in dev).
   * - If the email or google_sub is already registered in this org -> issues access + refresh tokens.
   * - If not registered -> returns registered=false + short-lived googlePreRegToken for mobile OTP signup.
   */
  async loginWithGoogle(
    orgId: string,
    dto: { idToken?: string; devMockEmail?: string; devMockName?: string },
  ): Promise<GoogleLoginResult> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    const config = getConfig();
    let email = '';
    let googleSub = '';
    let suggestedName = '';

    if (dto.idToken) {
      if (config.NODE_ENV === 'production' && !config.GOOGLE_CLIENT_ID) {
        throw domainError(ErrorCode.INTERNAL_ERROR, 'GOOGLE_CLIENT_ID is required in production.', 500);
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      try {
        const res = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(dto.idToken)}`,
          { signal: controller.signal },
        );
        if (!res.ok) {
          throw domainError(ErrorCode.UNAUTHORIZED, 'Invalid Google ID token.', 401);
        }
        const info = (await res.json()) as {
          sub?: string;
          email?: string;
          email_verified?: string | boolean;
          aud?: string;
          name?: string;
          exp?: string;
        };
        if (config.GOOGLE_CLIENT_ID && info.aud !== config.GOOGLE_CLIENT_ID) {
          throw domainError(ErrorCode.UNAUTHORIZED, 'Google token audience mismatch.', 401);
        }
        const isVerified = info.email_verified === true || info.email_verified === 'true';
        if (!info.sub || !info.email || !isVerified) {
          throw domainError(ErrorCode.UNAUTHORIZED, 'Google account email must be verified.', 401);
        }
        if (info.exp && Number(info.exp) * 1000 < Date.now()) {
          throw domainError(ErrorCode.TOKEN_EXPIRED, 'Google token has expired.', 401);
        }
        email = info.email.trim().toLowerCase();
        googleSub = info.sub;
        suggestedName = info.name?.trim() || '';
      } catch (err) {
        if ((err as { status?: number })?.status) throw err;
        throw domainError(ErrorCode.UNAUTHORIZED, 'Unable to verify Google token.', 401);
      } finally {
        clearTimeout(timer);
      }
    } else if (
      dto.devMockEmail &&
      (config.NODE_ENV === 'development' || config.NODE_ENV === 'test') &&
      !config.GOOGLE_CLIENT_ID
    ) {
      email = dto.devMockEmail.trim().toLowerCase();
      googleSub = `dev:${email}`;
      suggestedName = dto.devMockName?.trim() || email.split('@')[0] || 'Guest';
    } else {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Valid Google ID token is required.', 401);
    }

    return withTenantContextRaw(orgId, async (client) => {
      const custRes = await client.query<{
        id: string;
        phone_e164: string;
        email: string | null;
        display_name: string | null;
      }>(
        `SELECT id, phone_e164, email, display_name
         FROM customers
         WHERE org_id = $1 AND (google_sub = $2 OR LOWER(email) = LOWER($3))
         LIMIT 1`,
        [orgId, googleSub, email],
      );

      const existing = custRes.rows[0];
      if (!existing) {
        const googlePreRegToken = this.tokenService.signGooglePreRegToken({
          sub: googleSub,
          org: orgId,
          email,
          name: suggestedName || undefined,
        });
        return {
          registered: false,
          email,
          suggestedName,
          googlePreRegToken,
        };
      }

      await client.query(
        `UPDATE customers
         SET google_sub     = COALESCE(google_sub, $3),
             email          = COALESCE(email, $4),
             email_verified = true,
             display_name   = COALESCE(display_name, $5),
             updated_at     = now()
         WHERE org_id = $1 AND id = $2`,
        [orgId, existing.id, googleSub, email, suggestedName || null],
      );

      const rawRefresh = generateRefreshToken();
      const tokenHash = hashRefreshToken(rawRefresh);
      const familyId = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      await client.query(
        `INSERT INTO customer_refresh_tokens (org_id, customer_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, existing.id, tokenHash, familyId, expiresAt],
      );

      const accessToken = this.tokenService.signAccessToken({
        sub: existing.id,
        org: orgId,
        phone: existing.phone_e164,
        type: 'customer_access',
      });

      const loyaltyRes = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(CASE WHEN entry_type = 'EARN' THEN amount_paise ELSE -amount_paise END), 0) as balance
         FROM loyalty_ledger WHERE org_id = $1 AND customer_id = $2`,
        [orgId, existing.id],
      );

      return {
        registered: true,
        accessToken,
        refreshToken: rawRefresh,
        customerId: existing.id,
        phone: existing.phone_e164,
        email: existing.email || email,
        displayName: existing.display_name || suggestedName || null,
        loyaltyPoints: Number(loyaltyRes.rows[0]?.balance || 0),
      };
    });
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
        email: string | null;
        email_verified: boolean;
        display_name: string | null;
        created_at: string;
      }>(
        `SELECT id, phone_e164, email, email_verified, display_name, created_at FROM customers WHERE org_id = $1 AND id = $2`,
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
        email: cust.email || null,
        emailVerified: Boolean(cust.email_verified),
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
      await client.query(`SELECT set_config('app.customer_id', $1, true)`, [customerId]);
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
      await client.query(`SELECT set_config('app.customer_id', $1, true)`, [customerId]);
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
      await client.query(`SELECT set_config('app.customer_id', $1, true)`, [customerId]);
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
      await client.query(`SELECT set_config('app.customer_id', $1, true)`, [customerId]);
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
   * Rotate customer refresh token with atomic claim + reuse detection.
   */
  async refreshTokens(
    orgId: string,
    rawToken: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    customerId: string;
    phone: string;
    email: string | null;
    displayName: string | null;
    loyaltyPoints: number;
  }> {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Tenant context required.', 401);
    }
    if (!rawToken || rawToken.length < 10) {
      throw domainError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token.', 401);
    }
    const tokenHash = hashRefreshToken(rawToken);
    const rawRefresh = generateRefreshToken();
    const newHash = hashRefreshToken(rawRefresh);
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const outcome = await withTenantContextRaw(orgId, async (client) => {
      const r = await client.query<{
        id: string;
        customer_id: string;
        family_id: string;
        is_revoked: boolean;
        expires_at: string;
      }>(
        `SELECT id, customer_id, family_id, is_revoked, expires_at
         FROM customer_refresh_tokens WHERE token_hash = $1 AND org_id = $2
         FOR UPDATE`,
        [tokenHash, orgId],
      );
      const stored = r.rows[0];
      if (!stored) {
        return { status: 'INVALID' as const };
      }
      if (stored.is_revoked) {
        await client.query(
          `UPDATE customer_refresh_tokens SET is_revoked = true WHERE family_id = $1 AND org_id = $2`,
          [stored.family_id, orgId],
        );
        return { status: 'REUSED' as const };
      }
      if (new Date(stored.expires_at) < new Date()) {
        return { status: 'EXPIRED' as const };
      }

      const claimed = await client.query<{ id: string }>(
        `UPDATE customer_refresh_tokens
         SET is_revoked = true
         WHERE id = $1 AND org_id = $2 AND is_revoked = false
         RETURNING id`,
        [stored.id, orgId],
      );
      if (claimed.rowCount === 0) {
        await client.query(
          `UPDATE customer_refresh_tokens SET is_revoked = true WHERE family_id = $1 AND org_id = $2`,
          [stored.family_id, orgId],
        );
        return { status: 'REUSED' as const };
      }

      const custR = await client.query<{
        phone_e164: string;
        email: string | null;
        display_name: string | null;
      }>(
        `SELECT phone_e164, email, display_name FROM customers WHERE id = $1 AND org_id = $2`,
        [stored.customer_id, orgId],
      );
      const phone = custR.rows[0]?.phone_e164 ?? '';
      const email = custR.rows[0]?.email ?? null;
      const displayName = custR.rows[0]?.display_name ?? null;

      await client.query(
        `INSERT INTO customer_refresh_tokens (org_id, customer_id, token_hash, family_id, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [orgId, stored.customer_id, newHash, stored.family_id, expiresAt],
      );

      const loyaltyRes = await client.query<{ balance: string }>(
        `SELECT COALESCE(SUM(CASE WHEN entry_type = 'EARN' THEN amount_paise ELSE -amount_paise END), 0) as balance
         FROM loyalty_ledger WHERE org_id = $1 AND customer_id = $2`,
        [orgId, stored.customer_id],
      );
      const loyaltyPoints = Number(loyaltyRes.rows[0]?.balance || 0);

      const payload: CustomerJwtPayload = {
        sub: stored.customer_id,
        org: orgId,
        phone,
        type: 'customer_access',
      };
      return {
        status: 'OK' as const,
        accessToken: this.tokenService.signAccessToken(payload),
        refreshToken: rawRefresh,
        customerId: stored.customer_id,
        phone,
        email,
        displayName,
        loyaltyPoints,
      };
    });

    if (outcome.status === 'INVALID') {
      throw domainError(ErrorCode.TOKEN_INVALID, 'Invalid refresh token.', 401);
    }
    if (outcome.status === 'REUSED' || outcome.status === 'EXPIRED') {
      throw domainError(ErrorCode.TOKEN_REUSE_DETECTED, 'Token reuse detected. All sessions revoked.', 401);
    }
    return {
      accessToken: outcome.accessToken,
      refreshToken: outcome.refreshToken,
      customerId: outcome.customerId,
      phone: outcome.phone,
      email: outcome.email,
      displayName: outcome.displayName,
      loyaltyPoints: outcome.loyaltyPoints,
    };
  }

  async logoutSession(orgId: string, rawToken?: string): Promise<{ success: boolean }> {
    if (!orgId || !rawToken || rawToken.length < 10) {
      return { success: true };
    }
    const tokenHash = hashRefreshToken(rawToken);
    await withTenantContextRaw(orgId, async (client) => {
      const r = await client.query<{ family_id: string }>(
        `SELECT family_id FROM customer_refresh_tokens WHERE token_hash = $1 AND org_id = $2 LIMIT 1`,
        [tokenHash, orgId],
      );
      if (r.rows[0]?.family_id) {
        await client.query(
          `UPDATE customer_refresh_tokens SET is_revoked = true WHERE family_id = $1 AND org_id = $2`,
          [r.rows[0].family_id, orgId],
        );
      }
    });
    return { success: true };
  }

  /**
   * When a guest who placed orders under an active df_temp_cust cookie signs into
   * their account on the same device, claim ONLY those unowned guest orders onto their account.
   */
  async claimTempCustomerCookieOrders(
    orgId: string,
    customerId: string,
    tempCustomerCookie?: string,
  ): Promise<void> {
    if (!orgId || !customerId || !tempCustomerCookie) return;
    const decoded = this.tokenService.verifyTempCustomerToken?.(tempCustomerCookie);
    if (!decoded || decoded.org !== orgId) return;

    await withTenantContextRaw(orgId, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM temp_customers WHERE id = $1 AND org_id = $2 AND status = 'ACTIVE'`,
        [decoded.sub, orgId],
      );
      if (!rows[0]) return;
      await client.query(
        `UPDATE orders SET customer_id = $1, updated_at = now()
         WHERE org_id = $2 AND temp_customer_id = $3 AND customer_id IS NULL`,
        [customerId, orgId, decoded.sub],
      );
      await client.query(
        `UPDATE table_sessions SET customer_id = $1, updated_at = now()
         WHERE org_id = $2 AND temp_customer_id = $3 AND customer_id IS NULL`,
        [customerId, orgId, decoded.sub],
      );
    });
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
