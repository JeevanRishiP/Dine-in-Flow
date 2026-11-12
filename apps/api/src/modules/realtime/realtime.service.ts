/**
 * RealtimeService — bridges per-org Redis pub/sub channels to active SSE / WebSocket connections.
 *
 * Redis channel format: `dineflow:orders:{org_id}`
 * Dynamically subscribes/unsubscribes ONLY for orgs with active local sockets/streams
 * so horizontally scaled pods don't receive cross-tenant broadcast storms.
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

export const ORDERS_CHANNEL_PREFIX = 'dineflow:orders:';

export interface OutboxMessage {
  id: string;
  org_id: string;
  outlet_id?: string;
  aggregate: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  ts: string;
}

type OrgId = string;

@Injectable()
export class RealtimeService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RealtimeService.name);

  /** Map from org_id → Set of RxJS Subjects (one per SSE connection) */
  private readonly sseSubjects = new Map<OrgId, Set<Subject<{ data: string; id?: string }>>>();

  /** Emitter functions keyed by `${orgId}` (org-wide) or `${orgId}:${outletId}` (outlet-scoped) */
  private readonly wsEmitters = new Map<string, Set<(msg: OutboxMessage) => void>>();

  /** Active Redis per-org subscription ref counts */
  private readonly orgSubscriberCounts = new Map<OrgId, number>();

  private subscriber: Redis | null = null;

  onApplicationBootstrap() {
    this.subscriber = getRedisSubscriber();
    this.subscriber.on('message', (_channel, rawMessage) => {
      this.dispatch(rawMessage);
    });
    this.logger.log('RealtimeService initialized with per-org dynamic Redis subscriptions');
  }

  onApplicationShutdown() {
    if (this.subscriber) {
      const channels = Array.from(this.orgSubscriberCounts.keys()).map(
        (orgId) => `${ORDERS_CHANNEL_PREFIX}${orgId}`,
      );
      if (channels.length > 0) {
        void this.subscriber.unsubscribe(...channels);
      }
      this.orgSubscriberCounts.clear();
    }
    this.sseSubjects.clear();
    this.wsEmitters.clear();
  }

  private retainOrgChannel(orgId: string) {
    const prev = this.orgSubscriberCounts.get(orgId) ?? 0;
    this.orgSubscriberCounts.set(orgId, prev + 1);
    if (prev === 0 && this.subscriber) {
      void this.subscriber.subscribe(`${ORDERS_CHANNEL_PREFIX}${orgId}`).catch((err) => {
        this.logger.error(`Redis SUBSCRIBE failed for org ${orgId}`, err);
      });
    }
  }

  private releaseOrgChannel(orgId: string) {
    const prev = this.orgSubscriberCounts.get(orgId) ?? 0;
    const next = Math.max(0, prev - 1);
    if (next === 0) {
      this.orgSubscriberCounts.delete(orgId);
      if (this.subscriber) {
        void this.subscriber.unsubscribe(`${ORDERS_CHANNEL_PREFIX}${orgId}`).catch(() => {});
      }
    } else {
      this.orgSubscriberCounts.set(orgId, next);
    }
  }

  dispatch(rawMessage: string) {
    let msg: OutboxMessage;
    try {
      msg = JSON.parse(rawMessage) as OutboxMessage;
    } catch {
      this.logger.warn('Received unparseable realtime message');
      return;
    }

    // Fan out to SSE subjects for this org
    const sseSet = this.sseSubjects.get(msg.org_id);
    if (sseSet) {
      const payload = { data: rawMessage, id: msg.id };
      for (const subject of sseSet) {
        try { subject.next(payload); } catch { /* connection closed */ }
      }
    }

    // Fan out to org-wide WS emitters AND outlet-scoped WS emitters
    const orgEmitters = this.wsEmitters.get(msg.org_id);
    if (orgEmitters) {
      for (const emit of orgEmitters) {
        try { emit(msg); } catch { /* socket closed */ }
      }
    }

    const msgPayload =
      msg.payload && typeof msg.payload === 'object'
        ? (msg.payload as Record<string, unknown>)
        : {};
    const msgOutletId =
      msg.outlet_id ??
      (typeof msgPayload['outlet_id'] === 'string' ? msgPayload['outlet_id'] : undefined);

    if (msgOutletId) {
      const outletEmitters = this.wsEmitters.get(`${msg.org_id}:${msgOutletId}`);
      if (outletEmitters) {
        for (const emit of outletEmitters) {
          try { emit(msg); } catch { /* socket closed */ }
        }
      }
    }
  }

  /** SSE: register a subject for a specific org. Returns deregister fn. */
  registerSseSubject(
    orgId: string,
    subject: Subject<{ data: string; id?: string }>,
  ): () => void {
    let set = this.sseSubjects.get(orgId);
    if (!set) {
      set = new Set();
      this.sseSubjects.set(orgId, set);
    }
    set.add(subject);
    this.retainOrgChannel(orgId);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const cur = this.sseSubjects.get(orgId);
      if (cur) {
        cur.delete(subject);
        if (cur.size === 0) {
          this.sseSubjects.delete(orgId);
        }
      }
      this.releaseOrgChannel(orgId);
    };
  }

  /** WS: register an emitter function scoped to org or org+outlet. Returns deregister fn. */
  registerWsEmitter(
    orgId: string,
    emitter: (msg: OutboxMessage) => void,
    outletId?: string,
  ): () => void {
    const key = outletId ? `${orgId}:${outletId}` : orgId;
    let set = this.wsEmitters.get(key);
    if (!set) {
      set = new Set();
      this.wsEmitters.set(key, set);
    }
    set.add(emitter);
    this.retainOrgChannel(orgId);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const cur = this.wsEmitters.get(key);
      if (cur) {
        cur.delete(emitter);
        if (cur.size === 0) {
          this.wsEmitters.delete(key);
        }
      }
      this.releaseOrgChannel(orgId);
    };
  }
}
