import {
  Controller, Get, Post, Patch, Body, Param, Query,
  ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { MenuService } from './menu.service.js';
import { Require } from '../../common/decorators/auth.decorators.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { Permission } from '@dineflow/contracts';
import type { StaffJwtPayload } from '../auth/token.service.js';
import {
  CreateCategoryDto,
  UpdateCategoryDto,
  CreateMenuItemDto,
  UpdateMenuItemDto,
  StockUpdateDto,
  CreateModifierGroupDto,
  CreateModifierDto,
  MenuQueryDto,
} from './menu.dto.js';

/**
 * Console Menu Controller — requires staff authentication.
 * All paths under /v1/console/menu.
 * Reference: ARCH §13
 */
@Controller('console/menu')
export class ConsoleMenuController {
  constructor(private readonly menuService: MenuService) {}

  // ─── Categories ─────────────────────────────────────────────────────────────

  @Get('categories')
  @Require(Permission.MENU_READ)
  getCategories(
    @CurrentUser() user: StaffJwtPayload,
    @Query('outlet_id') outletId?: string,
  ) {
    return this.menuService.getCategories(user.org, outletId);
  }

  @Post('categories')
  @Require(Permission.MENU_WRITE)
  @HttpCode(HttpStatus.CREATED)
  createCategory(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.menuService.createCategory(user.org, dto, user.sub);
  }

  @Patch('categories/:id')
  @Require(Permission.MENU_WRITE)
  updateCategory(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.menuService.updateCategory(user.org, id, dto, user.sub);
  }

  // ─── Menu Items ──────────────────────────────────────────────────────────────

  @Get('items')
  @Require(Permission.MENU_READ)
  getItems(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: MenuQueryDto,
  ) {
    return this.menuService.getItems(user.org, query);
  }

  @Post('items')
  @Require(Permission.MENU_WRITE)
  @HttpCode(HttpStatus.CREATED)
  createItem(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreateMenuItemDto,
  ) {
    return this.menuService.createItem(user.org, dto, user.sub);
  }

  @Patch('items/:id')
  @Require(Permission.MENU_WRITE)
  updateItem(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMenuItemDto,
  ) {
    return this.menuService.updateItem(user.org, id, dto, user.sub);
  }

  /**
   * Stock toggle — available to KITCHEN and WAITER roles (stock:update permission).
   * Reference: ARCH §17
   */
  @Patch('items/:id/stock')
  @Require(Permission.STOCK_UPDATE)
  updateStock(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StockUpdateDto,
  ) {
    return this.menuService.updateStock(user.org, id, dto, user.sub);
  }

  // ─── Modifier Groups ─────────────────────────────────────────────────────────

  @Post('modifier-groups')
  @Require(Permission.MENU_WRITE)
  @HttpCode(HttpStatus.CREATED)
  createModifierGroup(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreateModifierGroupDto,
  ) {
    return this.menuService.createModifierGroup(user.org, dto, user.sub);
  }

  @Post('modifiers')
  @Require(Permission.MENU_WRITE)
  @HttpCode(HttpStatus.CREATED)
  createModifier(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreateModifierDto,
  ) {
    return this.menuService.createModifier(user.org, dto, user.sub);
  }

  @Post('items/:itemId/modifier-groups/:groupId')
  @Require(Permission.MENU_WRITE)
  @HttpCode(HttpStatus.CREATED)
  attachModifierGroup(
    @CurrentUser() user: StaffJwtPayload,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Query('sort_order') sortOrder = '0',
  ) {
    return this.menuService.attachModifierGroup(
      user.org, itemId, groupId, parseInt(sortOrder, 10), user.sub,
    );
  }

  // ─── Presigned upload ────────────────────────────────────────────────────────

  @Post('items/:id/media/upload-url')
  @Require(Permission.MENU_WRITE)
  getUploadUrl(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { content_type: string; media_type: 'IMAGE' | 'VIDEO' },
  ) {
    return this.menuService.getPresignedUploadUrl(user.org, id, body.content_type, body.media_type, user.sub);
  }
}
