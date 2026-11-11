import { Module } from '@nestjs/common';
import { MessagingService } from './messaging.service.js';
import { EvolutionAdapter } from './evolution.adapter.js';
import { MockMessagingProvider, MockSmsProvider } from './mock-messaging.adapter.js';
import {
  ConsoleMessagingController,
  CustomerConsentController,
  WhatsAppWebhookController,
} from './messaging.controller.js';

@Module({
  controllers: [
    ConsoleMessagingController,
    CustomerConsentController,
    WhatsAppWebhookController,
  ],
  providers: [
    {
      provide: 'MESSAGING_PROVIDER',
      useFactory: () => {
        // Only use real Evolution API if explicitly set to 'evolution'.
        // In local development, default to MockMessagingProvider to guarantee zero impact
        // on any other project running an Evolution API container on localhost:8080.
        if (process.env['WHATSAPP_PROVIDER'] === 'evolution') {
          return new EvolutionAdapter();
        }
        return new MockMessagingProvider();
      },
    },
    {
      provide: 'SMS_PROVIDER',
      useFactory: () => {
        return new MockSmsProvider();
      },
    },
    {
      provide: MessagingService,
      useFactory: (provider: any, smsProvider: any) => {
        return new MessagingService(provider, smsProvider);
      },
      inject: ['MESSAGING_PROVIDER', 'SMS_PROVIDER'],
    },
  ],
  exports: [MessagingService],
})
export class MessagingModule {}
