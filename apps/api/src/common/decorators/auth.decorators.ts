import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Permission } from '@dineflow/contracts';
import type { JwtPayload } from '../../modules/auth/token.service.js';

export const PERMISSION_KEY = 'required_permission';
export const PUBLIC_KEY = 'is_public';

/**
 * Declare the permission required to access an endpoint.
 * Every route MUST have either @Require() or @Public().
 * The RBAC guard enforces this at runtime; a test enforces it at CI time.
 * Reference: ARCH §12, AGENTS §2 rule 4
 */
export const Require = (permission: Permission) =>
  SetMetadata(PERMISSION_KEY, permission);

/**
 * Mark a route as publicly accessible (no auth required).
 * Must be explicit — default is deny.
 * Reference: AGENTS §2 rule 4
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Param decorator — injects the verified JWT payload into a controller method param.
 * Only call on routes protected by @Require() (i.e. where the RBAC guard has run).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    return request.user;
  },
);

/** Convenient aliases — re-export so controllers can import from one place. */
export type {
  StaffJwtPayload,
  CustomerJwtPayload,
  GuestSessionJwtPayload,
  JwtPayload,
} from '../../modules/auth/token.service.js';
