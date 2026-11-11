/**
 * Module-level Redis singleton.
 * Used by:
 *   - OutboxRelayService (pub/sub publisher)
 *   - RealtimeGateway (subscriber — uses a dedicated subscriber connection)
 *   - BullMQ workers (Phase 5+)
 *
 * Pub/sub requires separate connections:
 *   getRedis()       → shared command connection
 *   getRedisSubscriber() → dedicated subscriber connection
 *
 * Reference: ARCH §10 (Redis pub/sub), ioredis docs
 */

import { Redis } from 'ioredis';
import { getConfig } from '../../config/config.js';

export const REDIS_CLIENT     = 'REDIS_CLIENT';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

let commandClient: Redis | undefined;
let subscriberClient: Redis | undefined;

function makeRedis(): Redis {
  const config = getConfig();
  const client = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null, // required for BullMQ
    enableReadyCheck: true,
    lazyConnect: false,
  });
  client.on('error', (err: Error) => {
    // Log but don't crash — ioredis auto-reconnects
    console.error('[Redis] client error:', err.message);
  });
  return client;
}

/** Shared command connection (GET/SET/PUBLISH/etc). */
export function getRedis(): Redis {
  if (!commandClient) commandClient = makeRedis();
  return commandClient;
}

/** Dedicated subscriber connection (SUBSCRIBE/PSUBSCRIBE). */
export function getRedisSubscriber(): Redis {
  if (!subscriberClient) subscriberClient = makeRedis();
  return subscriberClient;
}
