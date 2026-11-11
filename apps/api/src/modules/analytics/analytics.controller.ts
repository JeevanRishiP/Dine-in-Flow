import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  HttpCode,
  HttpStatus,
  Header,
} from '@nestjs/common';
import { Permission } from '@dineflow/contracts';
import { Require, CurrentUser, type StaffJwtPayload } from '../../common/decorators/auth.decorators.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsRollupService } from './analytics-rollup.service.js';
import {
  DateRangeQueryDto,
  ItemsQueryDto,
  CreateExportDto,
  TriggerRollupDto,
} from './analytics.dto.js';

/**
 * Owner & Manager Analytics Controller
 *
 * Endpoints:
 *  - GET  /v1/console/analytics/overview    — sales, AOV, orders, comparison
 *  - GET  /v1/console/analytics/sales       — daily continuous time series
 *  - GET  /v1/console/analytics/items       — top and bottom selling items
 *  - GET  /v1/console/analytics/heatmap     — 7x24 hourly traffic heatmap
 *  - GET  /v1/console/analytics/payment-mix — payment mix, fee breakdown, net
 *  - GET  /v1/console/analytics/customers   — customer cohort & repeat rates
 *  - POST /v1/console/analytics/export      — trigger CSV/JSON export with audit log
 *  - GET  /v1/console/analytics/exports     — list recent exports
 *  - GET  /v1/console/analytics/exports/:id — fetch export details
 *  - POST /v1/console/analytics/rollups/trigger — trigger rollup re-computation
 *
 * Reference: ARCH §17, §12, AGENTS §2 rule 4
 */
@Controller('console/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly rollupService: AnalyticsRollupService,
  ) {}

  @Get('overview')
  @Require(Permission.ANALYTICS_VIEW)
  getOverview(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.analyticsService.getOverview(user.org, query);
  }

  @Get('sales')
  @Require(Permission.ANALYTICS_VIEW)
  getSales(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.analyticsService.getSales(user.org, query);
  }

  @Get('items')
  @Require(Permission.ANALYTICS_VIEW)
  getItems(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: ItemsQueryDto,
  ) {
    return this.analyticsService.getItems(user.org, query);
  }

  @Get('heatmap')
  @Require(Permission.ANALYTICS_VIEW)
  getHeatmap(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.analyticsService.getHeatmap(user.org, query);
  }

  @Get('payment-mix')
  @Require(Permission.ANALYTICS_VIEW)
  getPaymentMix(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.analyticsService.getPaymentMix(user.org, query);
  }

  @Get('customers')
  @Require(Permission.ANALYTICS_VIEW)
  getCustomers(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.analyticsService.getCustomers(user.org, query);
  }

  @Post('export')
  @Require(Permission.ANALYTICS_EXPORT)
  @HttpCode(HttpStatus.OK)
  createExport(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreateExportDto,
  ) {
    return this.analyticsService.createExport(user.org, user.sub, dto);
  }

  @Get('exports')
  @Require(Permission.ANALYTICS_VIEW)
  listExports(@CurrentUser() user: StaffJwtPayload) {
    return this.analyticsService.listExports(user.org);
  }

  @Get('exports/:id')
  @Require(Permission.ANALYTICS_VIEW)
  getExport(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
  ) {
    return this.analyticsService.getExport(user.org, id);
  }

  @Post('rollups/trigger')
  @Require(Permission.ANALYTICS_VIEW)
  @HttpCode(HttpStatus.OK)
  triggerRollup(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: TriggerRollupDto,
  ) {
    return this.rollupService.recomputeOutletDay(user.org, dto.outletId, dto.date);
  }
}
