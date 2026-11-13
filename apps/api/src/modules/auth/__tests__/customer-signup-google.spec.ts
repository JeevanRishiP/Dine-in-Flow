import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PoolClient } from 'pg';
import type Redis from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { CustomerOtpService } from '../customer-otp.service.js';
import { CustomerAuthController } from '../customer-auth.controller.js';
import { WhatsAppOtpProvider } from '../whatsapp-otp.provider.js';
import { hmacOtp } from '../crypto.js';
import type { TokenService } from '../token.service.js';
import * as dbClient from '../../../db/client.js';
import * as configMod from '../../../config/config.js';

describe('Customer Sign-Up 1:1 Email/Mobile, Google Auth, Cookie Refresh & Evolution Dev OTP', () => {
  const orgId = '7762b6af-d052-4e74-b917-39e3c56e7914';
  const pepper = 'test_otp_pepper_min_32_characters_long_12345';
  let queryMock: ReturnType<typeof vi.fn>;
  let redisMock: Partial<Redis>;
  let tokenServiceMock: Partial<TokenService>;
  let messagingMock: { sendOtp: ReturnType<typeof vi.fn> };
  let service: CustomerOtpService;
  let controller: CustomerAuthController;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryMock = vi.fn();
    const mockClient = { query: queryMock } as unknown as PoolClient;

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_org: string, fn: (client: PoolClient) => Promise<T>) => fn(mockClient),
    );
    vi.spyOn(configMod, 'getConfig').mockReturnValue({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgresql://app:pass@localhost:5432/df',
      REDIS_URL: 'redis://localhost:6379',
      JWT_SECRET: 'test_jwt_secret_min_32_characters_long_123456',
      OTP_HMAC_PEPPER: pepper,
      QR_TOKEN_SECRET: 'test_qr_secret_min_32_characters_long_123456',
      WHATSAPP_PROVIDER: 'evolution_dev',
      EVOLUTION_API_URL: 'http://localhost:8085',
      EVOLUTION_API_KEY: 'test_key',
      EVOLUTION_INSTANCE_NAME: 'dineflow_otp',
    } as unknown as configMod.AppConfig);

    redisMock = {
      incr: vi.fn().mockResolvedValue(1),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(-1),
      set: vi.fn().mockResolvedValue('OK'),
    };
    messagingMock = { sendOtp: vi.fn().mockResolvedValue(undefined) };
    tokenServiceMock = {
      signAccessToken: vi.fn().mockReturnValue('cust.access.jwt'),
      signGooglePreRegToken: vi.fn().mockReturnValue('google.prereg.jwt'),
      verifyGooglePreRegToken: vi.fn().mockReturnValue({
        sub: 'google-sub-1',
        org: orgId,
        email: 'diner@example.com',
        name: 'Asha',
        purpose: 'google_prereg',
        type: 'google_prereg',
      }),
    };

    service = new CustomerOtpService(
      tokenServiceMock as TokenService,
      messagingMock as never,
      redisMock as Redis,
    );
    controller = new CustomerAuthController(service);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects SIGNUP OTP request when email is already linked to another mobile number (409)', async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ phone_e164: '+919999988888' }] });

    await expect(
      service.requestOtp(orgId, '9876543210', '1.2.3.4', {
        email: 'taken@example.com',
        mode: 'SIGNUP',
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(messagingMock.sendOtp).not.toHaveBeenCalled();
  });

  it('links mobile and Google email 1:1 on verifyOtp and sets HttpOnly refresh cookies', async () => {
    const code = '654321';
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'otp-1',
            code_hash: hmacOtp(code, pepper),
            attempts: 0,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
            verified_at: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ attempts: 1 }] })
      .mockResolvedValueOnce({ rows: [] }) // email owner check -> none
      .mockResolvedValueOnce({ rows: [] }) // phone existing email -> none
      .mockResolvedValueOnce({ rows: [{ id: 'otp-1' }] }) // mark verified
      .mockResolvedValueOnce({ rows: [{ id: 'cust-1', is_new: true }] }) // upsert customer
      .mockResolvedValueOnce({ rows: [] }) // insert refresh token
      .mockResolvedValueOnce({ rows: [{ display_name: 'Asha', email: 'diner@example.com' }] })
      .mockResolvedValueOnce({ rows: [{ balance: '0' }] });

    const replyHeaders: Record<string, unknown> = {};
    const reply = {
      header: (k: string, v: unknown) => {
        replyHeaders[k] = v;
      },
    } as unknown as FastifyReply;

    const res = await controller.verifyOtp(
      { phone: '9876543210', code, googlePreRegToken: 'google.prereg.jwt' } as never,
      orgId,
      reply,
    );

    expect(res.customerId).toBe('cust-1');
    expect(res.email).toBe('diner@example.com');
    expect(Array.isArray(replyHeaders['Set-Cookie'])).toBe(true);
    const cookies = replyHeaders['Set-Cookie'] as string[];
    expect(cookies.some((c) => c.startsWith('df_cust_rt=') && c.includes('HttpOnly'))).toBe(true);
    expect(cookies.some((c) => c.startsWith(`df_cust_org=${orgId}`))).toBe(true);
  });

  it('redirects unregistered Google login email to registration with googlePreRegToken', async () => {
    queryMock.mockResolvedValueOnce({ rows: [] });

    const res = await service.loginWithGoogle(orgId, {
      devMockEmail: 'newuser@gmail.com',
      devMockName: 'Ravi',
    });

    expect(res.registered).toBe(false);
    expect(res.email).toBe('newuser@gmail.com');
    expect(res.googlePreRegToken).toBe('google.prereg.jwt');
  });

  it('rotates persistent mobile session from HttpOnly cookies on /refresh', async () => {
    queryMock
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'rt-1',
            customer_id: 'cust-1',
            family_id: 'fam-1',
            is_revoked: false,
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'rt-1' }] }) // claim old token
      .mockResolvedValueOnce({
        rows: [{ phone_e164: '+919876543210', email: 'diner@example.com', display_name: 'Asha' }],
      })
      .mockResolvedValueOnce({ rows: [] }) // insert new token
      .mockResolvedValueOnce({ rows: [{ balance: '120' }] });

    const req = {
      headers: {
        cookie: `df_cust_rt=persisted_refresh_token_123456; df_cust_org=${orgId}`,
      },
    } as unknown as FastifyRequest;
    const replyHeaders: Record<string, unknown> = {};
    const reply = {
      header: (k: string, v: unknown) => {
        replyHeaders[k] = v;
      },
    } as unknown as FastifyReply;

    const res = await controller.refresh({} as never, '', req, reply);
    expect(res.accessToken).toBe('cust.access.jwt');
    expect(res.customerId).toBe('cust-1');
    expect(res.loyaltyPoints).toBe(120);
    expect((replyHeaders['Set-Cookie'] as string[]).some((c) => c.startsWith('df_cust_rt='))).toBe(true);
  });

  it('sends WhatsApp OTP to isolated dev Evolution container instance in development', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    const provider = new WhatsAppOtpProvider();
    await provider.sendOtp('+919876543210', '445566', orgId);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:8085/message/sendText/dineflow_otp');
    expect(JSON.parse(String(init.body))).toMatchObject({ number: '919876543210' });
    expect(String(JSON.parse(String(init.body)).text)).toContain('445566');
  });

  it('blocks OWNER, staff roles, and guest tokens from accessing customer diner-profiles (403)', async () => {
    for (const nonCustomerUser of [
      { sub: 'owner-1', org: orgId, role: 'OWNER', type: 'staff_access' },
      { sub: 'mgr-1', org: orgId, role: 'MANAGER', type: 'staff_access' },
      { sub: 'waiter-1', org: orgId, role: 'WAITER', type: 'staff_access' },
      { sub: 'sess-1', org: orgId, type: 'guest_session' },
    ]) {
      await expect(controller.listDinerProfiles(nonCustomerUser as never)).rejects.toMatchObject({
        status: 403,
        code: 'FORBIDDEN',
      });
      await expect(
        controller.createDinerProfile(nonCustomerUser as never, { name: 'Private' } as never),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      await expect(
        controller.updateDinerProfile(nonCustomerUser as never, 'dp-1', { name: 'Private' } as never),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      await expect(
        controller.deleteDinerProfileById(nonCustomerUser as never, 'dp-1'),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
      await expect(
        controller.deleteDinerProfile(nonCustomerUser as never, { id: 'dp-1' } as never),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    }
  });

  it('scopes diner_profiles DB session to customer_id via app.customer_id RLS context', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] }) // set_config('app.customer_id', ...)
      .mockResolvedValueOnce({ rows: [{ id: 'dp-1', name: 'Me', customer_id: 'cust-1' }] });

    const customerPrincipal = {
      sub: 'cust-1',
      org: orgId,
      phone: '+919876543210',
      type: 'customer_access' as const,
    };

    const rows = await controller.listDinerProfiles(customerPrincipal);
    expect(rows).toEqual([{ id: 'dp-1', name: 'Me', customer_id: 'cust-1' }]);
    expect(queryMock.mock.calls[0]?.[0]).toContain(`set_config('app.customer_id'`);
    expect(queryMock.mock.calls[0]?.[1]).toEqual(['cust-1']);
  });
});

