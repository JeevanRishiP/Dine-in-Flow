/**
 * Menu Image Resolution & Safe Normalization Utilities
 * Ensures photos uploaded in the Owner Console route cleanly through the Next.js API rewrite
 * to the backend static photo endpoint.
 */

export const FALLBACK_DISH_IMG =
  'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=600&q=80';

/**
 * Resolves a menu item's raw image URL into a fully-routable URL.
 * Handles:
 * - Empty / null / whitespace: returns fallback dish image.
 * - Base64 data URLs ('data:') and blob URLs ('blob:'): returns as-is.
 * - Absolute URLs ('http://', 'https://'): returns as-is.
 * - Relative backend static photo endpoints:
 *   - '/v1/public/menu/photos/...' -> '/api/v1/public/menu/photos/...'
 *   - 'v1/public/menu/photos/...'  -> '/api/v1/public/menu/photos/...'
 *   - '/api/v1/public/menu/photos/...' -> unchanged (proxied by Next.js rewrite)
 * - Safe fallback for malformed strings.
 */
export function resolveDishImageUrl(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return FALLBACK_DISH_IMG;
  const trimmed = rawUrl.trim();
  if (!trimmed) return FALLBACK_DISH_IMG;

  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }

  // Relative backend photo path normalization for Next.js rewrites
  if (trimmed.startsWith('/v1/')) {
    return `/api${trimmed}`;
  }
  if (trimmed.startsWith('v1/')) {
    return `/api/${trimmed}`;
  }
  if (trimmed.startsWith('/api/')) {
    return trimmed;
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}
