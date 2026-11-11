import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { AnalyticsRollupService } from './analytics-rollup.service.js';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsRollupService],
  exports: [AnalyticsService, AnalyticsRollupService],
})
export class AnalyticsModule {}
