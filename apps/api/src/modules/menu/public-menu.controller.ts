import { Controller, Get, Query, Param, ParseUUIDPipe, Req, Res } from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/auth.decorators.js';
import { MenuService } from './menu.service.js';
import { MenuQueryDto } from './menu.dto.js';

import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';

/**
 * Public menu endpoint — no authentication required.
 * Implements ETag / If-None-Match 304 + Cache-Control per ARCH §13.
 */
@Controller('public/menu')
export class PublicMenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('photos/:itemId')
  @Public()
  async getItemPhoto(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Res() reply: FastifyReply,
  ) {
    const photo = await this.menuService.getPublicPhoto(itemId);
    if (!photo) {
      throw domainError(ErrorCode.NOT_FOUND, 'Menu photo not found.', 404);
    }
    reply.header('Content-Type', photo.mimeType);
    reply.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    return reply.send(photo.buffer);
  }

  @Get(':orgId')
  @Public()
  async getMenu(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query() query: MenuQueryDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const data = await this.menuService.getPublicMenu(orgId, query.outlet_id);

    const etag = `"v${data.version}"`;
    reply.header('ETag', etag);
    reply.header('Cache-Control', 'public, max-age=10, stale-while-revalidate=60');
    reply.header('Vary', 'Accept-Encoding');

    const ifNoneMatch = req.headers['if-none-match'];
    if (typeof ifNoneMatch === 'string' && ifNoneMatch.trim() === etag) {
      reply.code(304);
      return '';
    }

    return {
      version: data.version,
      categories: data.categories,
      items: data.items,
    };
  }
}
