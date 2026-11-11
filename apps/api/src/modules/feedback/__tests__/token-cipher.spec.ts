import { describe, it, expect } from 'vitest';
import { encryptToken, decryptToken } from '../token-cipher.js';

describe('Token Cipher (AES-256-GCM)', () => {
  const secretKey = 'super-secret-secure-key-32-bytes!';
  const plainToken = 'ya29.a0ARrdaM8sample-oauth-refresh-token-for-gbp';

  it('encrypts and decrypts a token correctly', () => {
    const encrypted = encryptToken(plainToken, secretKey);
    expect(encrypted).not.toEqual(plainToken);
    expect(encrypted.split(':')).toHaveLength(3); // iv:authTag:encrypted

    const decrypted = decryptToken(encrypted, secretKey);
    expect(decrypted).toEqual(plainToken);
  });

  it('produces distinct ciphertexts for identical plaintexts (random IV)', () => {
    const enc1 = encryptToken(plainToken, secretKey);
    const enc2 = encryptToken(plainToken, secretKey);
    expect(enc1).not.toEqual(enc2);

    expect(decryptToken(enc1, secretKey)).toEqual(plainToken);
    expect(decryptToken(enc2, secretKey)).toEqual(plainToken);
  });

  it('fails decryption when using the wrong key', () => {
    const encrypted = encryptToken(plainToken, secretKey);
    const wrongKey = 'completely-wrong-key-32-bytes-here!';

    expect(() => decryptToken(encrypted, wrongKey)).toThrow();
  });

  it('fails decryption when the ciphertext is tampered with (auth tag integrity)', () => {
    const encrypted = encryptToken(plainToken, secretKey);
    const parts = encrypted.split(':');
    // Tamper with ciphertext by altering last char
    const lastChar = parts[2]?.slice(-1) || '0';
    const flippedChar = lastChar === 'a' ? 'b' : 'a';
    const tampered = `${parts[0]}:${parts[1]}:${parts[2]?.slice(0, -1)}${flippedChar}`;

    expect(() => decryptToken(tampered, secretKey)).toThrow();
  });

  it('fails decryption when the auth tag is tampered with', () => {
    const encrypted = encryptToken(plainToken, secretKey);
    const parts = encrypted.split(':');
    const tamperedAuthTag = parts[1]?.split('').reverse().join('');
    const tampered = `${parts[0]}:${tamperedAuthTag}:${parts[2]}`;

    expect(() => decryptToken(tampered, secretKey)).toThrow();
  });

  it('rejects empty plaintext or invalid ciphertext format', () => {
    expect(() => encryptToken('', secretKey)).toThrow();
    expect(() => decryptToken('', secretKey)).toThrow();
    expect(() => decryptToken('invalid-format', secretKey)).toThrow();
  });
});
