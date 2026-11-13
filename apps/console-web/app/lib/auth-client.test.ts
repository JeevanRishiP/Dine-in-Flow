import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeStaffJwtClaims,
  isAuthStateExpired,
  getConsoleAuthState,
  setConsoleAuthState,
  clearConsoleAuthState,
  type ConsoleAuthState,
} from './auth-client.ts';

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

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
    clear: () => map.clear(),
  };
}

describe('console-web auth-client security invariants', () => {
  const origWindow = globalThis.window;

  beforeEach(() => {
    const sessionStorage = createMemoryStorage();
    const localStorage = createMemoryStorage();
    localStorage.setItem('dineflow_owner_password', 'legacy');
    localStorage.setItem('dineflow_logged_in_user', '{"role":"OWNER"}');
    (globalThis as unknown as { window: unknown }).window = {
      sessionStorage,
      localStorage,
    };
  });

  afterEach(() => {
    (globalThis as unknown as { window: unknown }).window = origWindow;
  });

  it('decodes valid staff_access JWT claims and rejects malformed tokens', () => {
    const token = makeToken({
      sub: 'user-1',
      org: 'org-1',
      role: 'OWNER',
      outletId: null,
      type: 'staff_access',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const decoded = decodeStaffJwtClaims(token);
    assert.ok(decoded);
    assert.equal(decoded.sub, 'user-1');
    assert.equal(decoded.org, 'org-1');
    assert.equal(decoded.role, 'OWNER');
    assert.equal(decodeStaffJwtClaims('not-a-jwt'), null);
  });

  it('checks token expiry with skew safety buffer', () => {
    const nowSec = Math.floor(Date.now() / 1000);
    assert.equal(isAuthStateExpired({ exp: nowSec + 10 }, 30), true);
    assert.equal(isAuthStateExpired({ exp: nowSec + 120 }, 30), false);
  });

  it('stores session strictly in sessionStorage and purges legacy insecure localStorage keys', () => {
    const state: ConsoleAuthState = {
      accessToken: 'jwt-access',
      refreshToken: 'jwt-refresh',
      exp: Math.floor(Date.now() / 1000) + 900,
      user: {
        id: 'u-1',
        orgId: 'o-1',
        orgSlug: 'acme',
        outletId: null,
        role: 'OWNER',
        username: 'owner',
        email: 'owner@acme.test',
        name: 'Owner',
      },
    };
    setConsoleAuthState(state);
    const loaded = getConsoleAuthState();
    assert.ok(loaded);
    assert.equal(loaded.user.orgId, 'o-1');

    const win = globalThis.window as unknown as { localStorage: ReturnType<typeof createMemoryStorage> };
    assert.equal(win.localStorage.getItem('dineflow_owner_password'), null);
    assert.equal(win.localStorage.getItem('dineflow_logged_in_user'), null);

    clearConsoleAuthState();
    assert.equal(getConsoleAuthState(), null);
  });
});

