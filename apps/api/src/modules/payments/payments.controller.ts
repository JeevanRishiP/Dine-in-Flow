/**
 * Payments Controllers
 *
 * ConsolePaymentsController — staff-facing payment initiation + refunds.
 * PublicWebhookController   — raw signature-verified webhook endpoints (no auth).
 *
 * CRITICAL: Webhook endpoints use `@RawBody()` via Fastify's `addContentTypeParser`
 * to get the raw Buffer BEFORE NestJS parses the body. This is mandatory for
 * PhonePe and Razorpay signature verification (AGENTS §2 rule 9).
 *
 * NEEDS_HUMAN_REVIEW: permissions on payment:create and refunds:create
 */

import {
  Controller,
  Post,
  Get,
  Param,
  Query,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { PaymentsService } from './payments.service.js';
import {
  toCustomerAccessScope,
} from '../../common/utils/ownership.utils.js';
import { CreatePaymentDto, CreateRefundDto, ReconcileReturnQueryDto } from './payments.dto.js';
import {
  Require,
  CurrentUser,
  Public,
  type StaffJwtPayload,
  type CustomerJwtPayload,
  type GuestSessionJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { Permission } from '@dineflow/contracts';

// ──────────────────────────────────────────────────────────────
// Console (Staff) Controller
// ──────────────────────────────────────────────────────────────

@Controller('console/payments')
export class ConsolePaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * POST /console/payments
   * Create a payment for an order. The amount is ALWAYS derived from the order
   * server-side; the client MUST NOT send amount_paise.
   *
   * NEEDS_HUMAN_REVIEW: permission — PAYMENT_CREATE
   */
  @Post()
  @Require(Permission.PAYMENT_MARK_PAID)
  @HttpCode(HttpStatus.CREATED)
  createPayment(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(user.org, dto, user.sub, 'STAFF');
  }

  /**
   * GET /console/payments/:id
   */
  @Get(':id')
  @Require(Permission.ORDER_READ)
  getPayment(@CurrentUser() user: StaffJwtPayload, @Param('id') id: string) {
    return this.paymentsService.getPayment(user.org, id);
  }

  /**
   * POST /console/payments/:id/refund
   * Partial or full refund. Only OWNER/MANAGER (AGENTS §2, ARCH §12 permission matrix).
   *
   * NEEDS_HUMAN_REVIEW: refund permission, partial refund guards
   */
  @Post(':id/refund')
  @Require(Permission.REFUND_CREATE)
  @HttpCode(HttpStatus.CREATED)
  createRefund(
    @CurrentUser() user: StaffJwtPayload,
    @Param('id') paymentId: string,
    @Body() dto: CreateRefundDto,
  ) {
    return this.paymentsService.createRefund(user.org, paymentId, dto, user.sub);
  }
}

// ──────────────────────────────────────────────────────────────
// Public Webhook Controller — NO AUTH, signature verified only
// ──────────────────────────────────────────────────────────────

/**
 * Webhook endpoints MUST:
 *  1. Receive raw body Buffer (not parsed JSON) for signature verification.
 *  2. Insert into webhook_inbox immediately (idempotency guaranteed by UNIQUE index).
 *  3. Return 200 quickly; processing is async.
 *  4. Never reject based on a duplicate event_id (already handled by UNIQUE + idempotent logic).
 *
 * To receive raw body in Fastify, the main.ts must register:
 *   app.addContentTypeParser('application/json', { parseAs: 'buffer' }, ...)
 *   for webhook routes only.
 *
 * Reference: ARCH §11 (webhook rules), AGENTS §2 rule 9
 */
@Controller('webhooks')
export class PublicWebhookController {
  constructor(private readonly paymentsService: PaymentsService) {}

  /**
   * POST /webhooks/phonepe
   * PhonePe S2S callback — receives payment status updates.
   */
  @Post('phonepe')
  @Public()
  @HttpCode(HttpStatus.OK)
  async phonePeWebhook(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const rawBody = req.rawBody as Buffer | undefined;
    if (!rawBody) {
      await reply.status(400).send({ error: 'Raw body not available.' });
      return;
    }
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const result = await this.paymentsService.handleWebhook('phonepe', rawBody, headers);
    await reply.send(result);
  }

  /**
   * POST /webhooks/razorpay
   * Razorpay event webhook — receives payment.captured, payment.failed, etc.
   */
  @Post('razorpay')
  @Public()
  @HttpCode(HttpStatus.OK)
  async razorpayWebhook(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const rawBody = req.rawBody as Buffer | undefined;
    if (!rawBody) {
      await reply.status(400).send({ error: 'Raw body not available.' });
      return;
    }
    const headers = req.headers as Record<string, string | string[] | undefined>;
    const result = await this.paymentsService.handleWebhook('razorpay', rawBody, headers);
    await reply.send(result);
  }
}

/**
 * Customer Payments Controller — allows authenticated table-session guests or signed-in
 * customers to initiate online payments, request pay-at-counter bills, and verify status.
 *
 * SECURITY (P0): Never expose simulate-success endpoints on the public API and never let
 * customer callers mark CASH/PAY_AT_COUNTER orders as PAID.
 * Reference: ARCH §11, AGENTS §2 rules 2, 4, 9
 */
@Controller('customer/payments')
export class CustomerPaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @Require(Permission.GUEST_SESSION)
  @HttpCode(HttpStatus.CREATED)
  createPayment(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.paymentsService.createPayment(
      user.org,
      dto,
      user.sub,
      'CUSTOMER',
      toCustomerAccessScope(user),
    );
  }

  @Get('verify-order')
  @Require(Permission.GUEST_SESSION)
  verifyPaymentByOrder(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Query('orderId') orderId: string,
  ) {
    return this.paymentsService.verifyPaymentByOrder(user.org, orderId, toCustomerAccessScope(user));
  }

  @Get(':id/verify')
  @Require(Permission.GUEST_SESSION)
  verifyPaymentStatus(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('id') id: string,
  ) {
    return this.paymentsService.verifyPaymentStatus(user.org, id, toCustomerAccessScope(user));
  }

  @Get(':id')
  @Require(Permission.GUEST_SESSION)
  getPayment(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('id') id: string,
  ) {
    return this.paymentsService.getPayment(user.org, id, toCustomerAccessScope(user));
  }
}

/**
 * Public Gateway Return Controller — reconciles a transaction using the (orderId, merchantTransactionId)
 * pair when PhonePe redirects back into a new tab / mobile browser without sessionStorage.
 * Never trusts redirect status alone: queries PhonePe/Razorpay server-side before returning status.
 */
@Controller('public/payments')
export class PublicPaymentsReturnController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('reconcile-return')
  @Public()
  reconcileReturn(@Query() query: ReconcileReturnQueryDto) {
    return this.paymentsService.reconcilePublicReturn(query.orderId, query.merchantTransactionId);
  }
}
