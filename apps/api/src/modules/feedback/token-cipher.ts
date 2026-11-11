import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommended for GCM

/**
 * Derives a 32-byte buffer key from a string or buffer.
 */
function deriveKey(secret: string | Buffer): Buffer {
  if (Buffer.isBuffer(secret) && secret.length === 32) {
    return secret;
  }
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Encrypts a string (e.g. Google OAuth refresh token) using AES-256-GCM.
 * Output format: `<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`
 *
 * Reference: ARCH §19 (Google OAuth tokens encrypted at rest)
 */
export function encryptToken(plainText: string, secretKey: string | Buffer): string {
  if (!plainText) {
    throw new Error('Plaintext cannot be empty');
  }
  const key = deriveKey(secretKey);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted token string.
 *
 * Reference: ARCH §19
 */
export function decryptToken(cipherText: string, secretKey: string | Buffer): string {
  if (!cipherText) {
    throw new Error('Ciphertext cannot be empty');
  }
  const parts = cipherText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid ciphertext format. Expected iv:authTag:encrypted');
  }

  const ivHex = parts[0];
  const authTagHex = parts[1];
  const encryptedHex = parts[2];
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid ciphertext format. Expected iv:authTag:encrypted');
  }

  const key = deriveKey(secretKey);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decryptedPart1 = decipher.update(encryptedHex, 'hex', 'utf8');
  const decryptedPart2 = decipher.final('utf8');

  return decryptedPart1 + decryptedPart2;
}
