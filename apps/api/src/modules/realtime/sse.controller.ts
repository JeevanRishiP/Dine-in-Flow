/**
 * SSE Controller — Server-Sent Events for customer order tracking.
 *
 * Endpoint: GET /customer/orders/:id/events
 *   - No auth required (order ID is a random UUID, acts as a capability token).
 *   - Returns an EventSource stream.
 *   - Heartbeat every 25 s to keep proxies alive.
 *   - `Last-Event-ID` header support for resume after reconnect.
 *
 * NEEDS_HUMAN_REVIEW: add customer session validation in Phase 4+
 * Reference: ARCH §10 (SSE for customers), D8
 */

import {
  Controller,
  Get,
  Param,
  Req,
  Res,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { Permission, ErrorCode } from '@dineflow/contracts';
import {
  Require,
  CurrentUser,
  type CustomerJwtPayload,
  type GuestSessionJwtPayload,
} from '../../common/decorators/auth.decorators.js';
import { domainError } from '../../common/errors/domain-error.js';
import {
  assertCustomerAccessScope,
  toCustomerAccessScope,
} from '../../common/utils/ownership.utils.js';
import { withTenantContextRaw } from '../../db/client.js';
import { RealtimeService } from './realtime.service.js';
import { Subject } from 'rxjs';

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_SSE_CONNECTIONS_PER_ORDER = 3;

// Simple connection cap per order_id (guards against DoS)
const connectionCount = new Map<string, number>();

@Controller()
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(private readonly realtimeService: RealtimeService) {}

  /**
   * Customer SSE stream for a single order.
   * Streams order events as they are published to Redis.
   *
   * The response is kept open until the client disconnects.
   * We use raw Fastify reply to set SSE headers and flush.
   */
  @Get('customer/orders/:orgId/:orderId/events')
  @Require(Permission.GUEST_SESSION)
  async orderEvents(
    @CurrentUser() user: GuestSessionJwtPayload | CustomerJwtPayload,
    @Param('orgId') orgId: string,
    @Param('orderId') orderId: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (user.org !== orgId) {
      throw domainError(ErrorCode.FORBIDDEN, 'Access denied for this tenant.', 403);
    }

    const scope = toCustomerAccessScope(user);
    await withTenantContextRaw(orgId, async (db) => {
      const { rows } = await db.query<{
        id: string;
        session_id: string | null;
        customer_id: string | null;
        session_customer_id: string | null;
      }>(
        `SELECT o.id, o.session_id, o.customer_id, ts.customer_id AS session_customer_id
         FROM orders o
         LEFT JOIN table_sessions ts ON ts.id = o.session_id AND ts.org_id = o.org_id
         WHERE o.id = $1 AND o.org_id = $2`,
        [orderId, orgId],
      );
      if (!rows[0]) {
        throw domainError(ErrorCode.NOT_FOUND, 'Order not found.', 404);
      }
      assertCustomerAccessScope(scope, rows[0]);
    });

    // Connection cap per order
    const count = connectionCount.get(orderId) ?? 0;
    if (count >= MAX_SSE_CONNECTIONS_PER_ORDER) {
      await reply.status(HttpStatus.TOO_MANY_REQUESTS).send({
        error: 'Too many connections for this order.',
      });
      return;
    }
    connectionCount.set(orderId, count + 1);

    // SSE headers
    await reply.raw.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });

    const subject = new Subject<{ data: string }>();
    const deregister = this.realtimeService.registerSseSubject(orgId, subject);

    // Heartbeat to keep the connection alive through proxies
    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': heartbeat\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Subscribe to events
    const subscription = subject.subscribe({
      next: ({ data }) => {
        if (!reply.raw.writableEnded) {
          // Filter to only events for this order
          try {
            const msg = JSON.parse(data) as { aggregateId?: string; id?: string };
            if (msg.aggregateId !== orderId) return;
          } catch {
            return;
          }
          reply.raw.write(`data: ${data}\n\n`);
        }
      },
      error: (err: unknown) => {
        this.logger.error('SSE subject error', err);
      },
    });

    // Cleanup on client disconnect
    const cleanup = () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      deregister();
      connectionCount.set(orderId, Math.max(0, (connectionCount.get(orderId) ?? 1) - 1));
      this.logger.debug(`SSE connection closed for order ${orderId}`);
    };

    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  }
}
