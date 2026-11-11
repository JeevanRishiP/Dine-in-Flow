import { ErrorCode } from '@dineflow/contracts';

/**
 * Typed domain errors that the exception filter converts to RFC 7807 responses.
 * Throw these from services; never throw raw HTTP exceptions.
 * Reference: ARCH §13
 */
export interface DomainError {
  code: ErrorCode;
  message: string;
  status: number;
  details?: Record<string, unknown>;
}

export function isDomainError(err: unknown): err is DomainError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'message' in err &&
    'status' in err
  );
}

export function domainError(
  code: ErrorCode,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): DomainError {
  return { code, message, status, details };
}
