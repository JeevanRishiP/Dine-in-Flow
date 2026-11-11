import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PERMISSION_KEY, PUBLIC_KEY } from '../decorators/auth.decorators.js';
import { TokenService } from '../../modules/auth/token.service.js';
import { ROLE_PERMISSIONS, Permission } from '@dineflow/contracts';
import type { JwtPayload } from '../../modules/auth/token.service.js';
import { ErrorCode } from '@dineflow/contracts';
import type { DomainError } from '../errors/domain-error.js';

/**
 * Global RBAC guard — applied to every route.
 *
 * Flow:
 * 1. If @Public() → allow through
 * 2. Extract + verify Bearer JWT
 * 3. If @Require(permission) → check the caller's role has that permission
 * 4. If neither @Public nor @Require → DENY (default deny, AGENTS §2 rule 4)
 *
 * NEEDS_HUMAN_REVIEW: guard logic, default deny behaviour
 * Reference: ARCH §12, AGENTS §2 rule 4, §3
 */
@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokenService: TokenService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Check @Require(permission)
    const requiredPermission = this.reflector.getAllAndOverride<Permission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    const request = context.switchToHttp().getRequest<FastifyRequest & { user?: JwtPayload }>();
    const token = this.extractBearerToken(request);

    if (!token) {
      const err: DomainError = { code: ErrorCode.UNAUTHORIZED, message: 'Missing or malformed Authorization header.', status: 401 };
      throw err;
    }

    const payload = this.tokenService.verifyAccessToken(token);
    if (!payload) {
      const err: DomainError = { code: ErrorCode.TOKEN_INVALID, message: 'Access token is invalid or expired.', status: 401 };
      throw err;
    }

    // Attach principal to request for downstream use
    request.user = payload;

    // If no permission required but we have a valid token, allow
    // This shouldn't happen (default deny) — but is a safe fallback
    if (!requiredPermission) {
      // No @Require() and no @Public() → DENY (enforce declaration)
      const err: DomainError = {
        code: ErrorCode.FORBIDDEN,
        message: 'This route has no permission declared. Contact the API owner.',
        status: 403,
      };
      throw err;
    }

    // Guest table-session tokens may ONLY access guest-session endpoints
    if (payload.type === 'guest_session') {
      if (requiredPermission === Permission.GUEST_SESSION) {
        return true;
      }
      const err: DomainError = { code: ErrorCode.FORBIDDEN, message: 'Guest session tokens cannot access staff or account resources.', status: 403 };
      throw err;
    }

    // Customer tokens never get staff permissions — only customer-scoped permissions
    if (payload.type === 'customer_access') {
      if (
        requiredPermission === Permission.CUSTOMER_READ ||
        requiredPermission === Permission.CUSTOMER_UPDATE ||
        requiredPermission === Permission.GUEST_SESSION
      ) {
        return true;
      }
      const err: DomainError = { code: ErrorCode.FORBIDDEN, message: 'Customer tokens cannot access staff resources.', status: 403 };
      throw err;
    }

    // Check role → permission
    const role = payload.role;
    const allowed = (ROLE_PERMISSIONS[role] ?? []) as Permission[];
    if (!allowed.includes(requiredPermission)) {
      const err: DomainError = {
        code: ErrorCode.FORBIDDEN,
        message: `Role '${role}' does not have permission '${requiredPermission}'.`,
        status: 403,
      };
      throw err;
    }

    return true;
  }

  private extractBearerToken(request: FastifyRequest): string | null {
    const auth = request.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return null;
    return auth.slice(7);
  }
}
