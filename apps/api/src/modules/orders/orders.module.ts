import { Module } from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { ConsoleOrdersController, CustomerOrdersController } from './orders.controller.js';
import { OutboxRelayService } from './outbox-relay.service.js';

@Module({
  providers: [OrdersService, OutboxRelayService],
  controllers: [ConsoleOrdersController, CustomerOrdersController],
  exports: [OrdersService],
})
export class OrdersModule {}
