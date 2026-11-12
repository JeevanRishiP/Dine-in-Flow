import { Module } from '@nestjs/common';
import { MessagingService } from './messaging.service.js';
import { WhatsAppCloudAdapter } from './whatsapp-cloud.adapter.js';
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
        const provider = (process.env['WHATSAPP_PROVIDER'] || '').toLowerCase();
        if (provider === 'evolution') {
          throw new Error(
            'Unofficial WhatsApp bridges (Evolution) are forbidden per AGENTS §2 rule 11. Configure WHATSAPP_PROVIDER=cloud.',
          );
        }
        if (provider === 'cloud' || provider === 'meta') {
          return new WhatsAppCloudAdapter();
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
