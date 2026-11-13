import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Redis } from 'ioredis';
import { getConfig } from '../../config/config.js';
import { TokenService } from './token.service.js';
import { StaffAuthService } from './staff-auth.service.js';
import { StaffAuthController } from './staff-auth.controller.js';
import { StaffManagementService } from './staff-management.service.js';
import { ConsoleStaffController } from './staff-management.controller.js';
import { CustomerOtpService, REDIS_CLIENT } from './customer-otp.service.js';
import { CustomerAuthController } from './customer-auth.controller.js';
import { WhatsAppOtpProvider } from './whatsapp-otp.provider.js';
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
    StaffManagementService,
    CustomerOtpService,
    {
      provide: MESSAGING_PROVIDER,
      useClass: WhatsAppOtpProvider,
    },
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const config = getConfig();
        return new Redis(config.REDIS_URL);
      },
    },
  ],
  controllers: [StaffAuthController, ConsoleStaffController, CustomerAuthController],
  exports: [TokenService],
})
export class AuthModule {}
