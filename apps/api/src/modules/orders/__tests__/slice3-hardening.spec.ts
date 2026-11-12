import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { TablesService } from '../../tables/tables.service.js';
import { OrdersService } from '../orders.service.js';
import { LoyaltyService } from '../../loyalty/loyalty.service.js';
import { PaymentsService } from '../../payments/payments.service.js';
import { PhonePeAdapter } from '../../payments/phonepe.adapter.js';
import { MenuService } from '../../menu/menu.service.js';
import { PrivacyService } from '../../privacy/privacy.service.js';
import * as dbClient from '../../../db/client.js';

vi.mock('../../../config/config.js', () => ({
  getConfig: () => ({
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!',
    OTP_HMAC_PEPPER: 'test-otp-pepper-at-least-32-chars-long!',
    QR_TOKEN_SECRET: 'test-qr-secret-at-least-32-chars-long!!',
    PHONEPE_CLIENT_ID: 'TEST_MERCHANT',
    PHONEPE_CLIENT_SECRET: 'test-phonepe-salt-key-1234',
    PHONEPE_CLIENT_VERSION: 1,
    PHONEPE_ENV: 'SANDBOX',
    REDIS_URL: 'redis://localhost:6380',
    DATABASE_URL: 'postgresql://dineflow_app:pass@localhost:5433/dineflow',
    NODE_ENV: 'test',
  }),
}));

describe('Slice 3 Hardening — QR Tokens, Orders Validation, Loyalty, Refunds, Schema & Privacy', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const outletId = '22222222-2222-4222-8222-222222222222';
  const otherOutletId = '22222222-2222-4222-8222-999999999999';
  const tableId = '33333333-3333-4333-8333-333333333333';
  const sessionId = '44444444-4444-4444-8444-444444444444';
  const itemId = '55555555-5555-4555-8555-555555555555';
  const modId = '66666666-6666-4666-8666-666666666666';
  const groupId = '77777777-7777-4777-8777-777777777777';
  const otherGroupId = '77777777-7777-4777-8777-888888888888';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('TablesService QR Verification (no unverified table_number fallback)', () => {
    it('rejects raw table numbers like "T04" and unsigned UUIDs with 401 TABLE_TOKEN_INVALID', async () => {
      const svc = new TablesService();
      await expect(svc.openSession({ qr_token: 'T04', pax: 2 })).rejects.toMatchObject({
        status: 401,
        code: 'TABLE_TOKEN_INVALID',
      });
      await expect(svc.openSession({ qr_token: tableId, pax: 2 })).rejects.toMatchObject({
        status: 401,
        code: 'TABLE_TOKEN_INVALID',
      });
    });

    it('accepts valid HMAC-signed QR token via resolve_table_for_qr and issues guestSessionToken', async () => {
      const tokenSvc = { signGuestSessionToken: vi.fn().mockReturnValue('signed-guest-jwt') };
      const svc = new TablesService(tokenSvc as never);
      const sig = svc.generateQrToken(tableId, 1);
      const token = Buffer.from(`${tableId}:1:${sig}`).toString('base64url');

      const poolQuery = vi.fn().mockResolvedValueOnce({
        rows: [{
          id: tableId,
          org_id: orgId,
          outlet_id: outletId,
          qr_token_version: 1,
          is_active: true,
          table_number: 'T04',
        }],
      });
      vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQuery } as unknown as Pool);
      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({
            query: vi.fn().mockResolvedValueOnce({
              rows: [{
                id: sessionId,
                org_id: orgId,
                outlet_id: outletId,
                table_id: tableId,
                status: 'OPEN',
                pax: 2,
                opened_at: new Date(),
                table_number: 'T04',
              }],
            }),
          } as unknown as PoolClient),
      );

      const res = await svc.openSession({ qr_token: token, pax: 2 });
      expect(poolQuery.mock.calls[0]![0]).toContain('resolve_table_for_qr');
      expect((res as { guestSessionToken?: string }).guestSessionToken).toBe('signed-guest-jwt');
    });
  });

  describe('OrdersService Pricing Input, Availability, Modifier & Line Notes Validation', () => {
    function setupOrderMocks(opts: {
      isActive?: boolean;
      itemOutletId?: string | null;
      modAvailable?: boolean;
      linkedGroupId?: string;
    }) {
      const queryMock = vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id FROM orders')) return { rows: [] };
        if (sql.includes('FROM table_sessions')) {
          return { rows: [{ id: sessionId, table_id: tableId, outlet_id: outletId, status: 'OPEN', customer_id: null }] };
        }
        if (sql.includes('FROM menu_items')) {
          return {
            rows: [{
              id: itemId,
              name: 'Paneer Tikka',
              price_paise: 25000,
              is_available: true,
              is_active: opts.isActive ?? true,
              outlet_id: opts.itemOutletId === undefined ? outletId : opts.itemOutletId,
              allow_half_portion: false,
            }],
          };
        }
        if (sql.includes('FROM item_availability')) return { rows: [] };
        if (sql.includes('FROM modifiers')) {
          return {
            rows: [{
              id: modId,
              group_id: groupId,
              name: 'Extra Cheese',
              price_paise: 3000,
              is_available: opts.modAvailable ?? true,
            }],
          };
        }
        if (sql.includes('FROM item_modifier_groups')) {
          return {
            rows: [{ item_id: itemId, group_id: opts.linkedGroupId ?? groupId }],
          };
        }
        if (sql.includes('INSERT INTO orders')) return { rows: [{ id: 'order-new-1' }] };
        if (sql.includes('LEFT JOIN tables')) {
          return { rows: [{ id: 'order-new-1', status: 'PENDING', table_number: 'T04' }] };
        }
        return { rows: [] };
      });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );
      return queryMock;
    }

    it('rejects inactive items, cross-outlet items, unavailable modifiers, and unlinked modifier groups', async () => {
      const ordersSvc = new OrdersService();

      setupOrderMocks({ isActive: false });
      await expect(
        ordersSvc.placeOrder(orgId, {
          session_id: sessionId,
          idempotency_key: '11111111-1111-4111-8111-111111111112',
          items: [{ menu_item_id: itemId, quantity: 1, modifiers: [], portion: 'FULL' }],
          tip_paise: 0,
        }, sessionId, 'CUSTOMER'),
      ).rejects.toMatchObject({ status: 400, code: 'ITEM_UNAVAILABLE' });

      setupOrderMocks({ itemOutletId: otherOutletId });
      await expect(
        ordersSvc.placeOrder(orgId, {
          session_id: sessionId,
          idempotency_key: '11111111-1111-4111-8111-111111111113',
          items: [{ menu_item_id: itemId, quantity: 1, modifiers: [], portion: 'FULL' }],
          tip_paise: 0,
        }, sessionId, 'CUSTOMER'),
      ).rejects.toMatchObject({ status: 400, code: 'ITEM_UNAVAILABLE' });

      setupOrderMocks({ modAvailable: false });
      await expect(
        ordersSvc.placeOrder(orgId, {
          session_id: sessionId,
          idempotency_key: '11111111-1111-4111-8111-111111111114',
          items: [{ menu_item_id: itemId, quantity: 1, modifiers: [{ modifier_id: modId }], portion: 'FULL' }],
          tip_paise: 0,
        }, sessionId, 'CUSTOMER'),
      ).rejects.toMatchObject({ status: 400, code: 'ITEM_UNAVAILABLE' });

      setupOrderMocks({ linkedGroupId: otherGroupId });
      await expect(
        ordersSvc.placeOrder(orgId, {
          session_id: sessionId,
          idempotency_key: '11111111-1111-4111-8111-111111111115',
          items: [{ menu_item_id: itemId, quantity: 1, modifiers: [{ modifier_id: modId }], portion: 'FULL' }],
          tip_paise: 0,
        }, sessionId, 'CUSTOMER'),
      ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
    });

    it('preserves per-line notes when ordering identical menu_item_id twice', async () => {
      const ordersSvc = new OrdersService();
      const queryMock = setupOrderMocks({});
      await ordersSvc.placeOrder(orgId, {
        session_id: sessionId,
        idempotency_key: '11111111-1111-4111-8111-111111111116',
        items: [
          { menu_item_id: itemId, quantity: 1, modifiers: [], portion: 'FULL', notes: 'no onion' },
          { menu_item_id: itemId, quantity: 1, modifiers: [], portion: 'FULL', notes: 'extra spicy' },
        ],
        tip_paise: 0,
      }, sessionId, 'CUSTOMER');

      const insertItemCalls = queryMock.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO order_items'),
      );
      expect(insertItemCalls).toHaveLength(2);
      expect(insertItemCalls[0]![1][8]).toBe('no onion');
      expect(insertItemCalls[1]![1][8]).toBe('extra spicy');
    });
  });

  describe('Loyalty Locking, Partial->Full Refund Transition & PhonePe Constant-Time Check', () => {
    it('locks customer row FOR UPDATE in debitWalletForOrder before summing ledger', async () => {
      const loyalty = new LoyaltyService();
      const queryMock = vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: 'cust-1' }] })
        .mockResolvedValueOnce({ rows: [{ balance: '50000' }] })
        .mockResolvedValueOnce({ rows: [] });

      await loyalty.debitWalletForOrder(orgId, 'cust-1', 'ord-1', 10000n, {
        query: queryMock,
      } as unknown as PoolClient);

      expect(queryMock.mock.calls[0]![0]).toContain('FOR UPDATE');
      expect(queryMock.mock.calls[1]![0]).toContain("entry_type = 'EARN' AND expires_at IS NOT NULL");
    });

    it('locks payment row FOR UPDATE and transitions status to REFUNDED on cumulative full refund', async () => {
      const payments = new PaymentsService();
      const queryMock = vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // idempotency
        .mockResolvedValueOnce({
          rows: [{
            id: 'pay-1',
            order_id: 'ord-1',
            amount_paise: 10000,
            status: 'PARTIALLY_REFUNDED',
            provider: 'staff',
            provider_payment_id: 'sp-1',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ total: 6000 }] }) // already refunded 6000
        .mockResolvedValueOnce({ rows: [{ id: 'ref-2' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      await payments.createRefund(
        orgId,
        'pay-1',
        { amount_paise: 4000, reason: 'Remaining item', idempotency_key: '11111111-1111-4111-8111-111111111120' },
        'staff-1',
      );

      const lockSql = queryMock.mock.calls[1]![0] as string;
      expect(lockSql).toContain('FOR UPDATE');
      const updatePaymentCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('UPDATE payments SET status'),
      );
      expect(updatePaymentCall![1][0]).toBe('REFUNDED');
    });

    it('verifies PhonePe X-VERIFY constant-time with distinct state eventId', () => {
      const payload = {
        success: true,
        code: 'PAYMENT_SUCCESS',
        data: {
          merchantTransactionId: 'DF_12345',
          transactionId: 'T999',
          amount: 50000,
          state: 'COMPLETED',
        },
      };
      const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
      const checksum = createHash('sha256')
        .update(b64 + 'test-phonepe-salt-key-1234')
        .digest('hex');

      const result = PhonePeAdapter.verifyWebhook(
        Buffer.from(JSON.stringify({ response: b64 }), 'utf8'),
        { 'x-verify': `${checksum}###1` },
      );
      expect(result.valid).toBe(true);
      expect(result.eventId).toBe('DF_12345:COMPLETED:T999');
      expect(result.event.providerPaymentId).toBe('T999');
    });
  });

  describe('MenuService._auditLog & PrivacyService Real DDL Queries', () => {
    it('writes MenuService audit log to real audit_logs columns (resource, resource_id, metadata)', async () => {
      const svc = new MenuService();
      const queryMock = vi.fn().mockResolvedValue({ rows: [] });
      await (svc as unknown as {
        _auditLog: (...args: unknown[]) => Promise<void>;
      })._auditLog({ query: queryMock }, orgId, tableId, 'menu_items', itemId, 'UPDATE', { a: 1 }, { a: 2 });

      const sql = queryMock.mock.calls[0]![0] as string;
      expect(sql).toContain('resource, resource_id, metadata');
      expect(sql).not.toContain('table_name');
    });

    it('uses webhook_inbox.received_at and orders.status in PrivacyService', async () => {
      const privacy = new PrivacyService();
      const queryMock = vi.fn()
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 })
        .mockResolvedValueOnce({ rowCount: 1 });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      await privacy.runRetentionPurge(orgId);
      const webhookSql = queryMock.mock.calls[2]![0] as string;
      expect(webhookSql).toContain('received_at <');
      expect(webhookSql).not.toContain('created_at');
    });
  });
});

