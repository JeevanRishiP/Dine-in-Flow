import { Module } from '@nestjs/common';
import { FeedbackService } from './feedback.service.js';
import {
  ConsoleFeedbackController,
  CustomerFeedbackController,
} from './feedback.controller.js';

@Module({
  controllers: [ConsoleFeedbackController, CustomerFeedbackController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
