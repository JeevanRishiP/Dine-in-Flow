import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CommonModule } from './common/common.module.js';
import { ConfigModule } from './config/config.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { MenuModule } from './modules/menu/menu.module.js';
import { TablesModule } from './modules/tables/tables.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { LoyaltyModule } from './modules/loyalty/loyalty.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';
import { MessagingModule } from './modules/messaging/messaging.module.js';
import { AiModule } from './modules/ai/ai.module.js';
import { PrivacyModule } from './modules/privacy/privacy.module.js';
import { RbacGuard } from './common/guards/rbac.guard.js';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    AuthModule,
    MenuModule,
    TablesModule,
    OrdersModule,
    RealtimeModule,
    PaymentsModule,
    AnalyticsModule,
    LoyaltyModule,
    FeedbackModule,
    MessagingModule,
    AiModule,
    PrivacyModule,
  ],

  providers: [
    // Global RBAC guard — every route must have @Require() or @Public()
    // Reference: ARCH §12, AGENTS §2 rule 4
    {
      provide: APP_GUARD,
      useClass: RbacGuard,
    },
  ],
})
export class AppModule {}
