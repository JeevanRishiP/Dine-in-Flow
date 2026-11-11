import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Permission } from '@dineflow/contracts';
import {
  Require,
  Public,
  CurrentUser,
  type StaffJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import type { CustomerJwtPayload } from '../auth/token.service.js';
import { LoyaltyService } from './loyalty.service.js';
import {
  CreateCouponDto,
  UpdateCouponDto,
  ValidateCouponDto,
  UpdateLoyaltySettingsDto,
  ClaimReferralDto,
} from './loyalty.dto.js';

/**
 * Console (Staff / Owner) Controller for Coupons and Loyalty Settings.
 */
@Controller('console')
export class ConsoleLoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  @Post('coupons')
  @Require(Permission.COUPON_MANAGE)
  @HttpCode(HttpStatus.CREATED)
  createCoupon(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreateCouponDto,
  ) {
    return this.loyaltyService.createCoupon(user.org, dto);
  }

  @Get('coupons')
  @Require(Permission.COUPON_MANAGE)
  listCoupons(@CurrentUser() user: StaffJwtPayload) {
    return this.loyaltyService.listCoupons(user.org);
  }

  @Get('coupons/:id')
  @Require(Permission.COUPON_MANAGE)
  getCoupon(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
  ) {
    return this.loyaltyService.getCoupon(user.org, id);
  }

  @Patch('coupons/:id')
  @Require(Permission.COUPON_MANAGE)
  updateCoupon(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.loyaltyService.updateCoupon(user.org, id, dto);
  }

  @Get('loyalty/settings')
  @Require(Permission.LOYALTY_MANAGE)
  getSettings(@CurrentUser() user: StaffJwtPayload) {
    return this.loyaltyService.getSettings(user.org);
  }

  @Patch('loyalty/settings')
  @Require(Permission.LOYALTY_MANAGE)
  updateSettings(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: UpdateLoyaltySettingsDto,
  ) {
    return this.loyaltyService.updateSettings(user.org, dto);
  }
}

/**
 * Public & Customer Controller for Coupon validation, Wallet, and Referrals.
 */
@Controller()
export class CustomerLoyaltyController {
  constructor(private readonly loyaltyService: LoyaltyService) {}

  /**
   * Public validation: allows guests or customers to test a coupon against cart.
   */
  @Post('public/coupons/validate')
  @Public()
  @HttpCode(HttpStatus.OK)
  validateCoupon(@Body() dto: ValidateCouponDto) {
    // In public mode, org_id is extracted from outlet context or provided in DTO
    // If not supplied, validate against the outlet's owning org
    // For now, dto includes outletId, let's query via tenant context in service
    // Service queries with orgId: we can resolve orgId from outlet or pass in dto
    // In DineFlow, customer public requests pass table session or outlet context
    return this.loyaltyService.validateCoupon(dto.outletId, dto);
  }

  /**
   * Signed-in customer checks their wallet balance and transaction ledger.
   */
  @Get('me/wallet')
  @Require(Permission.CUSTOMER_READ)
  getWallet(@CurrentUser() user: CustomerJwtPayload) {
    return this.loyaltyService.getWallet(user.org, user.sub);
  }

  /**
   * Signed-in customer claims a referral code.
   */
  @Post('me/referrals/claim')
  @Require(Permission.CUSTOMER_UPDATE)
  @HttpCode(HttpStatus.OK)
  claimReferral(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: ClaimReferralDto,
  ) {
    return this.loyaltyService.claimReferral(user.org, user.sub, dto);
  }
}
