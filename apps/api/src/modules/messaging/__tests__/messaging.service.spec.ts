import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessagingService } from '../messaging.service.js';
import { MockMessagingProvider, MockSmsProvider } from '../mock-messaging.adapter.js';
import * as dbClient from '../../../db/client.js';

describe('MessagingService (Phase 9)', () => {
  let service: MessagingService;
  let mockProvider: MockMessagingProvider;
  let mockSmsProvider: MockSmsProvider;
  let mockClient: any;

  const orgId = 'org-uuid-1';
  const customerId = 'customer-uuid-1';
  const phone = '+919876543210';

  beforeEach(() => {
    mockProvider = new MockMessagingProvider();
    mockSmsProvider = new MockSmsProvider();
    service = new MessagingService(mockProvider, mockSmsProvider);

    mockClient = {
      query: vi.fn(),
    };

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async (_orgId: string, fn: (client: any) => Promise<any>) => {
        return fn(mockClient);
      },
    );
  });

  describe('Transactional Utility Messaging', () => {
    it('dispatches order_receipt_v1 and records cost in message_log', async () => {
      // 1. Org settings
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              org_id: orgId,
              monthly_budget_paise: '50000',
              daily_budget_paise: '10000',
              is_marketing_enabled: true,
              quiet_hours_start_utc: 15,
              quiet_hours_end_utc: 3,
            },
          ],
        })
        // 2. Spend check
        .mockResolvedValueOnce({ rows: [{ daily_spend: '100', monthly_spend: '500' }] })
        // 3. message_log insert
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'msg-log-1',
              status: 'SENT',
              provider_msg_id: 'mock-1',
              cost_minor: '15',
            },
          ],
        });

      const res = await service.sendMessage(orgId, {
        phone,
        templateName: 'order_receipt_v1',
        params: {
          customer_name: 'Aditi',
          order_ref: 'ORD-789',
          total_amount: '₹350',
          receipt_url: 'https://dineflow.in/r/789',
        },
      });

      expect(res.status).toBe('SENT');
      expect(res.costMinorPaise).toBe(15);
      expect(mockProvider.sentMessages).toHaveLength(1);
      expect(mockProvider.sentMessages[0]?.renderedText).toContain('ORD-789');
    });

    it('returns existing message record on idempotent replay without re-sending', async () => {
      mockClient.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'msg-log-existing',
            status: 'SENT',
            provider_msg_id: 'mock-existing-msg-id',
            cost_minor: '15',
          },
        ],
      });

      const res = await service.sendMessage(orgId, {
        phone,
        templateName: 'order_receipt_v1',
        params: {
          customer_name: 'Aditi',
          order_ref: 'ORD-789',
          total_amount: '₹350',
          receipt_url: 'https://dineflow.in/r/789',
        },
        idempotencyKey: 'receipt-ORD-789',
      });

      expect(res.isIdempotentReplay).toBe(true);
      expect(res.id).toBe('msg-log-existing');
      // Must NOT have dispatched to provider
      expect(mockProvider.sentMessages).toHaveLength(0);
    });
  });

  describe('Marketing Messages & DPDP Consent', () => {
    it('blocks marketing message if customer has NOT granted consent', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              org_id: orgId,
              monthly_budget_paise: '50000',
              daily_budget_paise: '10000',
              is_marketing_enabled: true,
              quiet_hours_start_utc: 15,
              quiet_hours_end_utc: 3,
            },
          ],
        }) // 1. settings
        .mockResolvedValueOnce({ rows: [{ daily_spend: '0', monthly_spend: '0' }] }) // 2. spend
        .mockResolvedValueOnce({ rows: [] }) // 3. consent check: no record found
        .mockResolvedValueOnce({ rows: [] }) // 4. last marketing message
        .mockResolvedValueOnce({ rows: [] }); // 5. insert message_log BLOCKED

      await expect(
        service.sendMessage(orgId, {
          phone,
          templateName: 'promotional_offer_v1',
          params: {
            customer_name: 'Rohan',
            headline: 'Weekend 20% Off',
            coupon_code: 'WEEKEND20',
            expiry_date: 'Sunday',
            opt_out_link: 'https://dineflow.in/optout',
          },
        }),
      ).rejects.toThrow('Customer has not granted MARKETING_WHATSAPP consent');

      expect(mockProvider.sentMessages).toHaveLength(0);
    });

    it('allows marketing message if consent is granted and frequency cap is satisfied', async () => {
      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              org_id: orgId,
              monthly_budget_paise: '50000',
              daily_budget_paise: '10000',
              is_marketing_enabled: true,
              quiet_hours_start_utc: 0, // mock quiet hours outside current time
              quiet_hours_end_utc: 0,
            },
          ],
        }) // 1. settings
        .mockResolvedValueOnce({ rows: [{ daily_spend: '0', monthly_spend: '0' }] }) // 2. spend
        .mockResolvedValueOnce({ rows: [{ granted: true }] }) // 3. active consent
        .mockResolvedValueOnce({
          rows: [{ created_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) }], // 4. last sent 10 days ago
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'mkt-msg-1',
              status: 'SENT',
              provider_msg_id: 'mock-mkt-1',
              cost_minor: '85',
            },
          ],
        }); // 5. message_log insert

      const res = await service.sendMessage(orgId, {
        phone,
        templateName: 'promotional_offer_v1',
        params: {
          customer_name: 'Rohan',
          headline: 'Weekend 20% Off',
          coupon_code: 'WEEKEND20',
          expiry_date: 'Sunday',
          opt_out_link: 'https://dineflow.in/optout',
        },
      });

      expect(res.status).toBe('SENT');
      expect(res.costMinorPaise).toBe(85);
      expect(mockProvider.sentMessages).toHaveLength(1);
    });
  });

  describe('Inbound Webhooks & STOP Opt-Out (Official Meta Cloud API)', () => {
    it('automatically revokes marketing consent via scoped helper when customer replies STOP', async () => {
      const poolQueryMock = vi.fn()
        .mockResolvedValueOnce({ rows: [{ org_id: orgId }] }) // resolve_org_by_whatsapp_phone_id
        .mockResolvedValueOnce({ rows: [{ revoke_marketing_consent_by_phone: 1 }] });

      vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQueryMock } as never);

      const metaPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: '1000123456789' },
                  messages: [
                    {
                      from: '919876543210',
                      type: 'text',
                      text: { body: 'STOP' },
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.handleInboundWebhook(metaPayload);
      expect(result.action).toBe('OPT_OUT_RECORDED');
      expect(result.phone).toBe('+919876543210');
      expect(poolQueryMock).toHaveBeenCalledWith(
        expect.stringContaining('revoke_marketing_consent_by_phone'),
        ['+919876543210', orgId],
      );
    });

    it('updates delivery status via scoped helper on Meta delivery receipts', async () => {
      const poolQueryMock = vi.fn().mockResolvedValueOnce({ rows: [] });
      vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQueryMock } as never);

      const metaStatusPayload = {
        entry: [
          {
            changes: [
              {
                value: {
                  statuses: [
                    {
                      id: 'wamid-msg-123',
                      status: 'delivered',
                    },
                  ],
                },
              },
            ],
          },
        ],
      };

      const result = await service.handleInboundWebhook(metaStatusPayload);
      expect(result.action).toBe('STATUS_UPDATED');
      expect(result.status).toBe('DELIVERED');
      expect(poolQueryMock).toHaveBeenCalledWith(
        expect.stringContaining('update_message_status_by_provider_id'),
        ['wamid-msg-123', 'DELIVERED'],
      );
    });
  });

  describe('OTP & SMS Fallback', () => {
    it('falls back to SMS when WhatsApp fails', async () => {
      // Cause WhatsApp provider to fail
      mockProvider.shouldFail = true;

      mockClient.query
        .mockResolvedValueOnce({
          rows: [
            {
              org_id: orgId,
              monthly_budget_paise: '50000',
              daily_budget_paise: '10000',
              sms_fallback_enabled: true,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [{ daily_spend: '0', monthly_spend: '0' }] })
        .mockResolvedValueOnce({
          rows: [{ id: 'otp-log-1', status: 'FAILED', provider_msg_id: null, cost_minor: '0' }],
        });

      const res = await service.sendOtp(orgId, phone, '654321');

      expect(res.channel).toBe('SMS');
      expect(res.status).toBe('SENT');
      expect(mockSmsProvider.sentSms).toHaveLength(1);
      expect(mockSmsProvider.sentSms[0]?.message).toContain('654321');
    });
  });
});
