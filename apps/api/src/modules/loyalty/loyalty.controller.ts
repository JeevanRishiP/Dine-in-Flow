import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Permission, ErrorCode } from '@dineflow/contracts';
import { domainError } from '../../common/errors/domain-error.js';
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
  listCoupons(
    @CurrentUser() user: StaffJwtPayload,
    @Query('outlet_id') outletId?: string,
  ) {
    if (outletId !== undefined) {
      return this.loyaltyService.listCoupons(user.org, outletId);
    }
    return this.loyaltyService.listCoupons(user.org);
  }

  @Delete('coupons/:id')
  @Require(Permission.COUPON_MANAGE)
  @HttpCode(HttpStatus.OK)
  deleteCoupon(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
  ) {
    return this.loyaltyService.deleteCoupon(user.org, id);
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
   * Public list: allows diners to view active promotional coupons.
   */
  @Get('public/coupons')
  @Public()
  async listPublicCoupons(
    @Query('outlet_id') outletId?: string,
    @Query('org_id') orgId?: string,
  ) {
    let targetOrgId = orgId;
    if (!targetOrgId && outletId) {
      targetOrgId = await this.loyaltyService.resolveOrgIdByOutlet(outletId);
    }
    if (!targetOrgId) {
      return [];
    }
    return this.loyaltyService.listPublicCoupons(targetOrgId, outletId);
  }

  /**
   * Public validation: allows guests or customers to test a coupon against cart.
   * Resolves the real owning org_id from outletId (never uses outletId as orgId).
   */
  @Post('public/coupons/validate')
  @Public()
  @HttpCode(HttpStatus.OK)
  async validateCoupon(@Body() dto: ValidateCouponDto) {
    const orgId = await this.loyaltyService.resolveOrgIdByOutlet(dto.outletId);
    return this.loyaltyService.validateCoupon(orgId, dto);
  }

  /**
   * Authenticated coupon validation/apply endpoint enforcing logged-in customer authentication.
   * Rejects unauthenticated callers with 401 Unauthorized.
   */
  @Post(['customer/coupons/apply', 'me/coupons/apply'])
  @Require(Permission.CUSTOMER_READ)
  @HttpCode(HttpStatus.OK)
  async applyCouponAuth(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: ValidateCouponDto,
  ) {
    if (!user?.sub) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Please log in or sign up to apply coupons', 401);
    }
    const orgId = user.org || (await this.loyaltyService.resolveOrgIdByOutlet(dto.outletId));
    return this.loyaltyService.validateCoupon(orgId, { ...dto, customerId: user.sub });
  }

  @Post('public/coupons/apply')
  @Public()
  @HttpCode(HttpStatus.OK)
  async applyCouponPublic(@Body() dto: ValidateCouponDto) {
    if (!dto.customerId) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'Please log in or sign up to apply coupons', 401);
    }
    const orgId = await this.loyaltyService.resolveOrgIdByOutlet(dto.outletId);
    return this.loyaltyService.validateCoupon(orgId, dto);
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
