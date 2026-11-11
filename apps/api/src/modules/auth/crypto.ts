import crypto from 'node:crypto';
import { hash as argon2hash, verify as argon2verify, argon2id, type HashOptions } from 'argon2';

/**
 * Password hashing with argon2id.
 * Parameters follow OWASP recommendations for interactive use (2024).
 * Reference: ARCH §12, AGENTS §2 rule 1
 */
const ARGON2_OPTIONS: HashOptions = {
  type: argon2id, // = 2
  memoryCost: 65536, // 64 MiB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2verify(hash, password);
  } catch {
    return false;
  }
}

/**
 * OTP code hashing with HMAC-SHA256.
 * The pepper is a server-side secret so a DB breach alone cannot brute-force codes.
 * Reference: ARCH §12
 */
export function hmacOtp(code: string, pepper: string): string {
  return crypto.createHmac('sha256', pepper).update(code).digest('hex');
}

/**
 * Constant-time comparison to prevent timing attacks on code comparison.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generate a cryptographically secure random OTP code.
 */
export function generateOtpCode(digits = 6): string {
  const max = Math.pow(10, digits);
  const min = Math.pow(10, digits - 1);
  const range = max - min;
  let num: number;
  do {
    const buf = crypto.randomBytes(4);
    num = buf.readUInt32BE(0);
  } while (num >= Math.floor((2 ** 32 / range) * range));
  return String(min + (num % range)).padStart(digits, '0');
}

/**
 * SHA-256 hash a refresh token for storage.
 * Raw token is never stored — only the hash.
 */
export function hashRefreshToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/**
 * Generate a cryptographically secure refresh token (32 bytes = 256 bits of entropy).
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Generate a cryptographically secure TOTP recovery code (8 hex chars × 4 groups).
 */
export function generateRecoveryCode(): string {
  return [
    crypto.randomBytes(4).toString('hex'),
    crypto.randomBytes(4).toString('hex'),
    crypto.randomBytes(4).toString('hex'),
    crypto.randomBytes(4).toString('hex'),
  ].join('-');
}

/**
 * Hash a recovery code for storage (case and dash insensitive).
 */
export function hashRecoveryCode(code: string): string {
  return crypto.createHash('sha256').update(code.toLowerCase().replace(/-/g, '')).digest('hex');
}
