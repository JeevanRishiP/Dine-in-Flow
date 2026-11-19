import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import {
  ConsoleOrdersController,
  CustomerOrdersController,
  CustomerReservationsController,
} from './orders.controller.js';
import { OutboxRelayService } from './outbox-relay.service.js';
import { KitchenSchedulerService } from './kitchen-scheduler.service.js';
import { PaymentExpiryCleanupService } from './payment-expiry-cleanup.service.js';

@Module({
  providers: [
    OrdersService,
    OutboxRelayService,
    KitchenSchedulerService,
    PaymentExpiryCleanupService,
  ],
  controllers: [
    ConsoleOrdersController,
    CustomerOrdersController,
    CustomerReservationsController,
  ],
  exports: [OrdersService, KitchenSchedulerService],
})
export class OrdersModule {}
