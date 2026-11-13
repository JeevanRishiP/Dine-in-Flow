import { Controller, Post, Get, Patch, Delete, Param, Body, Headers, Ip, HttpCode, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Permission, ErrorCode } from '@dineflow/contracts';
import { domainError } from '../../common/errors/domain-error.js';
import {
  Public,
  Require,
  CurrentUser,
  type CustomerJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { CustomerOtpService } from './customer-otp.service.js';
import { parseCookies } from '../../common/utils/cookie.utils.js';

function assertCustomerPrincipal(
  user: CustomerJwtPayload | { type?: string },
): asserts user is CustomerJwtPayload {
  if (!user || user.type !== 'customer_access') {
    throw domainError(
      ErrorCode.FORBIDDEN,
      'Dining profiles belong strictly to the customer account and cannot be accessed by restaurant owner or staff.',
      403,
    );
  }
}

// ─── Cookie Helpers ──────────────────────────────────────────────────────────

const REFRESH_COOKIE_NAME = 'df_cust_rt';
const ORG_COOKIE_NAME = 'df_cust_org';
const TEMP_CUST_COOKIE_NAME = 'df_temp_cust';
const REFRESH_MAX_AGE_SEC = 30 * 24 * 60 * 60;

function setCustomerRefreshCookies(reply: FastifyReply | undefined, refreshToken: string, orgId: string): void {
  if (!reply || typeof reply.header !== 'function') return;
  const secureFlag = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  reply.header('Set-Cookie', [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(refreshToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE_SEC}${secureFlag}`,
    `${ORG_COOKIE_NAME}=${encodeURIComponent(orgId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${REFRESH_MAX_AGE_SEC}${secureFlag}`,
  ]);
}

function clearCustomerRefreshCookies(reply: FastifyReply | undefined): void {
  if (!reply || typeof reply.header !== 'function') return;
  const secureFlag = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  reply.header('Set-Cookie', [
    `${REFRESH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
    `${ORG_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
  ]);
}

// ─── Request DTOs ────────────────────────────────────────────────────────────

const OtpRequestSchema = z.object({
  phone: z.string().min(7).max(20),
  email: z.string().email().max(200).optional(),
  mode: z.enum(['LOGIN', 'SIGNUP']).optional(),
}).strict();

const OtpVerifySchema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().length(6),
  email: z.string().email().max(200).optional(),
  googlePreRegToken: z.string().min(20).optional(),
  displayName: z.string().min(1).max(100).optional(),
}).strict();

const GoogleLoginSchema = z.object({
  idToken: z.string().min(20).optional(),
  devMockEmail: z.string().email().max(200).optional(),
  devMockName: z.string().max(100).optional(),
}).strict();

const CustomerRefreshSchema = z.object({
  refreshToken: z.string().min(10).optional(),
}).strict();

class GoogleLoginDto extends createZodDto(GoogleLoginSchema) {}

const UpdateProfileSchema = z.object({
  displayName: z.string().min(1).max(100),
}).strict();

export const CreateDinerProfileSchema = z.object({
  name: z.string().min(1).max(100),
  relationshipTag: z.string().min(1).max(50).default('FRIEND'),
  spicePreference: z.enum(['MILD', 'MEDIUM', 'HOT', 'NONE']).default('MEDIUM'),
  dietaryPreference: z.enum(['ANY', 'VEG', 'NON_VEG', 'JAIN', 'VEGAN']).default('ANY'),
  kitchenInstructions: z.array(z.string()).default([]),
  notes: z.string().max(250).optional(),
  preferences: z.record(z.any()).optional(),
}).strict();

export const UpdateDinerProfileSchema = CreateDinerProfileSchema.partial().strict();

const DeleteDinerProfileSchema = z.object({
  id: z.string().uuid(),
}).strict();

class OtpRequestDto extends createZodDto(OtpRequestSchema) {}
class OtpVerifyDto extends createZodDto(OtpVerifySchema) {}
class CustomerRefreshDto extends createZodDto(CustomerRefreshSchema) {}
class UpdateProfileDto extends createZodDto(UpdateProfileSchema) {}
export class CreateDinerProfileDto extends createZodDto(CreateDinerProfileSchema) {}
export class UpdateDinerProfileDto extends createZodDto(UpdateDinerProfileSchema) {}
class DeleteDinerProfileDto extends createZodDto(DeleteDinerProfileSchema) {}

/**
 * Customer OTP authentication endpoints.
 * All are @Public() since auth happens here.
 * x-org-id header identifies the tenant.
 * Reference: ARCH §12
 */
@Controller('auth/customer')
export class CustomerAuthController {
  constructor(private readonly otpService: CustomerOtpService) {}

  /**
   * POST /v1/auth/customer/otp/request
   * Send a 6-digit OTP to the customer's phone.
   */
  @Public()
  @Post('otp/request')
  @HttpCode(200)
  async requestOtp(
    @Body() dto: OtpRequestDto,
    @Headers('x-org-id') orgId: string,
    @Ip() clientIp: string,
  ) {
    return this.otpService.requestOtp(orgId, dto.phone, clientIp, {
      email: dto.email,
      mode: dto.mode,
    });
  }

  /**
   * POST /v1/auth/customer/otp/verify
   * Verify OTP — links optional 1:1 email / Google sub, issues access + HttpOnly refresh cookie.
   */
  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() dto: OtpVerifyDto,
    @Headers('x-org-id') orgId: string,
    @Res({ passthrough: true }) reply?: FastifyReply,
    @Req() req?: FastifyRequest,
  ) {
    const result = await this.otpService.verifyOtp(orgId, dto.phone, dto.code, {
      email: dto.email,
      googlePreRegToken: dto.googlePreRegToken,
      displayName: dto.displayName,
    });
    if (orgId && result.refreshToken) {
      setCustomerRefreshCookies(reply, result.refreshToken, orgId);
    }
    const cookies = parseCookies(req?.headers?.cookie);
    if (orgId && result.customerId && cookies[TEMP_CUST_COOKIE_NAME]) {
      await this.otpService.claimTempCustomerCookieOrders?.(orgId, result.customerId, cookies[TEMP_CUST_COOKIE_NAME]);
    }
    return result;
  }

  /**
   * POST /v1/auth/customer/google
   * Sign in with verified Google email, or return googlePreRegToken if unregistered.
   */
  @Public()
  @Post('google')
  @HttpCode(200)
  async loginWithGoogle(
    @Body() dto: GoogleLoginDto,
    @Headers('x-org-id') orgId: string,
    @Res({ passthrough: true }) reply?: FastifyReply,
    @Req() req?: FastifyRequest,
  ) {
    const result = await this.otpService.loginWithGoogle(orgId, dto);
    if (result.registered && result.refreshToken && orgId) {
      setCustomerRefreshCookies(reply, result.refreshToken, orgId);
      const cookies = parseCookies(req?.headers?.cookie);
      if (result.customerId && cookies[TEMP_CUST_COOKIE_NAME]) {
        await this.otpService.claimTempCustomerCookieOrders?.(orgId, result.customerId, cookies[TEMP_CUST_COOKIE_NAME]);
      }
    }
    return result;
  }

  /**
   * POST /v1/auth/customer/refresh
   * Rotate customer refresh token (from body or HttpOnly cookie).
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: CustomerRefreshDto,
    @Headers('x-org-id') orgIdHeader: string,
    @Req() req?: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const cookies = parseCookies(req?.headers?.cookie);
    const token = dto?.refreshToken || cookies[REFRESH_COOKIE_NAME] || '';
    const orgId = orgIdHeader || cookies[ORG_COOKIE_NAME] || '';
    const result = await this.otpService.refreshTokens(orgId, token);
    if (orgId && result.refreshToken) {
      setCustomerRefreshCookies(reply, result.refreshToken, orgId);
    }
    return result;
  }

  /**
   * POST /v1/auth/customer/logout
   * Revoke persisted customer refresh family and clear cookies.
   */
  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Headers('x-org-id') orgIdHeader: string,
    @Req() req?: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const cookies = parseCookies(req?.headers?.cookie);
    const token = cookies[REFRESH_COOKIE_NAME];
    const orgId = orgIdHeader || cookies[ORG_COOKIE_NAME] || '';
    clearCustomerRefreshCookies(reply);
    return this.otpService.logoutSession(orgId, token);
  }

  /**
   * GET /v1/auth/customer/profile
   * Fetch authenticated customer profile and loyalty points.
   */
  @Require(Permission.CUSTOMER_READ)
  @Get('profile')
  async getProfile(@CurrentUser() user: CustomerJwtPayload) {
    return this.otpService.getProfile(user.org, user.sub);
  }

  /**
   * PATCH /v1/auth/customer/profile
   * Update authenticated customer display name.
   */
  @Require(Permission.CUSTOMER_UPDATE)
  @Patch('profile')
  async updateProfile(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.otpService.updateProfile(user.org, user.sub, dto.displayName);
  }

  /**
   * GET /v1/auth/customer/diner-profiles
   * List saved diner profiles owned strictly by the authenticated customer.
   */
  @Require(Permission.CUSTOMER_READ)
  @Get('diner-profiles')
  async listDinerProfiles(@CurrentUser() user: CustomerJwtPayload) {
    assertCustomerPrincipal(user);
    return this.otpService.listDinerProfiles(user.org, user.sub);
  }

  /**
   * POST /v1/auth/customer/diner-profiles
   * Create a new diner profile owned strictly by the authenticated customer.
   */
  @Require(Permission.CUSTOMER_UPDATE)
  @Post('diner-profiles')
  @HttpCode(201)
  async createDinerProfile(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: CreateDinerProfileDto,
  ) {
    assertCustomerPrincipal(user);
    return this.otpService.createDinerProfile(user.org, user.sub, dto);
  }

  /**
   * PATCH /v1/auth/customer/diner-profiles/:id
   * Update an owned diner profile.
   */
  @Require(Permission.CUSTOMER_UPDATE)
  @Patch('diner-profiles/:id')
  async updateDinerProfile(
    @CurrentUser() user: CustomerJwtPayload,
    @Param('id') idParam: string,
    @Body() dto: UpdateDinerProfileDto,
  ) {
    assertCustomerPrincipal(user);
    return this.otpService.updateDinerProfile(user.org, user.sub, idParam, dto);
  }

  /**
   * DELETE /v1/auth/customer/diner-profiles/:id
   * Remove an owned diner profile.
   */
  @Require(Permission.CUSTOMER_UPDATE)
  @Delete('diner-profiles/:id')
  @HttpCode(200)
  async deleteDinerProfileById(
    @CurrentUser() user: CustomerJwtPayload,
    @Param('id') id: string,
  ) {
    assertCustomerPrincipal(user);
    return this.otpService.deleteDinerProfile(user.org, user.sub, id);
  }

  /**
   * POST /v1/auth/customer/diner-profiles/delete
   * Remove an owned diner profile via POST body for HTTP clients without DELETE body support.
   */
  @Require(Permission.CUSTOMER_UPDATE)
  @Post('diner-profiles/delete')
  @HttpCode(200)
  async deleteDinerProfile(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: DeleteDinerProfileDto,
  ) {
    assertCustomerPrincipal(user);
    return this.otpService.deleteDinerProfile(user.org, user.sub, dto.id);
  }
}
