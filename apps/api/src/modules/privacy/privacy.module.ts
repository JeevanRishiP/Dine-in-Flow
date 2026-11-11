import { Module } from '@nestjs/common';
import { CustomerPrivacyController, ConsolePrivacyController } from './privacy.controller.js';
import { PrivacyService } from './privacy.service.js';

@Module({
  controllers: [CustomerPrivacyController, ConsolePrivacyController],
  providers: [PrivacyService],
  exports: [PrivacyService],
})
export class PrivacyModule {}
