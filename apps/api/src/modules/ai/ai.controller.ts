import {
  Controller,
  Post,
  Body,
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
import { AiService } from './ai.service.js';
import { AiChatSchema, AiReindexSchema, type AiChatDto, type AiReindexDto } from './ai.dto.js';

/**
 * Public & Customer AI Menu Assistant Controller.
 * Enables diners to ask about menu items, allergies, and propose cart additions.
 * Reference: ARCH §21
 */
@Controller()
export class CustomerAiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Public chat endpoint for guest diners at tables.
   */
  @Post('public/ai/chat')
  @Public()
  @HttpCode(HttpStatus.OK)
  async chatPublic(@Body() body: Record<string, unknown>) {
    const raw = body || {};
    const normalized: Record<string, unknown> = {
      message: raw['message'],
      orgId: raw['orgId'] || raw['org_id'],
      outletId: raw['outletId'] || raw['outlet_id'],
    };
    if (raw['tableSessionId'] || raw['table_session_id']) {
      normalized['tableSessionId'] = raw['tableSessionId'] || raw['table_session_id'];
    }
    if (raw['sessionId'] || raw['session_id']) {
      normalized['sessionId'] = raw['sessionId'] || raw['session_id'];
    }
    const dto = AiChatSchema.parse(normalized);
    return this.aiService.chat(dto, null);
  }

  /**
   * Authenticated chat endpoint for signed-in diners.
   */
  @Post('me/ai/chat')
  @Require(Permission.CUSTOMER_READ)
  @HttpCode(HttpStatus.OK)
  async chatAuth(
    @CurrentUser() user: CustomerJwtPayload,
    @Body() body: unknown,
  ) {
    const parsed = AiChatSchema.parse(body);
    // Ensure orgId matches the customer's authenticated org
    const dto: AiChatDto = { ...parsed, orgId: user.org };
    return this.aiService.chat(dto, user.sub);
  }
}

/**
 * Staff Console AI Management Controller.
 * Allows managers/owners to reindex menu embeddings.
 */
@Controller('console/ai')
export class ConsoleAiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Trigger semantic menu embeddings reindex for an outlet.
   */
  @Post('reindex')
  @Require(Permission.AI_MANAGE)
  @HttpCode(HttpStatus.OK)
  async reindexOutletMenu(
    @CurrentUser() user: StaffJwtPayload,
    @Body() body: unknown,
  ) {
    const dto = AiReindexSchema.parse(body);
    return this.aiService.reindexOutletMenu(user.org, dto.outletId);
  }
}
