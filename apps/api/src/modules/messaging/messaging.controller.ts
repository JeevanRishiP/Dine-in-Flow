import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import crypto from 'node:crypto';
import { Permission, ErrorCode } from '@dineflow/contracts';
import {
  Require,
  Public,
  CurrentUser,
  type StaffJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { domainError } from '../../common/errors/domain-error.js';
import type { CustomerJwtPayload } from '../auth/token.service.js';
import { MessagingService } from './messaging.service.js';
import { verifyMetaWebhookSignature } from './whatsapp-cloud.adapter.js';
import {
  SendMessageDto,
  RecordConsentDto,
  UpdateMessagingSettingsDto,
  MessageQueryDto,
} from './messaging.dto.js';

@Controller('console/messages')
export class ConsoleMessagingController {
  constructor(private readonly messagingService: MessagingService) {}

  @Get()
  @Require(Permission.MESSAGING_READ)
  listMessages(
    @CurrentUser() user: StaffJwtPayload,
    @Query() query: MessageQueryDto,
  ) {
    return this.messagingService.listMessages(user.org, query);
  }

  @Get('settings')
  @Require(Permission.MESSAGING_READ)
  getSettings(@CurrentUser() user: StaffJwtPayload) {
    return this.messagingService.getSettings(user.org);
  }

  @Patch('settings')
  @Require(Permission.MESSAGING_MANAGE)
  updateSettings(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: UpdateMessagingSettingsDto,
  ) {
    return this.messagingService.updateSettings(user.org, dto);
  }

  @Post('send')
  @Require(Permission.MESSAGING_SEND)
  @HttpCode(HttpStatus.OK)
  sendMessage(
    @CurrentUser() user: StaffJwtPayload,
    @Body() dto: SendMessageDto,
  ) {
    return this.messagingService.sendMessage(user.org, dto);
  }
}

@Controller()
export class CustomerConsentController {
  constructor(private readonly messagingService: MessagingService) {}

  /**
   * Customer updates their own communication consents (e.g. MARKETING_WHATSAPP).
   * Binds consent strictly to the authenticated customer's verified phone number.
   */
  @Post('me/consents')
  @Require(Permission.CUSTOMER_READ)
  @HttpCode(HttpStatus.OK)
  recordConsent(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: RecordConsentDto,
  ) {
    const reqDigits = dto.phone.replace(/\D/g, '');
    const userDigits = (user.phone || '').replace(/\D/g, '');
    if (!userDigits || reqDigits !== userDigits) {
      throw domainError(
        ErrorCode.FORBIDDEN,
        'Cannot record consent for another phone number.',
        403,
      );
    }
    return this.messagingService.recordConsent(user.org, user.sub, dto);
  }
}

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly messagingService: MessagingService) {}

  /**
   * Meta WhatsApp Cloud API webhook verification challenge.
   */
  @Get()
  @Public()
  verifyWebhookChallenge(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') verifyToken: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const expectedToken = process.env['WHATSAPP_WEBHOOK_VERIFY_TOKEN'];
    if (
      mode === 'subscribe' &&
      expectedToken &&
      verifyToken &&
      expectedToken.length === verifyToken.length &&
      crypto.timingSafeEqual(Buffer.from(expectedToken, 'utf8'), Buffer.from(verifyToken, 'utf8'))
    ) {
      return reply.status(HttpStatus.OK).type('text/plain').send(challenge ?? '');
    }
    return reply.status(HttpStatus.FORBIDDEN).send({ error: 'Invalid webhook verify token' });
  }

  /**
   * Inbound delivery status updates and STOP / UNSUBSCRIBE messages.
   * Requires valid Meta X-Hub-Signature-256 HMAC over raw body Buffer (AGENTS §2 rule 9).
   */
  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Req() req: FastifyRequest, @Body() payload: unknown) {
    const appSecret = process.env['WHATSAPP_APP_SECRET'];
    const rawBody = req.rawBody as Buffer | undefined;
    const signature = req.headers['x-hub-signature-256'];

    if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
      throw domainError(
        ErrorCode.WEBHOOK_SIGNATURE_INVALID,
        'Invalid or missing WhatsApp webhook signature.',
        401,
      );
    }

    return this.messagingService.handleInboundWebhook(payload);
  }
}
