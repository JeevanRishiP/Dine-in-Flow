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
  CurrentUser,
  type StaffJwtPayload,
  type CustomerJwtPayload,
  type GuestSessionJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { resolveScopedOutletId } from '../../common/utils/outlet-scope.utils.js';
import { AiService } from './ai.service.js';
import { AiChatSchema, AiReindexSchema, type AiChatDto } from './ai.dto.js';

/**
 * Public & Customer AI Menu Assistant Controller.
 * Enables diners to ask about menu items, allergies, and propose cart additions.
 * Protected by GuestSession / Customer JWT so unauthenticated traffic cannot drain AI quota.
 * Reference: ARCH §21
 */
@Controller()
export class CustomerAiController {
  constructor(private readonly aiService: AiService) {}

  /**
   * Table-session chat endpoint for guest diners at tables.
   */
  @Post('public/ai/chat')
  @Require(Permission.GUEST_SESSION)
  @HttpCode(HttpStatus.OK)
  async chatPublic(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Body() body: Record<string, unknown>,
  ) {
    const raw = body || {};
    const normalized: Record<string, unknown> = {
      message: raw['message'],
      orgId: user.org,
      outletId: user.type === 'guest_session' ? user.outlet : (raw['outletId'] || raw['outlet_id']),
    };
    if (user.type === 'guest_session') {
      normalized['tableSessionId'] = user.sessionId;
    } else if (raw['tableSessionId'] || raw['table_session_id']) {
      normalized['tableSessionId'] = raw['tableSessionId'] || raw['table_session_id'];
    }
    if (raw['sessionId'] || raw['session_id']) {
      normalized['sessionId'] = raw['sessionId'] || raw['session_id'];
    }
    const dto = AiChatSchema.parse(normalized);
    const customerId = user.type === 'customer_access' ? user.sub : (user.customerId ?? null);
    return this.aiService.chat(dto, customerId);
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
    const scopedOutlet = resolveScopedOutletId(user.outletId, dto.outletId) ?? dto.outletId;
    return this.aiService.reindexOutletMenu(user.org, scopedOutlet);
  }
}
