import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { TablesService } from './tables.service.js';
import { ConsoleTablesController, PublicSessionsController, PublicTablesController } from './tables.controller.js';

@Module({
  imports: [AuthModule],
  providers: [TablesService],
  controllers: [ConsoleTablesController, PublicSessionsController, PublicTablesController],
  exports: [TablesService],
})
export class TablesModule {}

