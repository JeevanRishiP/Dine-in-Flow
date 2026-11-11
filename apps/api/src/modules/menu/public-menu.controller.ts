import { Controller, Get, Query, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/auth.decorators.js';
import { MenuService } from './menu.service.js';
import { MenuQueryDto } from './menu.dto.js';

/**
 * Public menu endpoint — no authentication required.
 * Implements ETag + Cache-Control per ARCH §13.
 */
@Controller('public/menu')
export class PublicMenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get(':orgId')
  @Public()
  async getMenu(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: MenuQueryDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const data = await this.menuService.getPublicMenu(orgId, query.outlet_id);

    const etag = `"v${data.version}"`;
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');
    reply.header('Vary', 'Accept-Encoding');

    return {
      version: data.version,
      categories: data.categories,
      items: data.items,
    };
  }
}
