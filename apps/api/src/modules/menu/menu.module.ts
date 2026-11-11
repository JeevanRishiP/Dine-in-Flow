import { Module } from '@nestjs/common';
import { MenuService } from './menu.service.js';
import { MediaService, MockVideoProvider } from './media.service.js';
import { ConsoleMenuController } from './console-menu.controller.js';
import { PublicMenuController } from './public-menu.controller.js';

@Module({
  controllers: [ConsoleMenuController, PublicMenuController],
  providers: [
    MockVideoProvider,
    {
      provide: MediaService,
      useFactory: (vp: MockVideoProvider) => new MediaService(vp),
      inject: [MockVideoProvider],
    },
    MenuService,
  ],
  exports: [MenuService, MediaService],
})
export class MenuModule {}
