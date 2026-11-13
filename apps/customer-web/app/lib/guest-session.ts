export interface GuestSessionState {
  sessionId: string;
  orgId: string;
  outletId: string;
  tableId: string;
  tableNumber: string;
  guestSessionToken: string;
  tempCustomerId?: string;
  qrToken?: string;
}

export interface CustomerAuthState {
  accessToken: string;
  customerId: string;
}

export interface OutletTableInfo {
  id: string;
  table_number: string;
  numeric_number: string;
  section?: string | null;
  capacity?: number;
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

/** Keep digits only — prevents alphabets in table input fields. */
export function sanitizeTableDigits(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 4);
}

/** Normalizes table codes such as "T04", "04", "4" to "4". */
export function normalizeTableDigitsKey(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits || '';
}

/** Matches a digits-only table input against an outlet's table list in real time. */
export function matchHotelTable(
  digitsInput: string,
  tables: OutletTableInfo[],
): OutletTableInfo | null {
  const cleanDigits = sanitizeTableDigits(digitsInput);
  if (!cleanDigits) return null;
  const key = normalizeTableDigitsKey(cleanDigits);
  if (!key) return null;

  return (
    tables.find((t) => {
      const tableKey = t.numeric_number || normalizeTableDigitsKey(t.table_number);
      return (
        tableKey === key ||
        t.table_number.toUpperCase() === cleanDigits ||
        t.table_number.toUpperCase() === `T${cleanDigits}`
      );
    }) ?? null
  );
}

/**
 * Extracts a signed table QR token from URL search parameters.
 * Supports either `?qr=<token>` or `?t=<uuid>&v=<int>&sig=<hmacHex>`.
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

/** Extracts plain table/outlet/slug params written to NFC or link URLs (if unsigned). */
export function extractUrlTableAndOutlet(params: URLSearchParams): {
  signedQrToken: string | null;
  tableNumberParam: string | null;
  outletIdParam: string | null;
  slugParam: string | null;
} {
  const signedQrToken = buildSignedQrTokenFromSearch(params);
  const rawTable = params.get('table') ?? params.get('tbl') ?? '';
  const tableDigits = sanitizeTableDigits(rawTable);
  const rawOutlet = params.get('outlet') ?? params.get('outlet_id') ?? '';
  const outletIdParam = UUID_REGEX.test(rawOutlet.trim()) ? rawOutlet.trim() : null;
  const rawSlug = params.get('slug') ?? params.get('restaurant') ?? '';
  const slugParam = rawSlug.trim() ? rawSlug.trim().toLowerCase() : null;

  return {
    signedQrToken,
    tableNumberParam: tableDigits || null,
    outletIdParam,
    slugParam,
  };
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

export async function fetchOutletTableDirectory(
  outletId?: string,
  slug?: string,
): Promise<{
  orgId: string;
  outletId: string;
  tables: OutletTableInfo[];
} | null> {
  try {
    const qs = new URLSearchParams();
    if (outletId && UUID_REGEX.test(outletId)) qs.set('outlet_id', outletId);
    if (slug && slug.trim()) qs.set('slug', slug.trim());
    const queryStr = qs.toString();
    const url = queryStr ? `/api/v1/public/tables/directory?${queryStr}` : '/api/v1/public/tables/directory';
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      org_id?: string;
      outlet_id?: string;
      tables?: OutletTableInfo[];
    };
    if (!data?.org_id || !Array.isArray(data.tables)) return null;
    return {
      orgId: data.org_id,
      outletId: data.outlet_id || outletId || '',
      tables: data.tables,
    };
  } catch {
    return null;
  }
}

async function openPublicSessionPost(
  url: string,
  payload: Record<string, unknown>,
  fallbackError: string,
  extra?: { qrToken?: string; fallbackTableNumber?: string },
): Promise<{ ok: true; session: GuestSessionState } | { ok: false; error: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const customerAuth = loadCustomerAuth();
    if (customerAuth?.accessToken) {
      headers['Authorization'] = `Bearer ${customerAuth.accessToken}`;
    }

    const res = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as { detail?: string; message?: string };
      return {
        ok: false,
        error: errBody.detail || errBody.message || fallbackError,
      };
    }
    const data = (await res.json()) as {
      id: string;
      org_id: string;
      outlet_id: string;
      table_id: string;
      table_number?: string;
      tempCustomerId?: string;
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
      tableNumber: data.table_number || extra?.fallbackTableNumber || '',
      guestSessionToken: data.guestSessionToken,
      ...(data.tempCustomerId ? { tempCustomerId: data.tempCustomerId } : {}),
      ...(extra?.qrToken ? { qrToken: extra.qrToken } : {}),
    };
    saveGuestSession(session);
    return { ok: true, session };
  } catch {
    return { ok: false, error: 'Unable to open table session with server.' };
  }
}

export async function openSignedTableSession(
  qrToken: string,
  pax = 2,
): Promise<{ ok: true; session: GuestSessionState } | { ok: false; error: string }> {
  return openPublicSessionPost(
    '/api/v1/public/sessions/open',
    { qr_token: qrToken, pax },
    'Invalid or expired table QR code.',
    { qrToken },
  );
}

export async function openManualTableSession(
  outletId: string | undefined,
  tableNumber: string,
  pax = 2,
  slug?: string,
): Promise<{ ok: true; session: GuestSessionState } | { ok: false; error: string }> {
  const payload: {
    table_number: string;
    pax: number;
    outlet_id?: string;
    slug?: string;
  } = { table_number: tableNumber, pax };
  if (outletId && UUID_REGEX.test(outletId)) payload.outlet_id = outletId;
  if (slug && slug.trim()) payload.slug = slug.trim();
  return openPublicSessionPost(
    '/api/v1/public/sessions/open-manual',
    payload,
    'Wrong table number for this hotel.',
    { fallbackTableNumber: tableNumber },
  );
}

export async function fetchCurrentGuestSessionRemote(): Promise<{
  active: boolean;
  dissolved?: boolean;
  session?: GuestSessionState;
  activeTables?: Array<{ id: string; table_number: string }>;
} | null> {
  try {
    const res = await fetch('/api/v1/public/sessions/me', {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      active?: boolean;
      dissolved?: boolean;
      tempCustomerId?: string;
      orgId?: string;
      outletId?: string;
      tableId?: string;
      tableNumber?: string;
      sessionId?: string;
      guestSessionToken?: string;
      activeTables?: Array<{ id: string; table_number: string }>;
    };
    if (!data.active) {
      if (data.dissolved) {
        clearGuestSession();
      }
      return { active: false, dissolved: Boolean(data.dissolved) };
    }
    if (
      !data.sessionId ||
      !data.orgId ||
      !data.outletId ||
      !data.tableId ||
      !data.guestSessionToken
    ) {
      return { active: false, dissolved: false };
    }
    const session: GuestSessionState = {
      sessionId: data.sessionId,
      orgId: data.orgId,
      outletId: data.outletId,
      tableId: data.tableId,
      tableNumber: data.tableNumber || '',
      guestSessionToken: data.guestSessionToken,
      ...(data.tempCustomerId ? { tempCustomerId: data.tempCustomerId } : {}),
    };
    saveGuestSession(session);
    return {
      active: true,
      dissolved: false,
      session,
      activeTables: data.activeTables || [],
    };
  } catch {
    return null;
  }
}

export async function refreshCustomerSessionRemote(orgId?: string): Promise<{
  accessToken: string;
  customerId: string;
  phone?: string;
  email?: string | null;
  displayName?: string | null;
  loyaltyPoints?: number;
} | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (orgId) headers['x-org-id'] = orgId;
    const res = await fetch('/api/v1/auth/customer/refresh', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({}),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      accessToken?: string;
      customerId?: string;
      phone?: string;
      email?: string | null;
      displayName?: string | null;
      loyaltyPoints?: number;
    };
    if (!data.accessToken || !data.customerId) return null;
    saveCustomerAuth({ accessToken: data.accessToken, customerId: data.customerId });
    return {
      accessToken: data.accessToken,
      customerId: data.customerId,
      phone: data.phone,
      email: data.email,
      displayName: data.displayName,
      loyaltyPoints: data.loyaltyPoints,
    };
  } catch {
    return null;
  }
}

export async function logoutCustomerRemote(orgId?: string): Promise<void> {
  clearCustomerAuth();
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (orgId) headers['x-org-id'] = orgId;
    await fetch('/api/v1/auth/customer/logout', {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({}),
    });
  } catch {
    // Ignore network failures during logout cleanup.
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
  return fetch(input, {
    ...init,
    credentials: init.credentials ?? 'include',
    headers,
  });
}
