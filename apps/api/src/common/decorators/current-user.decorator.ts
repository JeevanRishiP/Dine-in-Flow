import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from '../../modules/auth/token.service.js';

/**
 * Extract the authenticated principal from request.user.
 * Usage: @CurrentUser() user: JwtPayload
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): JwtPayload => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest & { user: JwtPayload }>();
    return request.user;
  },
);
