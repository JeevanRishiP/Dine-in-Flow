import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TablesService } from './tables.service.js';
import { ConsoleTablesController, PublicSessionsController } from './tables.controller.js';

@Module({
  imports: [AuthModule],
  providers: [TablesService],
  controllers: [ConsoleTablesController, PublicSessionsController],
  exports: [TablesService],
})
export class TablesModule {}

