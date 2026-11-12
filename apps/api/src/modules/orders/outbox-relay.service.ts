/**
 * Outbox Relay Worker
 *
 * Reads undelivered rows from `outbox_events` using FOR UPDATE SKIP LOCKED
 * (safe for multiple replicas), publishes each event to Redis pub/sub, then
 * marks it delivered. At-least-once delivery; consumers must be idempotent.
 *
 * Design decisions:
 *  - FOR UPDATE SKIP LOCKED prevents duplicate processing under concurrent replicas.
 *  - Delivery flag is set ONLY after successful Redis publish (no silent data loss).
 *  - No BullMQ queue here — the outbox IS the queue; BullMQ is used only for
 *    scheduled/delayed jobs (Phase 5+). This keeps the ordering of events strict.
 *  - Each relay tick processes up to BATCH_SIZE rows to bound memory.
 *  - A NestJS `@Injectable` interval service keeps the worker alive; on shutdown
 *    the interval is cleared (graceful shutdown via `OnApplicationShutdown`).
 *
 * NEEDS_HUMAN_REVIEW: at-least-once guarantees, Redis pub/sub fan-out semantics
 * Reference: ARCH §10 (outbox relay), AGENTS §2 rule 7+9
 */

import {
  Injectable,
  Logger,
  type OnApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { getPool, withTenantContextRaw } from '../../db/client.js';
import { getRedis } from '../../common/redis/redis.client.js';

const RELAY_INTERVAL_MS = 500;   // poll every 500 ms
const BATCH_SIZE        = 50;    // rows per tick

export const ORDERS_CHANNEL = 'dineflow:orders';

@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelayService.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  onApplicationBootstrap() {
    this.interval = setInterval(() => {
      void this.relay();
    }, RELAY_INTERVAL_MS);
    this.logger.log(`Outbox relay started (interval=${RELAY_INTERVAL_MS}ms, batch=${BATCH_SIZE})`);
  }

  onApplicationShutdown() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.logger.log('Outbox relay stopped.');
  }

  /**
   * One relay tick: claim a batch → publish → mark delivered.
   * Guard prevents re-entrant ticks if Redis is slow.
   */
  async relay(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      await this.relayBatch();
    } catch (err) {
      this.logger.error('Outbox relay tick failed', err);
    } finally {
      this.isRunning = false;
    }
  }

  private async relayBatch(): Promise<void> {
    const pool = getPool();

    const { rows } = await pool.query<{
      id: string;
      org_id: string;
      aggregate: string;
      aggregate_id: string;
      event_type: string;
      payload: unknown;
      created_at: Date;
    }>(`SELECT id, org_id, aggregate, aggregate_id, event_type, payload, created_at FROM fetch_and_claim_outbox_events($1)`, [BATCH_SIZE]);

    if (rows.length === 0) {
      return;
    }

    const redis = getRedis();
    const failedRows: Array<{ id: string; org_id: string }> = [];

    for (const row of rows) {
      const payloadObj =
        row.payload && typeof row.payload === 'object'
          ? (row.payload as Record<string, unknown>)
          : {};
      const message = JSON.stringify({
        id:           row.id,
        org_id:       row.org_id,
        outlet_id:    typeof payloadObj['outlet_id'] === 'string' ? payloadObj['outlet_id'] : undefined,
        aggregate:    row.aggregate,
        aggregateId:  row.aggregate_id,
        eventType:    row.event_type,
        payload:      row.payload,
        ts:           new Date(row.created_at).toISOString(),
      });

      try {
        const orgChannel = `${ORDERS_CHANNEL}:${row.org_id}`;
        await redis.publish(orgChannel, message);
      } catch (err) {
        this.logger.warn(`Redis publish failed for outbox event ${row.id}; scheduling retry`, err);
        failedRows.push({ id: row.id, org_id: row.org_id });
      }
    }

    for (const failed of failedRows) {
      try {
        await withTenantContextRaw(failed.org_id, async (db) => {
          await db.query(
            `UPDATE outbox_events SET delivered_at = NULL, delivered = false WHERE id = $1 AND org_id = $2`,
            [failed.id, failed.org_id],
          );
        });
      } catch (err) {
        this.logger.error(`Failed to unclaim outbox event ${failed.id}`, err);
      }
    }

    this.logger.debug(`Relayed ${rows.length - failedRows.length}/${rows.length} outbox event(s).`);
  }
}
