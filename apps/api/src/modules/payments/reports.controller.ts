import {
  Controller,
  Get,
  Query,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import {
  Require,
  CurrentUser,
  type StaffJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { Permission } from '@dineflow/contracts';

/**
 * Console Reports Controller — staff-facing financial reconciliation reports.
 * Accessible to Manager, Owner, and Cashier for shift drawer reconciliation.
 * Reference: ARCH §12, ARCH §17, AGENTS §2
 */
@Controller('console/reports')
export class ConsoleReportsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * GET /console/reports/cash-reconciliation?outlet_id=&date=
   * Returns total CASH_APPROVED paise grouped by staff_id for shift drawer cash reconciliation.
   */
  @Get('cash-reconciliation')
  @Require(Permission.REPORT_READ)
  getCashReconciliation(
    @CurrentUser() user: StaffJwtPayload,
    @Query('outlet_id') outletId?: string,
    @Query('date') date?: string,
  ) {
    const targetOutlet = outletId || user.outletId;
    return this.paymentsService.getCashReconciliation(user.org, targetOutlet, date);
  }
}
