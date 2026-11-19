import {
  Controller, Get, Post, Patch,
  Param, Body, Query, HttpCode, HttpStatus,
} from '@nestjs/common';
import { OrdersService } from './orders.service.js';
import { KitchenSchedulerService } from './kitchen-scheduler.service.js';
import {
  PlaceOrderDto,
  QuoteOrderDto,
  UpdateOrderStatusDto,
  UpdateItemStatusDto,
  OrderQueryDto,
  ReassignItemTableDto,
  CheckAvailabilityDto,
  CreateReservationDto,
  SnoozeServeLaterDto,
  ReleaseHoldDto,
} from './orders.dto.js';

import {
  Require,
  CurrentUser,
  Public,
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
  constructor(
    private readonly ordersService: OrdersService,
    private readonly kitchenSchedulerService: KitchenSchedulerService,
  ) {}

  @Get()
  @Require(Permission.ORDER_READ)
  listOrders(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: OrderQueryDto,
  ) {
    const scopedOutlet = resolveScopedOutletId(user.outletId, query.outlet_id);
    return this.ordersService.listOrders(user.org, { ...query, outlet_id: scopedOutlet });
  }

  /**
   * Flattened KDS Priority API:
   * Returns ONLY PAID orders' items as an independent flat array (KdsItemTicket[]),
   * sorted deterministically: targetFireAt ASC, courseSequence ASC, prepTimeMinutes DESC, paidAt ASC.
   */
  @Get('kds/items')
  @Require(Permission.ORDER_READ)
  async getKdsItems(
    @CurrentUser() user: StaffJwtPayload,
    @Query('outlet_id') outletId?: string,
  ) {
    const scopedOutlet = resolveScopedOutletId(user.outletId, outletId);
    const items = await this.kitchenSchedulerService.getFlattenedKdsItems(user.org, scopedOutlet);
    return {
      items,
      serverTimestamp: new Date().toISOString(),
    };
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
  @Require(Permission.ORDER_UPDATE_STATUS)
  updateItemStatus(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateItemStatusDto,
  ) {
    return this.ordersService.updateItemStatus(user.org, orderId, itemId, dto, user.sub, user.outletId);
  }

  /** Staff (Captain/Manager) releases held items for a paid order or single item */
  @Post(':id/serve-later/release')
  @Require(Permission.ORDER_UPDATE_STATUS)
  @HttpCode(HttpStatus.OK)
  releaseServeLater(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') orderId: string,
    @Body() body?: ReleaseHoldDto,
    @Query('item_id') queryItemId?: string,
  ) {
    const targetItemId = body?.itemId ?? body?.item_id ?? queryItemId;
    return this.ordersService.releaseOrderHeldItemsByStaff(
      user.org,
      orderId,
      user.sub,
      user.outletId,
      targetItemId,
    );
  }

  /** Staff (Captain/Manager) snoozes serve-later prompt for 10 minutes */
  @Post(':id/serve-later/snooze')
  @Require(Permission.ORDER_UPDATE_STATUS)
  @HttpCode(HttpStatus.OK)
  snoozeServeLater(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') orderId: string,
    @Body() dto?: SnoozeServeLaterDto,
  ) {
    return this.kitchenSchedulerService.snoozeServeLater(
      user.org,
      orderId,
      dto?.minutes ?? 10,
    );
  }
}

/**
 * Customer-facing Orders Controller.
 * Protected by Guest Session JWT (issued on QR table scan) or Customer JWT.
 * Reference: ARCH §8, §9, §12, AGENTS §2 rule 4
 */
@Controller('customer/orders')
export class CustomerOrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly kitchenSchedulerService: KitchenSchedulerService,
  ) {}

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

  @Get('sessions/:sessionId/orders')
  @Require(Permission.GUEST_SESSION)
  getSessionsOrdersAlias(
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

  /** Customer signals the kitchen to prepare an on-hold dish now (e.g. Filter Coffee / dessert). */
  @Patch(':id/items/:itemId/release-hold')
  @Post(':id/items/:itemId/release-hold')
  @Require(Permission.GUEST_SESSION)
  @HttpCode(HttpStatus.OK)
  releaseItemHold(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('id') orderId: string,
    @Param('itemId') itemId: string,
  ) {
    return this.ordersService.releaseItemHold(
      user.org,
      orderId,
      itemId,
      user.sub,
      toCustomerAccessScope(user),
    );
  }

  /** Customer releases either a single held dish or all held dishes on that order */
  @Post(':id/serve-later/release')
  @Require(Permission.GUEST_SESSION)
  @HttpCode(HttpStatus.OK)
  releaseCustomerServeLater(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('id') orderId: string,
    @Body() body?: ReleaseHoldDto,
    @Query('item_id') queryItemId?: string,
  ) {
    const targetItemId = body?.itemId ?? body?.item_id ?? queryItemId;
    return this.ordersService.releaseCustomerOrderHeldItems(
      user.org,
      orderId,
      user.sub,
      toCustomerAccessScope(user),
      targetItemId,
    );
  }

  /** Customer snoozes the serve-later prompt for 10 minutes */
  @Post(':id/serve-later/snooze')
  @Require(Permission.GUEST_SESSION)
  @HttpCode(HttpStatus.OK)
  snoozeServeLater(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('id') orderId: string,
    @Body() dto?: SnoozeServeLaterDto,
  ) {
    return this.kitchenSchedulerService.snoozeServeLater(user.org, orderId, dto?.minutes ?? 10);
  }
}

/**
 * Customer Reservations Controller — public availability check
 */
@Controller('customer/reservations')
export class CustomerReservationsController {
  constructor(private readonly kitchenSchedulerService: KitchenSchedulerService) {}

  @Post('check-availability')
  @Public()
  @HttpCode(HttpStatus.OK)
  checkAvailability(@Body() dto: CheckAvailabilityDto) {
    return this.kitchenSchedulerService.checkAvailability(dto.outlet_id, dto);
  }

  @Post()
  @Public()
  @HttpCode(HttpStatus.CREATED)
  createReservation(
    @Body() dto: CreateReservationDto,
    @CurrentUser() user?: GuestSessionJwtPayload | CustomerJwtPayload,
  ) {
    const customerId = user && 'sub' in user ? user.sub : null;
    return this.kitchenSchedulerService.createReservation(dto.outlet_id, dto, customerId);
  }
}
