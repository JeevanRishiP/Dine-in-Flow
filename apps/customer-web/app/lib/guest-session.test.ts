import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignedQrTokenFromSearch,
  resolveTenantIds,
  saveGuestSession,
  loadGuestSession,
  saveCustomerAuth,
  loadCustomerAuth,
  customerApiFetch,
} from './guest-session.ts';

function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe('customer-web guest-session QR & auth helpers', () => {
  const origWindow = globalThis.window;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    const sessionStorage = createMemoryStorage();
    const localStorage = createMemoryStorage();
    localStorage.setItem('dineflow_customer_token', 'old-insecure-token');
    (globalThis as unknown as { window: unknown }).window = {
      sessionStorage,
      localStorage,
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
    globalThis.fetch = origFetch;
  });

  it('extracts valid signed QR params and rejects unsigned table names', () => {
    const validUuid = '11111111-1111-4111-8111-111111111111';
    const validSig = 'a'.repeat(64);

    assert.equal(
      buildSignedQrTokenFromSearch(new URLSearchParams(`t=${validUuid}&v=2&sig=${validSig}`)),
      `${validUuid}:2:${validSig}`,
    );
    assert.equal(
      buildSignedQrTokenFromSearch(new URLSearchParams('qr=composite.signed.token')),
      'composite.signed.token',
    );
    // Reject unsigned legacy `?t=T04` or `?table=T04`
    assert.equal(buildSignedQrTokenFromSearch(new URLSearchParams('t=T04')), null);
    assert.equal(buildSignedQrTokenFromSearch(new URLSearchParams(`t=${validUuid}&v=1&sig=short`)), null);
  });

  it('never hardcodes fallback tenant UUIDs when no session or env exists', () => {
    const tenant = resolveTenantIds(null);
    assert.equal(tenant.orgId, '');
    assert.equal(tenant.outletId, '');
  });

  it('attaches Bearer token and x-org-id from guest session or customer auth', async () => {
    saveGuestSession({
      sessionId: 'sess-1',
      orgId: 'org-1',
      outletId: 'outlet-1',
      tableId: 'tbl-1',
      tableNumber: 'T01',
      guestSessionToken: 'guest-jwt-123',
    });
    saveCustomerAuth({ accessToken: 'cust-jwt-456', customerId: 'cust-1' });

    const win = globalThis.window as unknown as { localStorage: ReturnType<typeof createMemoryStorage> };
    assert.equal(win.localStorage.getItem('dineflow_customer_token'), null);
    assert.equal(loadGuestSession()?.guestSessionToken, 'guest-jwt-123');
    assert.equal(loadCustomerAuth()?.accessToken, 'cust-jwt-456');

    const capturedHeaders: Array<Headers> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders.push(new Headers(init?.headers));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await customerApiFetch('/api/v1/customer/orders', { method: 'POST' }, { preferToken: 'guest' });
    assert.equal(capturedHeaders[0]?.get('Authorization'), 'Bearer guest-jwt-123');
    assert.equal(capturedHeaders[0]?.get('x-org-id'), 'org-1');

    await customerApiFetch('/api/v1/auth/customer/profile', undefined, { preferToken: 'customer' });
    assert.equal(capturedHeaders[1]?.get('Authorization'), 'Bearer cust-jwt-456');
    assert.equal(capturedHeaders[1]?.get('x-org-id'), 'org-1');
  });
});

