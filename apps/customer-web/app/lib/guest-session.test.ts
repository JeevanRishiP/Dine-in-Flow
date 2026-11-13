import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSignedQrTokenFromSearch,
  extractUrlTableAndOutlet,
  fetchOutletTableDirectory,
  fetchCurrentGuestSessionRemote,
  openManualTableSession,
  sanitizeTableDigits,
  matchHotelTable,
  resolveTenantIds,
  saveGuestSession,
  loadGuestSession,
  saveCustomerAuth,
  loadCustomerAuth,
  customerApiFetch,
  type OutletTableInfo,
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

describe('customer-web guest-session QR, live table matching & auth helpers', () => {
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

  it('extracts valid signed QR params and rejects unsigned malformed QR tokens', () => {
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
    assert.equal(buildSignedQrTokenFromSearch(new URLSearchParams('t=T04')), null);
    assert.equal(buildSignedQrTokenFromSearch(new URLSearchParams(`t=${validUuid}&v=1&sig=short`)), null);
  });

  it('strips alphabets cleanly and live-matches numeric input against hotel tables', () => {
    assert.equal(sanitizeTableDigits('T04abc'), '04');
    assert.equal(sanitizeTableDigits('abc'), '');

    const hotelTables: OutletTableInfo[] = [
      { id: 't1', table_number: 'T01', numeric_number: '1' },
      { id: 't4', table_number: 'T04', numeric_number: '4' },
      { id: 't12', table_number: '12', numeric_number: '12' },
    ];

    assert.equal(matchHotelTable('4', hotelTables)?.id, 't4');
    assert.equal(matchHotelTable('04', hotelTables)?.id, 't4');
    assert.equal(matchHotelTable('12', hotelTables)?.id, 't12');
    assert.equal(matchHotelTable('99', hotelTables), null);
    assert.equal(matchHotelTable('abc', hotelTables), null);
  });

  it('extracts NFC/URL table numbers when prefilled and detects when missing', () => {
    const outUuid = '71ad00a6-d79b-4035-b563-bf9543fcfa86';
    const withTable = extractUrlTableAndOutlet(new URLSearchParams(`table=4&outlet=${outUuid}`));
    assert.equal(withTable.tableNumberParam, '4');
    assert.equal(withTable.outletIdParam, outUuid);

    const bare = extractUrlTableAndOutlet(new URLSearchParams(''));
    assert.equal(bare.signedQrToken, null);
    assert.equal(bare.tableNumberParam, null);
  });

  it('never hardcodes fallback tenant UUIDs when no session or env exists', () => {
    const tenant = resolveTenantIds(null);
    assert.equal(tenant.orgId, '');
    assert.equal(tenant.outletId, '');
  });

  it('attaches Bearer token, credentials include, and x-org-id from guest session or customer auth', async () => {
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
    const capturedCreds: Array<RequestCredentials | undefined> = [];
    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      capturedHeaders.push(new Headers(init?.headers));
      capturedCreds.push(init?.credentials);
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    await customerApiFetch('/api/v1/customer/orders', { method: 'POST' }, { preferToken: 'guest' });
    assert.equal(capturedHeaders[0]?.get('Authorization'), 'Bearer guest-jwt-123');
    assert.equal(capturedHeaders[0]?.get('x-org-id'), 'org-1');
    assert.equal(capturedCreds[0], 'include');

    await customerApiFetch('/api/v1/auth/customer/profile', undefined, { preferToken: 'customer' });
    assert.equal(capturedHeaders[1]?.get('Authorization'), 'Bearer cust-jwt-456');
    assert.equal(capturedHeaders[1]?.get('x-org-id'), 'org-1');
  });

  it('fetches public table directory even without outlet_id and parses slug URL params', async () => {
    const parsed = extractUrlTableAndOutlet(new URLSearchParams('slug=royal-spice-bistro&table=7'));
    assert.equal(parsed.slugParam, 'royal-spice-bistro');
    assert.equal(parsed.tableNumberParam, '7');

    let calledUrl = '';
    globalThis.fetch = (async (input: string | URL | Request) => {
      calledUrl = typeof input === 'string' ? input : input.toString();
      return new Response(
        JSON.stringify({
          org_id: 'org-pilot',
          outlet_id: 'outlet-pilot',
          tables: [{ id: 't4', table_number: 'T04', numeric_number: '4' }],
        }),
        { status: 200 },
      );
    }) as typeof fetch;

    const dir = await fetchOutletTableDirectory();
    assert.equal(calledUrl, '/api/v1/public/tables/directory');
    assert.equal(dir?.outletId, 'outlet-pilot');
    assert.equal(dir?.tables[0]?.numeric_number, '4');
  });

  it('persists and restores temporary guest customer sessions via HttpOnly cookie endpoints', async () => {
    let sawIncludeOnOpen = false;
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/v1/public/sessions/open-manual') {
        sawIncludeOnOpen = init?.credentials === 'include';
        return new Response(
          JSON.stringify({
            id: 'sess-5',
            org_id: 'org-pilot',
            outlet_id: 'outlet-pilot',
            table_id: 'tbl-5',
            table_number: 'T05',
            tempCustomerId: 'tc-123',
            guestSessionToken: 'guest-tok-tc123',
          }),
          { status: 201 },
        );
      }
      if (url === '/api/v1/public/sessions/me') {
        return new Response(
          JSON.stringify({
            active: true,
            dissolved: false,
            tempCustomerId: 'tc-123',
            orgId: 'org-pilot',
            outletId: 'outlet-pilot',
            tableId: 'tbl-5',
            tableNumber: 'T05',
            sessionId: 'sess-5',
            guestSessionToken: 'guest-tok-tc123',
            activeTables: [{ id: 'tbl-5', table_number: 'T05' }],
          }),
          { status: 200 },
        );
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;

    const opened = await openManualTableSession('outlet-pilot', '5', 2);
    assert.equal(opened.ok, true);
    assert.equal(sawIncludeOnOpen, true);
    if (opened.ok) {
      assert.equal(opened.session.tempCustomerId, 'tc-123');
    }

    const restored = await fetchCurrentGuestSessionRemote();
    assert.equal(restored?.active, true);
    assert.equal(restored?.session?.tableNumber, 'T05');
    assert.equal(restored?.session?.tempCustomerId, 'tc-123');
  });
});
