import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { withTenantContextRaw } from '../../db/client.js';
import { domainError } from '../../common/errors/domain-error.js';
import { ErrorCode } from '@dineflow/contracts';

export interface CustomerExportData {
  exportedAt: string;
  orgId: string;
  dataSubject: {
    id: string;
    phone: string;
    displayName: string | null;
    email: string | null;
    emailVerified: boolean;
    isActive: boolean;
    createdAt: string;
    anonymizedAt: string | null;
  };
  consents: Array<{
    purpose: string;
    granted: boolean;
    noticeVersion: string;
    source: string;
    createdAt: string;
  }>;
  loyaltyLedger: Array<{
    entryType: string;
    amountPaise: number;
    balanceAfterPaise: number;
    description: string;
    createdAt: string;
  }>;
  ordersSummary: Array<{
    id: string;
    outletId: string;
    state: string;
    subtotalPaise: number;
    totalPaise: number;
    createdAt: string;
  }>;
  feedback: Array<{
    id: string;
    rating: number;
    tags: string[];
    comment: string | null;
    createdAt: string;
  }>;
}

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger(PrivacyService.name);

  /**
   * Data Subject Access Request (DSAR) / Data Portability Export.
   * Generates a complete, machine-readable JSON archive of all personal data held.
   * Reference: ARCH §23 (DPDP Act 2023)
   */
  async exportCustomerData(
    orgId: string,
    customerId: string,
    requestedBy: 'CUSTOMER' | 'STAFF' = 'CUSTOMER',
  ): Promise<CustomerExportData> {
    return withTenantContextRaw(orgId, async (client: PoolClient) => {
      // 1. Fetch customer identity
      const custRes = await client.query(
        `SELECT id, phone_e164, display_name, email, email_verified, is_active, created_at, anonymized_at
         FROM customers
         WHERE id = $1 AND org_id = $2;`,
        [customerId, orgId],
      );

      if (custRes.rowCount === 0) {
        throw domainError(ErrorCode.NOT_FOUND, 'Customer not found', 404);
      }

      const cust = custRes.rows[0];

      // 2. Fetch consents history
      const consentRes = await client.query(
        `SELECT purpose, granted, notice_version, source, created_at
         FROM consents
         WHERE customer_id = $1 AND org_id = $2
         ORDER BY created_at DESC;`,
        [customerId, orgId],
      );

      // 3. Fetch loyalty ledger history
      const loyaltyRes = await client.query(
        `SELECT entry_type, amount_paise, balance_after_paise, description, created_at
         FROM loyalty_ledger
         WHERE customer_id = $1 AND org_id = $2
         ORDER BY created_at DESC;`,
        [customerId, orgId],
      );

      // 4. Fetch orders history
      const ordersRes = await client.query(
        `SELECT id, outlet_id, state, subtotal_paise, total_paise, created_at
         FROM orders
         WHERE customer_id = $1 AND org_id = $2
         ORDER BY created_at DESC;`,
        [customerId, orgId],
      );

      // 5. Fetch feedback
      const feedbackRes = await client.query(
        `SELECT id, rating, tags, comment, created_at
         FROM feedback
         WHERE customer_id = $1 AND org_id = $2
         ORDER BY created_at DESC;`,
        [customerId, orgId],
      );

      // 6. Record audit entry in privacy_requests
      await client.query(
        `INSERT INTO privacy_requests (org_id, customer_id, request_type, status, requested_by, details)
         VALUES ($1, $2, 'EXPORT', 'COMPLETED', $3, $4);`,
        [
          orgId,
          customerId,
          requestedBy,
          JSON.stringify({ recordCount: { consents: consentRes.rowCount, orders: ordersRes.rowCount } }),
        ],
      );

      return {
        exportedAt: new Date().toISOString(),
        orgId,
        dataSubject: {
          id: cust.id,
          phone: cust.phone_e164,
          displayName: cust.display_name,
          email: cust.email,
          emailVerified: Boolean(cust.email_verified),
          isActive: Boolean(cust.is_active),
          createdAt: cust.created_at.toISOString(),
          anonymizedAt: cust.anonymized_at ? cust.anonymized_at.toISOString() : null,
        },
        consents: consentRes.rows.map((r: any) => ({
          purpose: r.purpose,
          granted: r.granted,
          noticeVersion: r.notice_version,
          source: r.source,
          createdAt: r.created_at.toISOString(),
        })),
        loyaltyLedger: loyaltyRes.rows.map((r: any) => ({
          entryType: r.entry_type,
          amountPaise: Number(r.amount_paise),
          balanceAfterPaise: Number(r.balance_after_paise),
          description: r.description,
          createdAt: r.created_at.toISOString(),
        })),
        ordersSummary: ordersRes.rows.map((r: any) => ({
          id: r.id,
          outletId: r.outlet_id,
          state: r.state,
          subtotalPaise: Number(r.subtotal_paise),
          totalPaise: Number(r.total_paise),
          createdAt: r.created_at.toISOString(),
        })),
        feedback: feedbackRes.rows.map((r: any) => ({
          id: r.id,
          rating: Number(r.rating),
          tags: r.tags || [],
          comment: r.comment,
          createdAt: r.created_at.toISOString(),
        })),
      };
    });
  }

  /**
   * Right to Erasure / Anonymization (ARCH §23).
   * Irreversibly redacts customer PII while strictly preserving accounting & invoice integrity.
   */
  async anonymizeCustomer(
    orgId: string,
    customerId: string,
    requestedBy: 'CUSTOMER' | 'STAFF' = 'CUSTOMER',
    reason?: string,
  ): Promise<{ success: boolean; customerId: string; anonymizedAt: string }> {
    return withTenantContextRaw(orgId, async (client: PoolClient) => {
      // 1. Fetch customer
      const custRes = await client.query(
        `SELECT id, phone_e164, anonymized_at
         FROM customers
         WHERE id = $1 AND org_id = $2;`,
        [customerId, orgId],
      );

      if (custRes.rowCount === 0) {
        throw domainError(ErrorCode.NOT_FOUND, 'Customer not found', 404);
      }

      const cust = custRes.rows[0];
      if (cust.anonymized_at) {
        throw domainError(ErrorCode.CUSTOMER_ANONYMIZED, 'Customer has already been anonymized', 409);
      }

      // 2. Invariant check: cannot delete account if active orders are in flight
      const activeOrdersRes = await client.query(
        `SELECT count(*)::int as active_count
         FROM orders
         WHERE customer_id = $1 AND org_id = $2
           AND state IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED');`,
        [customerId, orgId],
      );

      if (activeOrdersRes.rows[0].active_count > 0) {
        throw domainError(
          ErrorCode.PENDING_ORDERS_EXIST,
          'Cannot erase account while orders are in progress. Please complete or cancel pending orders first.',
          400,
        );
      }

      // 3. Generate pseudo-anonymous phone to preserve unique constraint (org_id, phone_e164)
      const anonPhone = `+ANON-${customerId.replace(/-/g, '').slice(0, 16)}`;

      // 4. Redact profile PII
      await client.query(
        `UPDATE customers
         SET phone_e164 = $1,
             display_name = 'Anonymized Customer',
             email = NULL,
             google_sub = NULL,
             is_active = false,
             anonymized_at = now(),
             updated_at = now()
         WHERE id = $2 AND org_id = $3;`,
        [anonPhone, customerId, orgId],
      );

      // 5. Revoke customer active refresh tokens
      await client.query(
        `UPDATE customer_refresh_tokens
         SET is_revoked = true
         WHERE customer_id = $1 AND org_id = $2;`,
        [customerId, orgId],
      );

      // 6. Record consent revocation for all purposes in consents log
      await client.query(
        `INSERT INTO consents (org_id, customer_id, phone, purpose, granted, notice_version, source)
         SELECT $1, $2, $3, unnest(ARRAY['ORDERING', 'LOYALTY', 'MARKETING_WHATSAPP', 'ANALYTICS']), false, 'erasure_v1', 'ADMIN';`,
        [orgId, customerId, anonPhone],
      );

      // 7. Unlink from AI assistant sessions
      await client.query(
        `UPDATE ai_sessions
         SET customer_id = NULL
         WHERE customer_id = $1 AND org_id = $2;`,
        [customerId, orgId],
      );

      // 8. Record audit entry in privacy_requests
      const anonymizedAt = new Date().toISOString();
      await client.query(
        `INSERT INTO privacy_requests (org_id, customer_id, request_type, status, requested_by, details)
         VALUES ($1, $2, 'ERASURE', 'COMPLETED', $3, $4);`,
        [orgId, customerId, requestedBy, JSON.stringify({ reason: reason || 'DPDP right to erasure exercised' })],
      );

      this.logger.log(`[PRIVACY] Customer ${customerId} anonymized successfully by ${requestedBy}`);

      return {
        success: true,
        customerId,
        anonymizedAt,
      };
    });
  }

  /**
   * Automated Data Retention Purge Job (ARCH §23).
   * Cleans expired OTPs (>24h), stale AI chat transcripts (>90 days), and old webhook inbox events (>30 days).
   */
  async runRetentionPurge(orgId: string): Promise<{
    expiredOtpsPurged: number;
    staleTranscriptsPurged: number;
    staleWebhooksPurged: number;
  }> {
    return withTenantContextRaw(orgId, async (client: PoolClient) => {
      // 1. Purge expired OTPs older than 24 hours
      const otpsRes = await client.query(
        `DELETE FROM customer_otp_codes
         WHERE org_id = $1 AND expires_at < now() - interval '24 hours';`,
        [orgId],
      );

      // 2. Purge AI transcripts older than 90 days retention window
      const transcriptsRes = await client.query(
        `DELETE FROM ai_chat_transcripts
         WHERE org_id = $1 AND created_at < now() - interval '90 days';`,
        [orgId],
      );

      // 3. Purge processed webhooks older than 30 days
      const webhooksRes = await client.query(
        `DELETE FROM webhook_inbox
         WHERE created_at < now() - interval '30 days';`,
      );

      this.logger.log(
        `[RETENTION] Purge completed for org ${orgId}: ` +
          `${otpsRes.rowCount || 0} OTPs, ` +
          `${transcriptsRes.rowCount || 0} transcripts, ` +
          `${webhooksRes.rowCount || 0} webhooks.`,
      );

      return {
        expiredOtpsPurged: otpsRes.rowCount || 0,
        staleTranscriptsPurged: transcriptsRes.rowCount || 0,
        staleWebhooksPurged: webhooksRes.rowCount || 0,
      };
    });
  }
}
