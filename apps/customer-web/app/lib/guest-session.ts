export interface GuestSessionState {
  sessionId: string;
  orgId: string;
  outletId: string;
  tableId: string;
  tableNumber: string;
  guestSessionToken: string;
  qrToken?: string;
}

export interface CustomerAuthState {
  accessToken: string;
  customerId: string;
}

const GUEST_SESSION_STORAGE_KEY = 'dineflow_guest_session_v2';
const CUSTOMER_AUTH_STORAGE_KEY = 'dineflow_customer_auth_v2';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_REGEX = /^[0-9a-f]+$/i;

function safeSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function purgeLegacyCustomerStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem('dineflow_customer_token');
    window.localStorage.removeItem('dineflow_customer_id');
  } catch {
    // Ignore restricted browser storage environments.
  }
}

/**
 * Extracts a signed table QR token from URL search parameters.
 * Supports either `?qr=<token>` or `?t=<uuid>&v=<int>&sig=<hmacHex>`.
 * Never synthesizes an unsigned table number fallback.
 */
export function buildSignedQrTokenFromSearch(params: URLSearchParams): string | null {
  const composite = params.get('qr')?.trim();
  if (composite) {
    return composite;
  }

  const tableId = params.get('t')?.trim() ?? '';
  const versionRaw = params.get('v')?.trim() ?? '';
  const sig = params.get('sig')?.trim() ?? '';

  if (
    UUID_REGEX.test(tableId) &&
    /^\d+$/.test(versionRaw) &&
    sig.length >= 32 &&
    HEX_REGEX.test(sig)
  ) {
    return `${tableId}:${versionRaw}:${sig}`;
  }
  return null;
}

export function loadGuestSession(): GuestSessionState | null {
  const storage = safeSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(GUEST_SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<GuestSessionState>;
    if (
      !parsed?.sessionId ||
      !parsed?.orgId ||
      !parsed?.outletId ||
      !parsed?.tableId ||
      !parsed?.guestSessionToken
    ) {
      return null;
    }
    return {
      sessionId: parsed.sessionId,
      orgId: parsed.orgId,
      outletId: parsed.outletId,
      tableId: parsed.tableId,
      tableNumber: parsed.tableNumber || '',
      guestSessionToken: parsed.guestSessionToken,
      qrToken: parsed.qrToken,
    };
  } catch {
    storage.removeItem(GUEST_SESSION_STORAGE_KEY);
    return null;
  }
}

export function saveGuestSession(session: GuestSessionState): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  storage.setItem(GUEST_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearGuestSession(): void {
  const storage = safeSessionStorage();
  if (!storage) return;
  storage.removeItem(GUEST_SESSION_STORAGE_KEY);
}

export function loadCustomerAuth(): CustomerAuthState | null {
  purgeLegacyCustomerStorage();
  const storage = safeSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(CUSTOMER_AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CustomerAuthState>;
    if (!parsed?.accessToken || !parsed?.customerId) return null;
    return { accessToken: parsed.accessToken, customerId: parsed.customerId };
  } catch {
    storage.removeItem(CUSTOMER_AUTH_STORAGE_KEY);
    return null;
  }
}

export function saveCustomerAuth(auth: CustomerAuthState): void {
  purgeLegacyCustomerStorage();
  const storage = safeSessionStorage();
  if (!storage) return;
  storage.setItem(CUSTOMER_AUTH_STORAGE_KEY, JSON.stringify(auth));
}

export function clearCustomerAuth(): void {
  purgeLegacyCustomerStorage();
  const storage = safeSessionStorage();
  if (!storage) return;
  storage.removeItem(CUSTOMER_AUTH_STORAGE_KEY);
}

export function resolveTenantIds(session?: GuestSessionState | null): {
  orgId: string;
  outletId: string;
} {
  const active = session ?? loadGuestSession();
  return {
    orgId: active?.orgId || process.env['NEXT_PUBLIC_DEFAULT_ORG_ID'] || '',
    outletId: active?.outletId || process.env['NEXT_PUBLIC_DEFAULT_OUTLET_ID'] || '',
  };
}

export async function openSignedTableSession(
  qrToken: string,
  pax = 2,
): Promise<{ ok: true; session: GuestSessionState } | { ok: false; error: string }> {
  try {
    const res = await fetch('/api/v1/public/sessions/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ qr_token: qrToken, pax }),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
      return {
        ok: false,
        error: errBody.detail || errBody.message || 'Invalid or expired table QR code.',
      };
    }
    const data = (await res.json()) as {
      id: string;
      org_id: string;
      outlet_id: string;
      table_id: string;
      table_number?: string;
      guestSessionToken?: string;
    };
    if (!data.id || !data.org_id || !data.outlet_id || !data.table_id || !data.guestSessionToken) {
      return { ok: false, error: 'Server did not issue a valid guest session token.' };
    }
    const session: GuestSessionState = {
      sessionId: data.id,
      orgId: data.org_id,
      outletId: data.outlet_id,
      tableId: data.table_id,
      tableNumber: data.table_number || '',
      guestSessionToken: data.guestSessionToken,
      qrToken,
    };
    saveGuestSession(session);
    return { ok: true, session };
  } catch {
    return { ok: false, error: 'Unable to verify table QR code with server.' };
  }
}

export async function customerApiFetch(
  input: string,
  init: RequestInit = {},
  options: { preferToken?: 'guest' | 'customer'; tokenOverride?: string | null; orgIdOverride?: string } = {},
): Promise<Response> {
  const guestSession = loadGuestSession();
  const customerAuth = loadCustomerAuth();
  const { orgId } = resolveTenantIds(guestSession);
  const effectiveOrg = options.orgIdOverride || orgId;

  const bearer =
    options.tokenOverride ||
    (options.preferToken === 'customer'
      ? customerAuth?.accessToken
      : options.preferToken === 'guest'
      ? guestSession?.guestSessionToken
      : guestSession?.guestSessionToken || customerAuth?.accessToken);

  const headers = new Headers(init.headers);
  if (bearer) {
    headers.set('Authorization', `Bearer ${bearer}`);
  }
  if (effectiveOrg) {
    headers.set('x-org-id', effectiveOrg);
  }
  return fetch(input, { ...init, headers });
}

