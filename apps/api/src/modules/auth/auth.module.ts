import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { getConfig } from '../../config/config.js';
import { TokenService } from './token.service.js';
import { StaffAuthService } from './staff-auth.service.js';
import { StaffAuthController } from './staff-auth.controller.js';
import { CustomerOtpService, REDIS_CLIENT } from './customer-otp.service.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { MockMessagingProvider } from './mock-messaging.provider.js';
import { MESSAGING_PROVIDER } from './messaging.provider.js';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const config = getConfig();
        return { secret: config.JWT_SECRET, signOptions: { expiresIn: '15m' } };
      },
    }),
  ],
  providers: [
    TokenService,
    StaffAuthService,
    CustomerOtpService,
    {
      provide: MESSAGING_PROVIDER,
      useClass: MockMessagingProvider,
    },
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const config = getConfig();
        return new Redis(config.REDIS_URL);
      },
    },
  ],
  controllers: [StaffAuthController, CustomerAuthController],
  exports: [TokenService],
})
export class AuthModule {}
