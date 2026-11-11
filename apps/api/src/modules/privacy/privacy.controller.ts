import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Permission } from '@dineflow/contracts';
import {
  Require,
  CurrentUser,
  type StaffJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import type { CustomerJwtPayload } from '../auth/token.service.js';
import { PrivacyService } from './privacy.service.js';
import {
  CustomerAnonymizeSchema,
  StaffAnonymizeSchema,
  StaffExportSchema,
} from './privacy.dto.js';

/**
 * Customer Self-Service Privacy Controller (DPDP Act 2023).
 * Enables diners to download their data archive or exercise the right to erasure.
 * Reference: ARCH §23
 */
@Controller('me/privacy')
export class CustomerPrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  /**
   * Data Subject Access Request (DSAR): Export customer personal data.
   */
  @Post('export')
  @Require(Permission.CUSTOMER_READ)
  @HttpCode(HttpStatus.OK)
  async exportMyData(@CurrentUser() user: CustomerJwtPayload) {
    return this.privacyService.exportCustomerData(user.org, user.sub, 'CUSTOMER');
  }

  /**
   * Right to Erasure / Account Deletion.
   * Anonymizes customer identity while retaining tax/accounting invoices.
   */
  @Post('delete')
  @Require(Permission.CUSTOMER_READ)
  @HttpCode(HttpStatus.OK)
  async deleteMyData(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() body: unknown,
  ) {
    const dto = CustomerAnonymizeSchema.parse(body || {});
    return this.privacyService.anonymizeCustomer(user.org, user.sub, 'CUSTOMER', dto.reason);
  }
}

/**
 * Staff Console Privacy & DPDP Compliance Controller.
 * Allows compliance officers and managers to fulfill DSAR requests, anonymize records,
 * and execute automated data retention purges.
 */
@Controller('console/privacy')
export class ConsolePrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  /**
   * Fulfill a customer Data Subject Access Request (DSAR).
   */
  @Post('export')
  @Require(Permission.COMPLIANCE_READ)
  @HttpCode(HttpStatus.OK)
  async exportCustomerData(
    @CurrentUser() user: StaffJwtPayload,
    @Body() body: unknown,
  ) {
    const dto = StaffExportSchema.parse(body);
    return this.privacyService.exportCustomerData(user.org, dto.customerId, 'STAFF');
  }

  /**
   * Execute customer erasure request on behalf of the customer.
   */
  @Post('anonymize')
  @Require(Permission.COMPLIANCE_MANAGE)
  @HttpCode(HttpStatus.OK)
  async anonymizeCustomer(
    @CurrentUser() user: StaffJwtPayload,
    @Body() body: unknown,
  ) {
    const dto = StaffAnonymizeSchema.parse(body);
    return this.privacyService.anonymizeCustomer(user.org, dto.customerId, 'STAFF', dto.reason);
  }

  /**
   * Trigger retention purge of expired OTPs, stale transcripts, and old webhooks.
   */
  @Post('retention-purge')
  @Require(Permission.COMPLIANCE_MANAGE)
  @HttpCode(HttpStatus.OK)
  async runRetentionPurge(@CurrentUser() user: StaffJwtPayload) {
    return this.privacyService.runRetentionPurge(user.org);
  }
}
