import {
  Controller, Get, Post, Patch,
  Param, Body, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { PlaceOrderDto, QuoteOrderDto, UpdateOrderStatusDto, UpdateItemStatusDto, OrderQueryDto, ReassignItemTableDto } from './orders.dto.js';

import {
  Require,
  CurrentUser,
  type StaffJwtPayload,
  type CustomerJwtPayload,
  type GuestSessionJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { toCustomerAccessScope } from '../../common/utils/ownership.utils.js';
import { resolveScopedOutletId } from '../../common/utils/outlet-scope.utils.js';
import { Permission } from '@dineflow/contracts';


/**
 * Staff-facing Orders Controller.
 *
 * All routes require a valid staff JWT.
 * NEEDS_HUMAN_REVIEW: order placement auth — customer-placed orders will use
 * a separate customer guard in Phase 4; for now staff can place on behalf.
 * Reference: ARCH §7
 */
@Controller('console/orders')
export class ConsoleOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @Require(Permission.ORDER_READ)
  listOrders(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: OrderQueryDto,
  ) {
    const scopedOutlet = resolveScopedOutletId(user.outletId, query.outlet_id);
    return this.ordersService.listOrders(user.org, { ...query, outlet_id: scopedOutlet });
  }

  /** Compute a server-side price quote (no side-effects). Returns price_fingerprint for PRICE_CHANGED detection. */
  @Post('quote')
  @Require(Permission.ORDER_READ)
  @HttpCode(HttpStatus.OK)
  quoteOrder(@CurrentUser() user: StaffJwtPayload, @Body() dto: QuoteOrderDto) {
    return this.ordersService.quoteOrder(user.org, dto);
  }

  @Get(':id')
  @Require(Permission.ORDER_READ)
  getOrder(@CurrentUser() user: StaffJwtPayload, @Param('id') id: string) {
    return this.ordersService.getOrder(user.org, id, undefined, user.outletId);
  }

  /** Staff (waiter) places an order on behalf of the table. */
  @Post()
  @Require(Permission.ORDER_READ)
  @HttpCode(HttpStatus.CREATED)
  placeOrder(@CurrentUser() user: StaffJwtPayload, @Body() dto: PlaceOrderDto) {
    return this.ordersService.placeOrder(user.org, dto, user.sub, 'STAFF', undefined, user.outletId);
  }

  /** Update order status (CONFIRM → PREPARING → READY → etc.). */
  @Patch(':id/status')
  @Require(Permission.ORDER_UPDATE_STATUS)
  updateOrderStatus(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') id: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    return this.ordersService.updateOrderStatus(user.org, id, dto, user.sub, 'STAFF', user.outletId);
  }

  /** KDS: Update an individual item's status (PREPARING / READY / SERVED). */
  @Patch(':id/items/:itemId/status')
  @Require(Permission.KITCHEN_UPDATE)
  updateItemStatus(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemStatusDto,
  ) {
    return this.ordersService.updateItemStatus(user.org, orderId, itemId, dto, user.sub, user.outletId);
  }
}

/**
 * Customer-facing Orders Controller.
 * Protected by Guest Session JWT (issued on QR table scan) or Customer JWT.
 * Reference: ARCH §8, §9, §12, AGENTS §2 rule 4
 */
@Controller('customer/orders')
export class CustomerOrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @Require(Permission.GUEST_SESSION)
  @HttpCode(HttpStatus.CREATED)
  placeOrder(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Body() dto: PlaceOrderDto,
  ) {
    return this.ordersService.placeOrder(
      user.org,
      dto,
      user.sub,
      'CUSTOMER',
      toCustomerAccessScope(user),
    );
  }

  @Get('my')
  @Require(Permission.GUEST_SESSION)
  getMyOrders(@CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload) {
    return this.ordersService.getMyOrders(user.org, toCustomerAccessScope(user));
  }

  @Get('session/:sessionId')
  @Require(Permission.GUEST_SESSION)
  getSessionOrders(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('sessionId') sessionId: string,
  ) {
    return this.ordersService.getOrdersBySession(
      user.org,
      sessionId,
      toCustomerAccessScope(user),
    );
  }

  @Get(':id')
  @Require(Permission.GUEST_SESSION)
  getOrder(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('id') id: string,
  ) {
    return this.ordersService.getOrder(user.org, id, toCustomerAccessScope(user));
  }

  /** Change destination table for an individual plate (item) before SERVED/BILLED. */
  @Patch(':id/items/:itemId/table')
  @Require(Permission.GUEST_SESSION)
  reassignItemTable(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: ReassignItemTableDto,
  ) {
    return this.ordersService.reassignItemTable(
      user.org,
      orderId,
      itemId,
      dto,
      user.sub,
      toCustomerAccessScope(user),
    );
  }
}
