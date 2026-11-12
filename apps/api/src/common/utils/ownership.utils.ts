import { ErrorCode } from '@dineflow/contracts';
import { domainError } from '../errors/domain-error.js';
import type { CustomerJwtPayload, GuestSessionJwtPayload } from '../../modules/auth/token.service.js';

export interface CustomerAccessScope {
  sessionId?: string;
  customerId?: string;
}

export interface OrderOwnershipFields {
  session_id?: string | null;
  customer_id?: string | null;
  session_customer_id?: string | null;
}

/**
 * Derive an ownership verification scope from a verified guest-session or customer JWT.
 */
export function toCustomerAccessScope(
  user: GuestSessionJwtPayload | CustomerJwtPayload,
): CustomerAccessScope {
  if (user.type === 'guest_session') {
    return { sessionId: user.sessionId, customerId: user.customerId };
  }
  return { customerId: user.sub };
}

/**
 * Verify that an order / session / payment belongs to the caller's verified scope.
 * Throws 403 FORBIDDEN on mismatch to prevent cross-table and cross-customer IDOR.
 */
export function assertCustomerAccessScope(
  scope: CustomerAccessScope | undefined,
  record: OrderOwnershipFields,
): void {
  if (!scope) return;

  if (scope.sessionId) {
    if (record.session_id !== scope.sessionId) {
      throw domainError(ErrorCode.FORBIDDEN, 'Access denied for this table session.', 403);
    }
    return;
  }

  if (scope.customerId) {
    if (
      record.customer_id === scope.customerId ||
      record.session_customer_id === scope.customerId
    ) {
      return;
    }
  }

  throw domainError(ErrorCode.FORBIDDEN, 'You do not have permission to access this resource.', 403);
}

