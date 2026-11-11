/**
 * ReconciliationService — periodic job to settle stale PENDING payments.
 *
 * Runs every 5 minutes. Fetches payment status from the gateway for any
 * payment that has been in CREATED/PENDING state for more than 5 minutes.
 * This handles cases where:
 *   - The webhook was missed (gateway didn't send it).
 *   - The webhook arrived before the payment row was committed (race).
 *   - The gateway had a temporary outage.
 *
 * Reference: ARCH §11 "Reconciliation job: every N minutes fetch status for
 * PENDING payments older than X and settle them; daily settlement report vs provider."
 */

import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { PaymentsService } from './payments.service.js';

const RECONCILE_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class ReconciliationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(ReconciliationService.name);
  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly paymentsService: PaymentsService) {}

  onApplicationBootstrap() {
    this.interval = setInterval(() => {
      void this.run();
    }, RECONCILE_INTERVAL_MS);
    this.logger.log(`Reconciliation job started (every ${RECONCILE_INTERVAL_MS / 1000}s)`);
  }

  onApplicationShutdown() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.logger.log('Reconciliation job stopped.');
  }

  async run() {
    this.logger.debug('Running payment reconciliation...');
    try {
      await this.paymentsService.reconcilePendingPayments();
    } catch (err) {
      this.logger.error('Reconciliation failed', err);
    }
  }
}
