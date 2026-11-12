import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { TablesService } from './tables.service.js';
import { CreateTableDto, UpdateTableDto, OpenSessionDto } from './tables.dto.js';
import { Require, CurrentUser, Public, type StaffJwtPayload } from '../../common/decorators/auth.decorators.js';
import { resolveScopedOutletId } from '../../common/utils/outlet-scope.utils.js';
import { Permission } from '@dineflow/contracts';


/**
 * Console Tables Controller — staff-facing CRUD + QR management.
 * All routes require a valid staff JWT with the appropriate permission.
 *
 * NEEDS_HUMAN_REVIEW: QR rotate endpoint — ensure rate-limiting and audit log
 * Reference: ARCH §5
 */
@Controller('console/tables')
export class ConsoleTablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get()
  @Require(Permission.TABLE_READ)
  listTables(
    @CurrentUser() user: StaffJwtPayload,
    @Query('outlet_id') outletId?: string,
  ) {
    const scopedOutlet = resolveScopedOutletId(user.outletId, outletId);
    return this.tablesService.listTables(user.org, scopedOutlet);
  }

  @Get(':id')
  @Require(Permission.TABLE_READ)
  getTable(@CurrentUser() user: StaffJwtPayload, @Param('id') id: string) {
    return this.tablesService.getTable(user.org, id, user.outletId);
  }

  @Post()
  @Require(Permission.TABLE_CREATE)
  @HttpCode(HttpStatus.CREATED)
  createTable(@CurrentUser() user: StaffJwtPayload, @Body() dto: CreateTableDto) {
    resolveScopedOutletId(user.outletId, dto.outlet_id);
    return this.tablesService.createTable(user.org, dto);
  }

  @Patch(':id')
  @Require(Permission.TABLE_UPDATE)
  updateTable(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return this.tablesService.updateTable(user.org, id, dto, user.outletId);
  }

  @Delete(':id')
  @Require(Permission.TABLE_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteTable(@CurrentUser() user: StaffJwtPayload, @Param('id') id: string) {
    return this.tablesService.deleteTable(user.org, id, user.outletId);
  }

  /** Returns HMAC-signed QR token + deep-link URL. */
  @Get(':id/qr')
  @Require(Permission.TABLE_READ)
  getTableQr(@CurrentUser() user: StaffJwtPayload, @Param('id') id: string) {
    return this.tablesService.getTableQr(user.org, id, user.outletId);
  }

  /** Rotate the QR token — invalidates all existing scanned codes for this table. */
  @Post(':id/qr/rotate')
  @Require(Permission.TABLE_UPDATE)
  rotateQrToken(@CurrentUser() user: StaffJwtPayload, @Param('id') id: string) {
    return this.tablesService.rotateQrToken(user.org, id, user.outletId);
  }

  @Post(':id/sessions/close')
  @Require(Permission.TABLE_UPDATE)
  @HttpCode(HttpStatus.NO_CONTENT)
  closeSession(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') _tableId: string,
    @Query('session_id') sessionId: string,
  ) {
    return this.tablesService.closeSession(user.org, sessionId, user.outletId);
  }
}

/**
 * Public Sessions Controller — customer-facing QR scan → open session.
 * No auth required — the QR HMAC token IS the authentication.
 */
@Controller('public/sessions')
export class PublicSessionsController {
  constructor(private readonly tablesService: TablesService) {}

  /** Customer scans QR code → opens a dine-in session. */
  @Post('open')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  openSession(@Body() dto: OpenSessionDto) {
    return this.tablesService.openSession(dto);
  }
}
