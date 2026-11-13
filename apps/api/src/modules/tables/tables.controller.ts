import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, Query, Headers, Req, Res, HttpCode, HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { TablesService } from './tables.service.js';
import { CreateTableDto, UpdateTableDto, OpenSessionDto, OpenManualSessionDto, PublicTablesQueryDto } from './tables.dto.js';
import { Require, CurrentUser, Public, type StaffJwtPayload } from '../../common/decorators/auth.decorators.js';
import { resolveScopedOutletId } from '../../common/utils/outlet-scope.utils.js';
import { parseCookies } from '../../common/utils/cookie.utils.js';
import { Permission } from '@dineflow/contracts';

const TEMP_CUST_COOKIE_NAME = 'df_temp_cust';
const TEMP_CUST_MAX_AGE_SEC = 12 * 60 * 60;

function setTempCustomerCookie(reply: FastifyReply | undefined, token?: string): void {
  if (!reply || typeof reply.header !== 'function' || !token) return;
  const secureFlag = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${TEMP_CUST_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TEMP_CUST_MAX_AGE_SEC}${secureFlag}`,
  );
}

function clearTempCustomerCookie(reply: FastifyReply | undefined): void {
  if (!reply || typeof reply.header !== 'function') return;
  const secureFlag = process.env['NODE_ENV'] === 'production' ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${TEMP_CUST_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureFlag}`,
  );
}


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

  /** Live floor overview including open sessions & uncleaned temp-customer table links. */
  @Get('floor')
  @Require(Permission.TABLE_READ)
  getFloorOverview(
    @CurrentUser() user: StaffJwtPayload,
    @Query('outlet_id') outletId?: string,
  ) {
    const scopedOutlet = resolveScopedOutletId(user.outletId, outletId);
    return this.tablesService.getFloorOverview(user.org, scopedOutlet);
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

  /** Captain/Waiter marks table cleaned & ready; dissolves temporary customer when all their tables are cleaned. */
  @Post(':id/clean')
  @Require(Permission.TABLE_CLEAN)
  @HttpCode(HttpStatus.OK)
  cleanTable(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') tableId: string,
  ) {
    return this.tablesService.cleanTableAndDissolve(user.org, tableId, user.sub, user.outletId);
  }
}

/**
 * Public Sessions Controller — customer-facing QR scan / manual entry → open session.
 */
@Controller('public/sessions')
export class PublicSessionsController {
  constructor(private readonly tablesService: TablesService) {}

  /** Restore active temporary customer + table session from HttpOnly cookie across refreshes. */
  @Get('me')
  @Public()
  async getCurrentSession(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const cookies = parseCookies(req?.headers?.cookie);
    const result = await this.tablesService.getCurrentGuestSession(cookies[TEMP_CUST_COOKIE_NAME]);
    if (!result.active && cookies[TEMP_CUST_COOKIE_NAME]) {
      clearTempCustomerCookie(reply);
    }
    return result;
  }

  /** Customer scans QR code → opens a private dine-in session linked to customer or temp customer. */
  @Post('open')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async openSession(
    @Body() dto: OpenSessionDto,
    @Req() req?: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const caller = this.tablesService.resolveCallerIdentityFromHeaders(
      req?.headers?.cookie,
      req?.headers?.authorization,
    );
    const res = await this.tablesService.openSession({ ...dto, ...caller });
    const { tempCustomerToken, ...body } = res;
    setTempCustomerCookie(reply, tempCustomerToken);
    return body;
  }

  /** Customer enters numeric table number manually when opening without a table link. */
  @Post('open-manual')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  async openManualSession(
    @Body() dto: OpenManualSessionDto,
    @Headers('x-forwarded-host') forwardedHost?: string,
    @Headers('host') host?: string,
    @Req() req?: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const caller = this.tablesService.resolveCallerIdentityFromHeaders(
      req?.headers?.cookie,
      req?.headers?.authorization,
    );
    const res = await this.tablesService.openManualSession({ ...dto, ...caller }, forwardedHost || host);
    const { tempCustomerToken, ...body } = res;
    setTempCustomerCookie(reply, tempCustomerToken);
    return body;
  }
}

/**
 * Public Tables Controller — exposes active table numbers for live hotel matching.
 */
@Controller('public/tables')
export class PublicTablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Get('directory')
  @Public()
  listDirectory(
    @Query() query: PublicTablesQueryDto,
    @Headers('x-forwarded-host') forwardedHost?: string,
    @Headers('host') host?: string,
  ) {
    return this.tablesService.listPublicOutletTables(query.outlet_id, {
      slug: query.slug,
      host: forwardedHost || host,
    });
  }
}
