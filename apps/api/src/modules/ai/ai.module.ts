import { Module } from '@nestjs/common';
import { CustomerAiController, ConsoleAiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { MenuRetrievalService } from './menu-retrieval.service.js';

@Module({
  controllers: [CustomerAiController, ConsoleAiController],
  providers: [AiService, MenuRetrievalService],
  exports: [AiService, MenuRetrievalService],
})
export class AiModule {}
