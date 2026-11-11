import { Module } from '@nestjs/common';
import { ConsoleLoyaltyController, CustomerLoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';

@Module({
  controllers: [ConsoleLoyaltyController, CustomerLoyaltyController],
  providers: [LoyaltyService],
  exports: [LoyaltyService],
})
export class LoyaltyModule {}
