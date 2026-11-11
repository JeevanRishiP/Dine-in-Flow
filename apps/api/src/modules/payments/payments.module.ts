/**
 * PaymentsModule
 *
 * Provides:
 *  - PaymentsService (payment creation, webhook processing, refunds, reconciliation)
 *  - ConsolePaymentsController (staff payment endpoints)
 *  - PublicWebhookController (signature-verified gateway webhooks — @Public)
 *  - ReconciliationService (scheduled job polling stale PENDING payments)
 */

import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';
import { ConsolePaymentsController, PublicWebhookController, CustomerPaymentsController } from './payments.controller.js';
import { ReconciliationService } from './reconciliation.service.js';

@Module({
  providers: [PaymentsService, ReconciliationService],
  controllers: [ConsolePaymentsController, PublicWebhookController, CustomerPaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
