import { ErrorCode } from '@dineflow/contracts';
import { domainError } from '../errors/domain-error.js';

/**
 * Enforces outlet-level scoping for staff tokens that carry a non-null `outletId`.
 * Org-wide staff (`userOutletId === undefined`, e.g. OWNER) may access any outlet in their org;
 * outlet-scoped staff (`MANAGER`, `CASHIER`, `KITCHEN`, `CAPTAIN`, `WAITER`) are restricted to
 * their assigned outlet.
 */
export function resolveScopedOutletId(
  userOutletId: string | undefined,
  requestedOutletId?: string | null,
): string | undefined {
  if (!userOutletId) {
    return requestedOutletId ?? undefined;
  }
  if (requestedOutletId && requestedOutletId !== userOutletId) {
    throw domainError(
      ErrorCode.FORBIDDEN,
      'Access denied for the requested outlet.',
      403,
    );
  }
  return userOutletId;
}

/**
 * Asserts a resource record belongs to the staff member's assigned outlet (if outlet-scoped).
 */
export function assertStaffOutletAccess(
  userOutletId: string | undefined,
  resourceOutletId: string | null | undefined,
): void {
  if (!userOutletId) return;
  if (!resourceOutletId || resourceOutletId !== userOutletId) {
    throw domainError(
      ErrorCode.FORBIDDEN,
      'Access denied for this outlet resource.',
      403,
    );
  }
}
