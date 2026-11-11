import { Global, Module } from '@nestjs/common';
import { getConfig } from './config.js';

@Global()
@Module({
  providers: [
    {
      provide: 'APP_CONFIG',
      useFactory: () => getConfig(),
    },
  ],
  exports: ['APP_CONFIG'],
})
export class ConfigModule {}
