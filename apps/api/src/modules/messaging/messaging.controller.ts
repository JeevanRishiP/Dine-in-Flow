import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Permission } from '@dineflow/contracts';
import {
  Require,
  Public,
  CurrentUser,
  type StaffJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import type { CustomerJwtPayload } from '../auth/token.service.js';
import { MessagingService } from './messaging.service.js';
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
   * Customer updates their communication consents (e.g. MARKETING_WHATSAPP).
   */
  @Post('me/consents')
  @Require(Permission.CUSTOMER_READ)
  @HttpCode(HttpStatus.OK)
  recordConsent(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() dto: RecordConsentDto,
  ) {
    return this.messagingService.recordConsent(user.org, user.sub, dto);
  }
}

@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(private readonly messagingService: MessagingService) {}

  /**
   * Inbound delivery status updates and STOP / UNSUBSCRIBE messages.
   * Public webhook called by Evolution API or Meta Cloud API.
   */
  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  handleWebhook(@Body() payload: any) {
    return this.messagingService.handleInboundWebhook(payload);
  }
}
