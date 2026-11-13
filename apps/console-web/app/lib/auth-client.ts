export interface StaffSessionUser {
  id: string;
  orgId: string;
  orgSlug: string;
  outletId: string | null;
  role: string;
  username: string;
  email: string;
  name: string;
  avatar?: string;
}

export interface ConsoleStaffRecord {
  id: string;
  orgId: string;
  username: string;
  email: string;
  displayName: string;
  phone: string | null;
  role: 'OWNER' | 'MANAGER' | 'CAPTAIN' | 'KITCHEN' | 'CASHIER' | 'WAITER';
  outletId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface ConsoleStaffDirectory {
  orgId: string;
  orgSlug: string;
  orgName: string;
  outlets: Array<{
    id: string;
    name: string;
    address: string | null;
    isActive: boolean;
  }>;
  staff: ConsoleStaffRecord[];
}

export interface ConsoleAuthState {
  accessToken: string;
  refreshToken: string;
  user: StaffSessionUser;
  exp: number;
}

export interface StaffLoginOutcome {
  ok: boolean;
  requiresMfa?: boolean;
  preMfaToken?: string;
  session?: ConsoleAuthState;
  error?: string;
}

const CONSOLE_AUTH_STORAGE_KEY = 'dineflow_console_auth_v2';

const LEGACY_INSECURE_KEYS = [
  'dineflow_owner_password',
  'dineflow_logged_in_user',
  'dineflow_owner_session_active',
  'dineflow_custom_staff',
];

let refreshInFlight: Promise<ConsoleAuthState | null> | null = null;

function safeSessionStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function purgeLegacyAuthStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_INSECURE_KEYS) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors in restricted browser contexts.
  }
}

export interface DecodedStaffClaims {
  sub: string;
  org: string;
  role: string;
  outletId: string | null;
  type?: string;
  exp?: number;
}

/**
 * Decode JWT payload strictly for UI routing/header hints.
 * Signature verification and RBAC enforcement always happen on the backend API.
 */
export function decodeStaffJwtClaims(token: string): DecodedStaffClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json =
      typeof atob === 'function'
        ? atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as Partial<DecodedStaffClaims>;
    if (!payload.sub || !payload.org || !payload.role) return null;
    return {
      sub: payload.sub,
      org: payload.org,
      role: payload.role,
      outletId: payload.outletId ?? null,
      type: payload.type,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

export function isAuthStateExpired(state: Pick<ConsoleAuthState, 'exp'>, skewSeconds = 30): boolean {
  if (!state.exp) return false;
  return Date.now() >= (state.exp - skewSeconds) * 1000;
}

export function getConsoleAuthState(): ConsoleAuthState | null {
  purgeLegacyAuthStorage();
  const storage = safeSessionStorage();
  if (!storage) return null;
  const raw = storage.getItem(CONSOLE_AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ConsoleAuthState;
    if (!parsed?.accessToken || !parsed?.user?.orgId || !parsed?.user?.role) {
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(CONSOLE_AUTH_STORAGE_KEY);
    return null;
  }
}

export function setConsoleAuthState(state: ConsoleAuthState): void {
  purgeLegacyAuthStorage();
  const storage = safeSessionStorage();
  if (!storage) return;
  storage.setItem(CONSOLE_AUTH_STORAGE_KEY, JSON.stringify(state));
}

export function clearConsoleAuthState(): void {
  purgeLegacyAuthStorage();
  const storage = safeSessionStorage();
  if (!storage) return;
  storage.removeItem(CONSOLE_AUTH_STORAGE_KEY);
}

function buildAuthStateFromTokens(params: {
  accessToken: string;
  refreshToken: string;
  orgSlug?: string;
  username?: string;
  email?: string;
  name?: string;
}): ConsoleAuthState | null {
  const claims = decodeStaffJwtClaims(params.accessToken);
  if (!claims || claims.type !== 'staff_access') return null;
  const resolvedUsername =
    params.username?.trim().toLowerCase() ||
    params.email?.trim().toLowerCase().split('@')[0] ||
    claims.role.toLowerCase();
  const resolvedEmail = params.email?.trim().toLowerCase() || resolvedUsername;
  const fallbackName = params.name?.trim() || resolvedUsername || claims.role;
  return {
    accessToken: params.accessToken,
    refreshToken: params.refreshToken,
    exp: claims.exp ?? Math.floor(Date.now() / 1000) + 900,
    user: {
      id: claims.sub,
      orgId: claims.org,
      orgSlug: (params.orgSlug ?? '').trim().toLowerCase(),
      outletId: claims.outletId,
      role: claims.role.toUpperCase(),
      username: resolvedUsername,
      email: resolvedEmail,
      name: fallbackName,
    },
  };
}

async function extractErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: string; message?: string; title?: string };
    return body.detail || body.message || body.title || fallback;
  } catch {
    return fallback;
  }
}

export async function loginStaffRemote(params: {
  orgSlug?: string;
  username?: string;
  email?: string;
  password: string;
}): Promise<StaffLoginOutcome> {
  const orgSlug = (params.orgSlug ?? '').trim().toLowerCase();
  const identifier = (params.username ?? params.email ?? '').trim().toLowerCase();
  const password = params.password;

  if (!identifier || !password) {
    return { ok: false, error: 'Username and password are required.' };
  }

  try {
    const body: Record<string, string> = { username: identifier, password };
    if (orgSlug) {
      body['orgSlug'] = orgSlug;
    }

    const res = await fetch('/api/v1/auth/staff/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, error: await extractErrorMessage(res, 'Invalid username or password.') };
    }
    const data = (await res.json()) as {
      accessToken?: string;
      refreshToken?: string;
      requiresMfa?: boolean;
      preMfaToken?: string;
      username?: string;
      email?: string;
      displayName?: string;
      orgSlug?: string;
    };
    if (data.requiresMfa && data.preMfaToken) {
      return { ok: true, requiresMfa: true, preMfaToken: data.preMfaToken };
    }
    if (!data.accessToken) {
      return { ok: false, error: 'Authentication server did not issue a valid token.' };
    }
    const state = buildAuthStateFromTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? '',
      orgSlug: data.orgSlug || orgSlug,
      username: data.username || (!identifier.includes('@') ? identifier : undefined),
      email: data.email || (identifier.includes('@') ? identifier : undefined),
      name: data.displayName,
    });
    if (!state) {
      return { ok: false, error: 'Received malformed staff token.' };
    }
    setConsoleAuthState(state);
    return { ok: true, requiresMfa: false, session: state };
  } catch {
    return { ok: false, error: 'Unable to reach authentication service.' };
  }
}

export async function verifyStaffMfaRemote(params: {
  preMfaToken: string;
  code: string;
  orgSlug?: string;
  username?: string;
  email?: string;
}): Promise<StaffLoginOutcome> {
  const code = params.code.trim();
  if (!params.preMfaToken || !code) {
    return { ok: false, error: 'MFA verification code is required.' };
  }
  try {
    const res = await fetch('/api/v1/auth/staff/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preMfaToken: params.preMfaToken, code }),
    });
    if (!res.ok) {
      return { ok: false, error: await extractErrorMessage(res, 'Invalid authenticator code.') };
    }
    const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
    if (!data.accessToken) {
      return { ok: false, error: 'MFA verification did not return an access token.' };
    }
    const state = buildAuthStateFromTokens({
      accessToken: data.accessToken,
      refreshToken: data.refreshToken ?? '',
      orgSlug: params.orgSlug,
      username: params.username,
      email: params.email,
    });
    if (!state) {
      return { ok: false, error: 'Received malformed staff token after MFA.' };
    }
    setConsoleAuthState(state);
    return { ok: true, requiresMfa: false, session: state };
  } catch {
    return { ok: false, error: 'Unable to reach MFA verification service.' };
  }
}

export async function refreshConsoleSession(): Promise<ConsoleAuthState | null> {
  if (refreshInFlight) return refreshInFlight;

  const current = getConsoleAuthState();
  if (!current?.refreshToken || !current.user?.orgId) {
    clearConsoleAuthState();
    return null;
  }

  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/v1/auth/staff/refresh', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-org-id': current.user.orgId,
        },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      if (!res.ok) {
        clearConsoleAuthState();
        return null;
      }
      const data = (await res.json()) as { accessToken?: string; refreshToken?: string };
      if (!data.accessToken) {
        clearConsoleAuthState();
        return null;
      }
      const next = buildAuthStateFromTokens({
        accessToken: data.accessToken,
        refreshToken: data.refreshToken ?? current.refreshToken,
        orgSlug: current.user.orgSlug,
        username: current.user.username,
        email: current.user.email,
        name: current.user.name,
      });
      if (!next) {
        clearConsoleAuthState();
        return null;
      }
      setConsoleAuthState(next);
      return next;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function logoutStaffRemote(): Promise<void> {
  const current = getConsoleAuthState();
  clearConsoleAuthState();
  if (!current?.refreshToken || !current.user?.orgId) return;
  await fetch('/api/v1/auth/staff/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-org-id': current.user.orgId,
    },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  }).catch(() => {});
}

export async function consoleAuthFetch(input: string, init: RequestInit = {}): Promise<Response> {
  let state = getConsoleAuthState();
  if (state && isAuthStateExpired(state) && state.refreshToken) {
    state = await refreshConsoleSession();
  }

  const headers = new Headers(init.headers);
  if (state?.accessToken) {
    headers.set('Authorization', `Bearer ${state.accessToken}`);
  }
  if (state?.user?.orgId) {
    headers.set('x-org-id', state.user.orgId);
  }

  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && state?.refreshToken) {
    const refreshed = await refreshConsoleSession();
    if (refreshed?.accessToken) {
      headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
      headers.set('x-org-id', refreshed.user.orgId);
      return fetch(input, { ...init, headers });
    }
  }
  return res;
}

export async function fetchConsoleStaffDirectory(): Promise<{
  ok: boolean;
  data?: ConsoleStaffDirectory;
  error?: string;
}> {
  try {
    const res = await consoleAuthFetch('/api/v1/console/staff');
    if (!res.ok) {
      return { ok: false, error: await extractErrorMessage(res, 'Failed to load staff directory.') };
    }
    const data = (await res.json()) as ConsoleStaffDirectory;
    return { ok: true, data };
  } catch {
    return { ok: false, error: 'Unable to reach server to load staff directory.' };
  }
}

export async function createConsoleStaffMember(payload: {
  name: string;
  username: string;
  password: string;
  role: ConsoleStaffRecord['role'];
  outletId?: string | null;
  phone?: string | null;
}): Promise<{ ok: boolean; staff?: ConsoleStaffRecord; error?: string }> {
  try {
    const res = await consoleAuthFetch('/api/v1/console/staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: await extractErrorMessage(res, 'Failed to create staff account.') };
    }
    return { ok: true, staff: (await res.json()) as ConsoleStaffRecord };
  } catch {
    return { ok: false, error: 'Unable to save staff account.' };
  }
}

export async function updateConsoleStaffMember(
  staffId: string,
  payload: {
    name?: string;
    username?: string;
    password?: string;
    role?: ConsoleStaffRecord['role'];
    outletId?: string | null;
    phone?: string | null;
    isActive?: boolean;
  },
): Promise<{ ok: boolean; staff?: ConsoleStaffRecord; error?: string }> {
  try {
    const res = await consoleAuthFetch(`/api/v1/console/staff/${encodeURIComponent(staffId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      return { ok: false, error: await extractErrorMessage(res, 'Failed to update staff account.') };
    }
    return { ok: true, staff: (await res.json()) as ConsoleStaffRecord };
  } catch {
    return { ok: false, error: 'Unable to update staff account.' };
  }
}

export async function deactivateConsoleStaffMember(
  staffId: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await consoleAuthFetch(`/api/v1/console/staff/${encodeURIComponent(staffId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      return { ok: false, error: await extractErrorMessage(res, 'Failed to deactivate staff account.') };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Unable to deactivate staff account.' };
  }
}
