import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PrivacyService } from '../privacy.service.js';
import * as dbClient from '../../../db/client.js';
import { ErrorCode } from '@dineflow/contracts';

describe('PrivacyService (Phase 11 — DPDP Compliance ARCH §23)', () => {
  let service: PrivacyService;
  let mockClient: any;

  const orgId = '00000000-0000-0000-0000-000000000001';
  const customerId = '00000000-0000-0000-0000-000000000002';

  beforeEach(() => {
    service = new PrivacyService();
    mockClient = {
      query: vi.fn(),
    };

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async (_orgId: string, fn: (client: any) => Promise<any>) => {
        return fn(mockClient);
      },
    );
  });

  describe('Data Subject Access Request (DSAR Export)', () => {
    it('generates a complete, portable JSON export of customer personal data and logs the request', async () => {
      // 1. Customer profile
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: customerId,
            phone_e164: '+919876543210',
            display_name: 'Rahul Sharma',
            email: 'rahul@example.com',
            email_verified: true,
            is_active: true,
            created_at: new Date('2026-01-15T10:00:00Z'),
            anonymized_at: null,
          },
        ],
      });

      // 2. Consents
      mockClient.query.mockResolvedValueOnce({
        rowCount: 2,
        rows: [
          {
            purpose: 'ORDERING',
            granted: true,
            notice_version: 'v1.0',
            source: 'WEB_CHECKOUT',
            created_at: new Date('2026-01-15T10:00:00Z'),
          },
          {
            purpose: 'MARKETING_WHATSAPP',
            granted: true,
            notice_version: 'v1.0',
            source: 'WEB_CHECKOUT',
            created_at: new Date('2026-01-15T10:00:00Z'),
          },
        ],
      });

      // 3. Loyalty ledger (real schema columns)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            entry_type: 'EARN',
            amount_paise: '1500',
            reason: 'Reward for Order #1',
            ref_type: 'ORDER',
            ref_id: 'order-1',
            expires_at: null,
            created_at: new Date('2026-01-15T11:00:00Z'),
          },
        ],
      });

      // 4. Orders (real orders.status column)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'order-1',
            outlet_id: 'outlet-1',
            status: 'BILLED',
            subtotal_paise: 30000,
            total_paise: 31500,
            created_at: new Date('2026-01-15T10:30:00Z'),
          },
        ],
      });

      // 5. Feedback
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'fb-1',
            rating: 5,
            tags: ['fast_service'],
            comment: 'Great dinner!',
            created_at: new Date('2026-01-15T11:30:00Z'),
          },
        ],
      });

      // 6. Audit entry
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

      const exportData = await service.exportCustomerData(orgId, customerId, 'CUSTOMER');

      expect(exportData.orgId).toBe(orgId);
      expect(exportData.dataSubject.phone).toBe('+919876543210');
      expect(exportData.dataSubject.displayName).toBe('Rahul Sharma');
      expect(exportData.dataSubject.email).toBe('rahul@example.com');
      expect(exportData.consents.length).toBe(2);
      expect(exportData.loyaltyLedger.length).toBe(1);
      expect(exportData.ordersSummary.length).toBe(1);
      expect(exportData.feedback.length).toBe(1);

      // Verify audit logging
      const auditCall = mockClient.query.mock.calls.find((c: any) =>
        c[0].includes('INSERT INTO privacy_requests') && c[0].includes("'EXPORT'"),
      );
      expect(auditCall).toBeDefined();
    });

    it('throws 404 NOT_FOUND if customer does not exist in this tenant', async () => {
      mockClient.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });

      await expect(service.exportCustomerData(orgId, customerId)).rejects.toMatchObject({
        code: ErrorCode.NOT_FOUND,
        status: 404,
      });
    });
  });

  describe('Right to Erasure / Anonymization (ARCH §23)', () => {
    it('irreversibly redacts customer PII while preserving financial orders for tax law', async () => {
      // 1. Fetch customer
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: customerId, phone_e164: '+919876543210', anonymized_at: null }],
      });

      // 2. Active orders check (0 active orders)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ active_count: 0 }],
      });

      // 3. Update customer profile
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 4. Revoke refresh tokens
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 5. Revoke consents
      mockClient.query.mockResolvedValueOnce({ rowCount: 4 });
      // 6. Unlink AI sessions
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });
      // 7. Audit entry
      mockClient.query.mockResolvedValueOnce({ rowCount: 1 });

      const result = await service.anonymizeCustomer(orgId, customerId, 'CUSTOMER', 'No longer dining here');

      expect(result.success).toBe(true);
      expect(result.customerId).toBe(customerId);
      expect(result.anonymizedAt).toBeDefined();

      // Verify that customer profile was updated to anonymous values
      const updateCustCall = mockClient.query.mock.calls.find((c: any) =>
        c[0].includes('UPDATE customers') && c[0].includes("display_name = 'Anonymized Customer'"),
      );
      expect(updateCustCall).toBeDefined();
      const newPhone = updateCustCall[1][0];
      expect(newPhone).toMatch(/^\+ANON-/);
      expect(newPhone).not.toContain('9876543210');

      // Verify audit record created
      const auditCall = mockClient.query.mock.calls.find((c: any) =>
        c[0].includes('INSERT INTO privacy_requests') && c[0].includes("'ERASURE'"),
      );
      expect(auditCall).toBeDefined();
    });

    it('rejects erasure if customer has active dine-in orders in flight', async () => {
      // 1. Fetch customer
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: customerId, phone_e164: '+919876543210', anonymized_at: null }],
      });

      // 2. Active orders check: 1 order preparing
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ active_count: 1 }],
      });

      await expect(service.anonymizeCustomer(orgId, customerId)).rejects.toMatchObject({
        code: ErrorCode.PENDING_ORDERS_EXIST,
        status: 400,
      });
    });

    it('rejects duplicate anonymization attempts', async () => {
      // 1. Fetch customer (already anonymized)
      mockClient.query.mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: customerId, phone_e164: '+ANON-12345', anonymized_at: new Date() }],
      });

      await expect(service.anonymizeCustomer(orgId, customerId)).rejects.toMatchObject({
        code: ErrorCode.CUSTOMER_ANONYMIZED,
        status: 409,
      });
    });
  });

  describe('Automated Retention Purge (ARCH §23)', () => {
    it('purges expired OTPs (>24h), aged AI transcripts (>90 days), and old webhooks (>30 days)', async () => {
      // 1. OTP purge
      mockClient.query.mockResolvedValueOnce({ rowCount: 14 });
      // 2. Transcript purge
      mockClient.query.mockResolvedValueOnce({ rowCount: 8 });
      // 3. Webhook purge
      mockClient.query.mockResolvedValueOnce({ rowCount: 22 });

      const result = await service.runRetentionPurge(orgId);

      expect(result.expiredOtpsPurged).toBe(14);
      expect(result.staleTranscriptsPurged).toBe(8);
      expect(result.staleWebhooksPurged).toBe(22);

      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM customer_otp_codes"),
        [orgId],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM ai_chat_transcripts"),
        [orgId],
      );
    });
  });
});
