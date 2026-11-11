import { Controller, Post, Get, Patch, Delete, Param, Body, Headers, Ip, HttpCode } from '@nestjs/common';
import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';
import { Permission } from '@dineflow/contracts';
import {
  Public,
  Require,
  CurrentUser,
  type CustomerJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { CustomerOtpService } from './customer-otp.service.js';

// ─── Request DTOs ────────────────────────────────────────────────────────────

const OtpRequestSchema = z.object({
  phone: z.string().min(7).max(20),
}).strict();

const OtpVerifySchema = z.object({
  phone: z.string().min(7).max(20),
  code: z.string().length(6),
}).strict();

const CustomerRefreshSchema = z.object({
  refreshToken: z.string().min(10),
}).strict();

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
    return this.otpService.requestOtp(orgId, dto.phone, clientIp);
  }

  /**
   * POST /v1/auth/customer/otp/verify
   * Verify the OTP — issues access + refresh tokens.
   */
  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(
    @Body() dto: OtpVerifyDto,
    @Headers('x-org-id') orgId: string,
  ) {
    return this.otpService.verifyOtp(orgId, dto.phone, dto.code);
  }

  /**
   * POST /v1/auth/customer/refresh
   * Rotate customer refresh token.
   */
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() dto: CustomerRefreshDto,
    @Headers('x-org-id') orgId: string,
  ) {
    return this.otpService.refreshTokens(orgId, dto.refreshToken);
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
   * List saved diner profiles owned by the authenticated customer.
   */
  @Require(Permission.CUSTOMER_READ)
  @Get('diner-profiles')
  async listDinerProfiles(@CurrentUser() user: CustomerJwtPayload) {
    return this.otpService.listDinerProfiles(user.org, user.sub);
  }

  /**
   * POST /v1/auth/customer/diner-profiles
   * Create a new diner profile owned by the authenticated customer.
   */
  @Require(Permission.CUSTOMER_UPDATE)
  @Post('diner-profiles')
  @HttpCode(201)
  async createDinerProfile(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: CreateDinerProfileDto,
  ) {
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
    return this.otpService.deleteDinerProfile(user.org, user.sub, dto.id);
  }
}
