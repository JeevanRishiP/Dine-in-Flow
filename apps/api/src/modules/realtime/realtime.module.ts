/**
 * Realtime Module — SSE (customers) + WebSocket (staff/KDS)
 *
 * Architecture (ARCH §10, D8):
 *  - Customers: Server-Sent Events (SSE) via `GET /customer/orders/:id/events`
 *    Simpler, proxy-friendly, automatic reconnect with Last-Event-ID.
 *  - Staff/KDS: Socket.IO WebSocket via `@WebSocketGateway` on /ws/console
 *    JWT handshake, outlet-scoped rooms, bidirectional acks.
 *
 * Both subscribe to the Redis pub/sub channel published by OutboxRelayService.
 * A single Redis subscriber connection is shared (multiplexed by channel pattern).
 *
 * NEEDS_HUMAN_REVIEW: connection caps, authentication in WS handshake
 */

import { Module } from '@nestjs/common';
import { SseController } from './sse.controller.js';
import { KdsGateway } from './kds.gateway.js';
import { RealtimeService } from './realtime.service.js';

@Module({
  providers: [KdsGateway, RealtimeService],
  controllers: [SseController],
})
export class RealtimeModule {}
