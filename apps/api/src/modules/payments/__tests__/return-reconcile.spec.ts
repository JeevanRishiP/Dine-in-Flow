import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { PaymentsService } from '../payments.service.js';
import { PhonePeAdapter } from '../phonepe.adapter.js';
import * as dbClient from '../../../db/client.js';

describe('PaymentsService.reconcilePublicReturn', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const orderId = 'bcfdc1e1-02b3-4305-ae34-bccc42f54bed';
  const paymentId = '4c60bfed-3f37-43bb-8028-361022d53552';
  const txId = '34b8a7d9-32e3-4bae-829b-7976112d17ff';

  let poolQueryMock: ReturnType<typeof vi.fn>;
  let clientQueryMock: ReturnType<typeof vi.fn>;
  let service: PaymentsService;

  beforeEach(() => {
    vi.restoreAllMocks();
    poolQueryMock = vi.fn();
    clientQueryMock = vi.fn();

    vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQueryMock } as unknown as Pool);
    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
        fn({ query: clientQueryMock } as unknown as PoolClient),
    );

    service = new PaymentsService();
  });

  it('verifies via PhonePe S2S status API when (orderId, merchantTransactionId) matches', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ payment_id: paymentId, org_id: orgId, status: 'CREATED' }],
    });
    clientQueryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: paymentId,
            org_id: orgId,
            order_id: orderId,
            status: 'CREATED',
            provider: 'phonepe',
            provider_order_id: txId,
            amount_paise: 59745,
            session_id: 'sess-1',
            customer_id: null,
            session_customer_id: null,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });

    const fetchSpy = vi.spyOn(PhonePeAdapter, 'fetchPayment').mockResolvedValueOnce({
      providerOrderId: txId,
      status: 'PAID',
      amountPaise: 59745,
      currency: 'INR',
    });

    const result = await service.reconcilePublicReturn(orderId, txId);

    expect(fetchSpy).toHaveBeenCalledWith(txId);
    expect(result).toEqual({ success: true, status: 'PAID', settled: true });
  });

  it('rejects missing or mismatched (orderId, merchantTransactionId) pair with 404', async () => {
    poolQueryMock.mockResolvedValueOnce({ rows: [] });

    await expect(service.reconcilePublicReturn(orderId, 'wrong-tx-id')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('stays PENDING when PhonePe gateway has not settled yet (never trusts redirect alone)', async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [{ payment_id: paymentId, org_id: orgId, status: 'CREATED' }],
    });
    clientQueryMock.mockResolvedValueOnce({
      rows: [
        {
          id: paymentId,
          org_id: orgId,
          order_id: orderId,
          status: 'CREATED',
          provider: 'phonepe',
          provider_order_id: txId,
          amount_paise: 59745,
          session_id: 'sess-1',
          customer_id: null,
          session_customer_id: null,
        },
      ],
    });
    vi.spyOn(PhonePeAdapter, 'fetchPayment').mockResolvedValueOnce({
      providerOrderId: txId,
      status: 'PENDING',
      amountPaise: 59745,
      currency: 'INR',
    });

    const result = await service.reconcilePublicReturn(orderId, txId);

    expect(result).toEqual({ success: false, status: 'CREATED', settled: false });
  });
});

