/**
 * SSE Controller — Server-Sent Events for customer order tracking.
 *
 * Protected by GuestSession / Customer JWT + tenant/session ownership verification.
 * Uses reply.hijack() for proper Fastify stream lifecycle, supports Last-Event-ID replay,
 * and cleans up connection maps deterministically on disconnect.
 *
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

const connectionCount = new Map<string, number>();

@Controller()
export class SseController {
  private readonly logger = new Logger(SseController.name);

  constructor(private readonly realtimeService: RealtimeService) {}

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
    const lastEventIdHeader = req.headers['last-event-id'];
    const lastEventId =
      typeof lastEventIdHeader === 'string' && /^[0-9a-f-]{36}$/i.test(lastEventIdHeader)
        ? lastEventIdHeader
        : undefined;

    const replayMessages = await withTenantContextRaw(orgId, async (db) => {
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

      if (!lastEventId) return [];

      const { rows: replay } = await db.query<{
        id: string;
        org_id: string;
        aggregate: string;
        aggregate_id: string;
        event_type: string;
        payload: unknown;
        created_at: Date;
      }>(
        `SELECT id, org_id, aggregate, aggregate_id, event_type, payload, created_at
         FROM outbox_events
         WHERE org_id = $1
           AND aggregate_id = $2
           AND created_at > COALESCE(
             (SELECT created_at FROM outbox_events WHERE id = $3 AND org_id = $1 LIMIT 1),
             '-infinity'::timestamptz
           )
         ORDER BY created_at ASC
         LIMIT 50`,
        [orgId, orderId, lastEventId],
      );
      return replay;
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

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    for (const ev of replayMessages) {
      const data = JSON.stringify({
        id: ev.id,
        org_id: ev.org_id,
        aggregate: ev.aggregate,
        aggregateId: ev.aggregate_id,
        eventType: ev.event_type,
        payload: ev.payload,
        ts: new Date(ev.created_at).toISOString(),
      });
      if (!reply.raw.writableEnded) {
        reply.raw.write(`id: ${ev.id}\ndata: ${data}\n\n`);
      }
    }

    const subject = new Subject<{ data: string; id?: string }>();
    const deregister = this.realtimeService.registerSseSubject(orgId, subject);

    const heartbeat = setInterval(() => {
      if (!reply.raw.writableEnded) {
        reply.raw.write(': heartbeat\n\n');
      }
    }, HEARTBEAT_INTERVAL_MS);

    const subscription = subject.subscribe({
      next: ({ data, id }) => {
        if (!reply.raw.writableEnded) {
          try {
            const msg = JSON.parse(data) as { aggregateId?: string; id?: string };
            if (msg.aggregateId !== orderId) return;
            const eventId = id ?? msg.id;
            if (eventId) {
              reply.raw.write(`id: ${eventId}\ndata: ${data}\n\n`);
            } else {
              reply.raw.write(`data: ${data}\n\n`);
            }
          } catch {
            return;
          }
        }
      },
      error: (err: unknown) => {
        this.logger.error('SSE subject error', err);
      },
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(heartbeat);
      subscription.unsubscribe();
      deregister();
      const next = Math.max(0, (connectionCount.get(orderId) ?? 1) - 1);
      if (next === 0) {
        connectionCount.delete(orderId);
      } else {
        connectionCount.set(orderId, next);
      }
      this.logger.debug(`SSE connection closed for order ${orderId}`);
    };

    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  }
}
