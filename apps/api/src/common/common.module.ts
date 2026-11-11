import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ZodSerializerInterceptor } from 'nestjs-zod';
import { ConfigModule } from '../config/config.module.js';
import { AllExceptionsFilter } from './filters/all-exceptions.filter.js';
import { RequestIdInterceptor } from './interceptors/request-id.interceptor.js';
import { HealthController } from './health/health.controller.js';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [
    // Global exception filter — must be first so other interceptors run inside it
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
    // Adds x-request-id to every request/response
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestIdInterceptor,
    },
    // Serializes Zod-validated response DTOs
    {
      provide: APP_INTERCEPTOR,
      useClass: ZodSerializerInterceptor,
    },
  ],
})
export class CommonModule {}
