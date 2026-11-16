import { loadGuestSession, resolveTenantIds } from '../../app/lib/guest-session.ts';

/**
 * Normalizes user-entered phone number to E.164-style format (+91 prefix for Indian numbers).
 */
export function formatNormalizedPhone(raw: string): string {
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  return cleaned.startsWith('+') ? cleaned : `+91${cleaned}`;
}

/**
 * Validates whether the given phone number conforms to 10-15 digit E.164 phone specification.
 */
export function isValidPhoneNumber(phone: string): boolean {
  const formatted = formatNormalizedPhone(phone);
  return /^\+\d{10,15}$/.test(formatted);
}

/**
 * Validates simple email structure.
 */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Validates 6-digit numeric OTP.
 */
export function isValidOtp(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}

/**
 * Resolves the active organization ID for customer authentication.
 */
export function resolveCustomerAuthOrgId(activeOrgId?: string): string {
  const tenant = resolveTenantIds(loadGuestSession());
  return activeOrgId || tenant.orgId;
}
