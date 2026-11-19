/**
 * Abandoned Checkout Expiry Service
 *
 * Runs a lightweight background cleanup every 5 minutes:
 * - Identifies orders stuck in `AWAITING_PAYMENT` for > 15 minutes
 * - Marks them as `PAYMENT_EXPIRED`
 * - Releases any linked pending table reservations (status = 'CANCELLED')
 * - Writes append-only audit trail in `order_events`
 *
 * Reference: ARCH §8, AGENTS §2 rule 6
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { getPool, withTenantContextRaw } from '../../db/client.js';

const CLEANUP_INTERVAL_MS = 5 * 60_000; // 5 minutes
const EXPIRY_THRESHOLD_MINUTES = 15;

@Injectable()
export class PaymentExpiryCleanupService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(PaymentExpiryCleanupService.name);
  private interval: ReturnType<typeof setInterval> | null = null;
  private isRunning = false;

  onApplicationBootstrap() {
    this.interval = setInterval(() => {
      void this.cleanupExpiredCheckouts();
    }, CLEANUP_INTERVAL_MS);
    this.logger.log(
      `Abandoned Checkout Expiry job started (interval=${CLEANUP_INTERVAL_MS}ms, threshold=${EXPIRY_THRESHOLD_MINUTES}m)`,
    );
  }

  onApplicationShutdown() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.logger.log('Abandoned Checkout Expiry job stopped.');
  }

  /**
   * One execution tick: claims & expires orders in AWAITING_PAYMENT older than threshold.
   */
  async cleanupExpiredCheckouts(): Promise<number> {
    if (this.isRunning) return 0;
    this.isRunning = true;
    try {
      const pool = getPool();

      // 1. Mark orders as PAYMENT_EXPIRED
      const { rows: expiredOrders } = await pool.query<{
        id: string;
        org_id: string;
        reservation_id: string | null;
      }>(
        `UPDATE orders
         SET status = 'PAYMENT_EXPIRED', updated_at = now()
         WHERE status = 'AWAITING_PAYMENT'
           AND created_at < now() - ($1 || ' minutes')::interval
         RETURNING id, org_id, reservation_id`,
        [EXPIRY_THRESHOLD_MINUTES],
      );

      if (expiredOrders.length === 0) {
        return 0;
      }

      // 2. Release pending reservation locks for any expired orders
      const reservationIds = expiredOrders
        .map((o) => o.reservation_id)
        .filter((r): r is string => Boolean(r));

      if (reservationIds.length > 0) {
        await pool.query(
          `UPDATE table_reservations
           SET status = 'CANCELLED'
           WHERE id = ANY($1) AND status = 'PENDING_PAYMENT'`,
          [reservationIds],
        );
        await pool.query(
          `UPDATE table_reservation_slots
           SET status = 'CANCELLED'
           WHERE reservation_id = ANY($1) AND status = 'PENDING_PAYMENT'`,
          [reservationIds],
        );
      }

      // 3. Write audit events in tenant context
      for (const ord of expiredOrders) {
        try {
          await withTenantContextRaw(ord.org_id, async (db) => {
            await db.query(
              `INSERT INTO order_events (org_id, order_id, event_type, actor_type, actor_id, payload)
               VALUES ($1, $2, 'ORDER_PAYMENT_EXPIRED', 'SYSTEM', null, $3)`,
              [
                ord.org_id,
                ord.id,
                JSON.stringify({
                  reason: `Awaiting payment timed out after ${EXPIRY_THRESHOLD_MINUTES} minutes.`,
                  expiredAt: new Date().toISOString(),
                }),
              ],
            );
          });
        } catch (err) {
          this.logger.error(`Failed to record audit event for expired order ${ord.id}`, err);
        }
      }

      this.logger.log(`Expired ${expiredOrders.length} abandoned checkout order(s).`);
      return expiredOrders.length;
    } catch (err) {
      this.logger.error('Failed to cleanup expired checkouts', err);
      return 0;
    } finally {
      this.isRunning = false;
    }
  }
}
