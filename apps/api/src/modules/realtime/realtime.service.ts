/**
 * RealtimeService — bridges Redis pub/sub to active SSE / WebSocket connections.
 *
 * Redis channel format: `dineflow:orders:{org_id}`
 * One Redis subscriber connection handles ALL orgs via PSUBSCRIBE pattern.
 *
 * Reference: ARCH §10, AGENTS §2 rule 7
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import { getRedisSubscriber } from '../../common/redis/redis.client.js';
import type { Subject } from 'rxjs';

export const ORDERS_CHANNEL_PATTERN = 'dineflow:orders:*';

export interface OutboxMessage {
  id: string;
  org_id: string;
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  ts: string;
}

/** Subscriber reference so the SSE controller + WS gateway can filter messages. */
type OrgId = string;

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);

  /** Map from org_id → Set of RxJS Subjects (one per SSE connection) */
  private readonly sseSubjects = new Map<OrgId, Set<Subject<{ data: string }>>>();

  /** Emitter functions for each WebSocket room (org_id + outlet_id) */
  private readonly wsEmitters = new Map<string, Set<(msg: OutboxMessage) => void>>();

  private subscriber: Redis | null = null;

  onApplicationBootstrap() {
    this.subscriber = getRedisSubscriber();
    this.subscriber.psubscribe(ORDERS_CHANNEL_PATTERN, (err) => {
      if (err) this.logger.error('Redis PSUBSCRIBE failed', err);
      else this.logger.log(`Subscribed to pattern: ${ORDERS_CHANNEL_PATTERN}`);
    });
    this.subscriber.on('pmessage', (_pattern, _channel, rawMessage) => {
      this.dispatch(rawMessage);
    });
  }

  onApplicationShutdown() {
    if (this.subscriber) {
      void this.subscriber.punsubscribe(ORDERS_CHANNEL_PATTERN);
    }
  }

  private dispatch(rawMessage: string) {
    let msg: OutboxMessage;
    try {
      msg = JSON.parse(rawMessage) as OutboxMessage;
    } catch {
      this.logger.warn('Received unparseable realtime message');
      return;
    }

    // Fan out to SSE subjects
    const sseSet = this.sseSubjects.get(msg.org_id);
    if (sseSet) {
      const payload = { data: rawMessage };
      for (const subject of sseSet) {
        try { subject.next(payload); } catch { /* connection closed */ }
      }
    }

    // Fan out to WS emitters (outlet-scoped rooms)
    const roomKey = `${msg.org_id}`;
    const wsSet = this.wsEmitters.get(roomKey);
    if (wsSet) {
      for (const emit of wsSet) {
        try { emit(msg); } catch { /* socket closed */ }
      }
    }
  }

  /** SSE: register a subject for a specific org. Returns deregister fn. */
  registerSseSubject(orgId: string, subject: Subject<{ data: string }>): () => void {
    if (!this.sseSubjects.has(orgId)) {
      this.sseSubjects.set(orgId, new Set());
    }
    this.sseSubjects.get(orgId)!.add(subject);
    return () => {
      this.sseSubjects.get(orgId)?.delete(subject);
    };
  }

  /** WS: register an emitter function for a specific org. Returns deregister fn. */
  registerWsEmitter(orgId: string, emitter: (msg: OutboxMessage) => void): () => void {
    const key = orgId;
    if (!this.wsEmitters.has(key)) {
      this.wsEmitters.set(key, new Set());
    }
    this.wsEmitters.get(key)!.add(emitter);
    return () => {
      this.wsEmitters.get(key)?.delete(emitter);
    };
  }
}
