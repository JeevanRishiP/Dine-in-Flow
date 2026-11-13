import { Controller, Post, Body, Headers, Ip, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Public } from '../../common/decorators/auth.decorators.js';
import { StaffAuthService } from './staff-auth.service.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Require } from '../../common/decorators/auth.decorators.js';
import type { StaffJwtPayload } from './token.service.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';

// ─── Request DTOs ────────────────────────────────────────────────────────────

const StaffLoginSchema = z.object({
  orgSlug: z.string().trim().optional(),
  username: z.string().trim().min(1).optional(),
  email: z.string().trim().min(1).optional(),
  password: z.string().min(4),
}).strict();

const MfaVerifySchema = z.object({
  preMfaToken: z.string().min(20),
  code: z.string().min(6).max(32),
}).strict();

const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
}).strict();

class StaffLoginDto extends createZodDto(StaffLoginSchema) {}
class MfaVerifyDto extends createZodDto(MfaVerifySchema) {}
class RefreshDto extends createZodDto(RefreshSchema) {}

/**
 * Staff authentication endpoints.
 * All routes are either @Public() (login/refresh) or require a valid staff token.
 * Reference: ARCH §12
 */
@Controller('auth/staff')
export class StaffAuthController {
  constructor(private readonly staffAuth: StaffAuthService) {}

  /**
   * POST /v1/auth/staff/login
   * Simple username (or email) + password login. Workspace slug is optional.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() dto: StaffLoginDto,
    @Headers('x-org-id') orgId: string,
    @Ip() clientIp: string,
  ) {
    const identifier = dto.username?.trim() || dto.email?.trim() || '';
    if (!identifier) {
      throw domainError(ErrorCode.VALIDATION_ERROR, 'Username or email is required.', 400);
    }
    return this.staffAuth.loginWithOptionalOrg({
      orgId: orgId || undefined,
      orgSlug: dto.orgSlug?.trim() || undefined,
      identifier,
      password: dto.password,
      clientIp,
    });
  }

  /**
   * POST /v1/auth/staff/mfa/verify
   * Step 2 (only if requiresMfa=true): preMfaToken + TOTP or recovery code.
   */
  @Public()
  @Post('mfa/verify')
  @HttpCode(200)
  async verifyMfa(@Body() dto: MfaVerifyDto, @Ip() clientIp: string) {
    return this.staffAuth.verifyMfa(dto.preMfaToken, dto.code, clientIp);
  }

  /**
   * POST /v1/auth/staff/refresh
   * Rotate refresh token — issues new access + refresh pair.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Body() dto: RefreshDto, @Headers('x-org-id') orgId: string) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'x-org-id header required.', 401);
    }
    return this.staffAuth.refreshTokens(orgId, dto.refreshToken);
  }

  /**
   * POST /v1/auth/staff/logout
   * Revoke current session.
   */
  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Body() dto: RefreshDto, @Headers('x-org-id') orgId: string) {
    if (!orgId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'x-org-id header required.', 401);
    }
    await this.staffAuth.revokeSession(orgId, dto.refreshToken);
  }

  /**
   * POST /v1/auth/staff/logout-all
   * Revoke all sessions for the current user.
   */
  @Post('logout-all')
  @Require('org:read') // Any authenticated staff member can logout themselves
  @HttpCode(204)
  async logoutAll(@CurrentUser() user: StaffJwtPayload) {
    await this.staffAuth.revokeAllSessions(user.org, user.sub);
  }
}
