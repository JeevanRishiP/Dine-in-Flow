/**
 * KDS WebSocket Gateway — Staff / Kitchen Display System realtime channel.
 *
 * Path:        /ws/console
 * Namespace:   /kds
 * Auth:        JWT handshake via `auth` socket option (Bearer token)
 * Rooms:       `org:{org_id}` (scoped by org; outlet filter applied server-side)
 *
 * Clients join their org room on connect. The gateway receives outbox events
 * from RealtimeService and emits them to the appropriate org room.
 *
 * Events emitted to clients:
 *   `order:event` — payload: OutboxMessage
 *
 * Events received from clients:
 *   `order:ack` — { eventId: string } — client acknowledges it received the event
 *
 * Connection cap: MAX_CONNECTIONS_PER_ORG per org.
 *
 * NEEDS_HUMAN_REVIEW: JWT verification in WS handshake, outlet room scoping
 * Reference: ARCH §10 (WebSocket for staff), D8
 */

import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { RealtimeService, type OutboxMessage } from './realtime.service.js';
import { getConfig } from '../../config/config.js';
import { verifyJwt } from '../../common/utils/jwt.utils.js';

const MAX_CONNECTIONS_PER_ORG = 100;
const orgConnectionCount = new Map<string, number>();

@WebSocketGateway({
  namespace: '/kds',
  cors: { origin: true, credentials: true },
  transports: ['websocket'],
})
export class KdsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  private readonly logger = new Logger(KdsGateway.name);

  /** Map from socket.id → deregister function */
  private readonly cleanupMap = new Map<string, () => void>();

  constructor(private readonly realtimeService: RealtimeService) {}

  afterInit() {
    this.logger.log('KDS WebSocket gateway initialized (namespace=/kds)');
  }

  async handleConnection(socket: Socket) {
    // ── Auth ────────────────────────────────────────────────────────────────────
    const token = this.extractToken(socket);
    if (!token) {
      socket.emit('error', { message: 'Missing auth token.' });
      socket.disconnect(true);
      return;
    }

    const config = getConfig();
    const payload = verifyJwt(token, config.JWT_SECRET);
    if (!payload || payload.type !== 'staff_access') {
      socket.emit('error', { message: 'Invalid or expired token.' });
      socket.disconnect(true);
      return;
    }

    const orgId = payload.org;

    // ── Connection cap ─────────────────────────────────────────────────────────
    const count = orgConnectionCount.get(orgId) ?? 0;
    if (count >= MAX_CONNECTIONS_PER_ORG) {
      socket.emit('error', { message: 'Connection limit reached for this org.' });
      socket.disconnect(true);
      return;
    }
    orgConnectionCount.set(orgId, count + 1);

    // ── Join org room ──────────────────────────────────────────────────────────
    await socket.join(`org:${orgId}`);
    socket.data['orgId']  = orgId;
    socket.data['role']   = payload.role;
    this.logger.debug(`Staff connected: socket=${socket.id} org=${orgId} role=${payload.role}`);

    // ── Subscribe to realtime events ───────────────────────────────────────────
    const deregister = this.realtimeService.registerWsEmitter(orgId, (msg: OutboxMessage) => {
      socket.emit('order:event', msg);
    });
    this.cleanupMap.set(socket.id, deregister);

    socket.emit('connected', { org_id: orgId });
  }

  handleDisconnect(socket: Socket) {
    const orgId = socket.data['orgId'] as string | undefined;
    if (orgId) {
      orgConnectionCount.set(orgId, Math.max(0, (orgConnectionCount.get(orgId) ?? 1) - 1));
    }
    const deregister = this.cleanupMap.get(socket.id);
    if (deregister) {
      deregister();
      this.cleanupMap.delete(socket.id);
    }
    this.logger.debug(`Staff disconnected: socket=${socket.id}`);
  }

  /** Client acknowledges receipt of an event (bidirectional ack). */
  @SubscribeMessage('order:ack')
  handleAck(
    @MessageBody() body: { eventId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    this.logger.debug(`ACK from socket=${socket.id} eventId=${body.eventId}`);
    // Phase 5+: mark event acknowledged in DB for at-least-once guarantees
    return { ok: true };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────────

  private extractToken(socket: Socket): string | null {
    const auth = socket.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token;
    const header = socket.handshake.headers['authorization'] ?? '';
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    return null;
  }
}
