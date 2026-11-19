import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getLiveTableValidation,
} from './table-modal-utils.ts';
import {
  DEFAULT_DEV_OUTLET_ID,
  DEFAULT_DEV_ORG_ID,
  resolveTenantIds,
  openManualTableSession,
  saveGuestSession,
  clearGuestSession,
  type OutletTableInfo,
} from '../../app/lib/guest-session.ts';

const MOCK_OUTLET_TABLES: OutletTableInfo[] = [
  { id: 'tbl-1', table_number: 'T1', numeric_number: '1', section: 'Main Hall', capacity: 4 },
  { id: 'tbl-2', table_number: 'T2', numeric_number: '2', section: 'Main Hall', capacity: 4 },
  { id: 'tbl-4', table_number: 'T04', numeric_number: '4', section: 'Balcony', capacity: 2 },
  { id: 'tbl-12', table_number: '12', numeric_number: '12', section: 'VIP Lounge', capacity: 6 },
];

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

describe('TableModal & getLiveTableValidation domain tests', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const origWindow = globalThis.window;
  const origFetch = globalThis.fetch;

  beforeEach(() => {
    const sessionStorage = createMemoryStorage();
    const localStorage = createMemoryStorage();
    (globalThis as unknown as { window: unknown }).window = {
      sessionStorage,
      localStorage,
    };
  });

  afterEach(() => {
    (process.env as Record<string, string | undefined>)['NODE_ENV'] = originalNodeEnv;
    (globalThis as unknown as { window: unknown }).window = origWindow;
    globalThis.fetch = origFetch;
  });

  describe('getLiveTableValidation', () => {
    it('returns empty result when input digits are empty', () => {
      const res = getLiveTableValidation('', MOCK_OUTLET_TABLES, true, 'outlet-123');
      assert.deepEqual(res, { matched: null, error: '' });
    });

    it('matches valid table digits in outlet directory', () => {
      const res1 = getLiveTableValidation('1', MOCK_OUTLET_TABLES, true, 'outlet-123');
      assert.equal(res1.matched?.id, 'tbl-1');
      assert.equal(res1.error, '');

      const res4 = getLiveTableValidation('4', MOCK_OUTLET_TABLES, true, 'outlet-123');
      assert.equal(res4.matched?.id, 'tbl-4');
      assert.equal(res4.error, '');

      const res12 = getLiveTableValidation('12', MOCK_OUTLET_TABLES, true, 'outlet-123');
      assert.equal(res12.matched?.id, 'tbl-12');
      assert.equal(res12.error, '');
    });

    it('returns validation error when digits do not match any hotel table', () => {
      const res = getLiveTableValidation('99', MOCK_OUTLET_TABLES, true, 'outlet-123');
      assert.equal(res.matched, null);
      assert.match(res.error, /Table 99 is wrong/);
    });

    it('does not produce an error while directory is still loading', () => {
      const res = getLiveTableValidation('4', [], false, null);
      assert.deepEqual(res, { matched: null, error: '' });
    });

    it('gracefully triggers dev fallback and avoids error when outletId is null in development', () => {
      (process.env as Record<string, string | undefined>)['NODE_ENV'] = 'development';
      let triggeredDevId: string | null = null;

      const res = getLiveTableValidation(
        '4',
        [],
        true,
        null,
        (devOutletId) => {
          triggeredDevId = devOutletId;
        },
      );

      // In dev without outletId, do not show fatal "Table directory unavailable" error
      assert.deepEqual(res, { matched: null, error: '' });
      assert.equal(triggeredDevId, DEFAULT_DEV_OUTLET_ID);
    });

    it('shows table directory unavailable error in production when tables list is empty', () => {
      (process.env as Record<string, string | undefined>)['NODE_ENV'] = 'production';
      let fallbackCalled = false;

      const res = getLiveTableValidation(
        '4',
        [],
        true,
        null,
        () => {
          fallbackCalled = true;
        },
      );

      assert.equal(res.matched, null);
      assert.equal(res.error, 'Table directory unavailable for this hotel outlet.');
      assert.equal(fallbackCalled, false);
    });
  });

  describe('Session initialization dev fallback behavior', () => {
    it('provides correct default dev outlet and org constants', () => {
      assert.equal(DEFAULT_DEV_OUTLET_ID, '71ad00a6-d79b-4035-b563-bf9543fcfa86');
      assert.equal(DEFAULT_DEV_ORG_ID, '7762b6af-d052-4e74-b917-39e3c56e7914');
    });

    it('resolveTenantIds falls back to DEFAULT_DEV_OUTLET_ID when fallbackToDev is requested', () => {
      clearGuestSession();
      const tenant = resolveTenantIds(null, { fallbackToDev: true });
      assert.equal(tenant.outletId, DEFAULT_DEV_OUTLET_ID);
      assert.equal(tenant.orgId, DEFAULT_DEV_ORG_ID);
    });

    it('resolveTenantIds prioritizes active session outletId over dev fallback', () => {
      saveGuestSession({
        sessionId: 'sess-custom',
        orgId: 'org-custom',
        outletId: 'custom-outlet-uuid',
        tableId: 'tbl-custom',
        tableNumber: 'T5',
        guestSessionToken: 'jwt-custom',
      });

      const tenant = resolveTenantIds(null, { fallbackToDev: true });
      assert.equal(tenant.outletId, 'custom-outlet-uuid');
      assert.equal(tenant.orgId, 'org-custom');
    });

    it('openManualTableSession injects default dev outlet ID in development if outletId is omitted', async () => {
      (process.env as Record<string, string | undefined>)['NODE_ENV'] = 'development';
      let capturedBody: Record<string, unknown> | null = null;

      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.body) {
          capturedBody = JSON.parse(init.body as string) as Record<string, unknown>;
        }
        return new Response(
          JSON.stringify({
            id: 'sess-new',
            org_id: DEFAULT_DEV_ORG_ID,
            outlet_id: DEFAULT_DEV_OUTLET_ID,
            table_id: 'tbl-1',
            table_number: 'T1',
            guestSessionToken: 'token-123',
          }),
          { status: 200 },
        );
      }) as typeof fetch;

      const res = await openManualTableSession(undefined, '1', 2);
      assert.equal(res.ok, true);
      assert.equal(capturedBody?.['outlet_id'], DEFAULT_DEV_OUTLET_ID);
      assert.equal(capturedBody?.['table_number'], '1');
    });
  });
});
