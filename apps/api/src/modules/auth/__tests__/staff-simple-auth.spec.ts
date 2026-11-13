import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import type { PoolClient } from 'pg';
import { Permission, ROLE_PERMISSIONS } from '@dineflow/contracts';
import { TokenService } from '../token.service.js';
import { StaffAuthService } from '../staff-auth.service.js';
import { StaffManagementService } from '../staff-management.service.js';
import { hashPassword } from '../crypto.js';
import * as dbClient from '../../../db/client.js';

vi.mock('../../../config/config.js', () => ({
  getConfig: () => ({
    JWT_SECRET: 'test-jwt-secret-at-least-32-chars-long!',
    OTP_HMAC_PEPPER: 'test-otp-pepper-at-least-32-chars-long!',
    QR_TOKEN_SECRET: 'test-qr-secret-at-least-32-chars-long!!',
    REDIS_URL: 'redis://localhost:6380',
    DATABASE_URL: 'postgresql://dineflow_app:pass@localhost:5433/dineflow',
    NODE_ENV: 'test',
  }),
}));

describe('Simple Staff Username Login & Owner-Only Credential Management', () => {
  const orgId = '11111111-1111-4111-8111-111111111111';
  const otherOrgId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const ownerId = '22222222-2222-4222-8222-222222222222';
  const staffId = '33333333-3333-4333-8333-333333333333';
  const outletId = '44444444-4444-4444-8444-444444444444';

  let tokenService: TokenService;

  beforeEach(() => {
    vi.restoreAllMocks();
    tokenService = new TokenService(new JwtService({}));
  });

  it('grants STAFF_INVITE, STAFF_UPDATE, STAFF_DEACTIVATE only to OWNER (not MANAGER)', () => {
    expect(ROLE_PERMISSIONS['OWNER']).toContain(Permission.STAFF_INVITE);
    expect(ROLE_PERMISSIONS['OWNER']).toContain(Permission.STAFF_UPDATE);
    expect(ROLE_PERMISSIONS['OWNER']).toContain(Permission.STAFF_DEACTIVATE);

    expect(ROLE_PERMISSIONS['MANAGER']).not.toContain(Permission.STAFF_INVITE);
    expect(ROLE_PERMISSIONS['MANAGER']).not.toContain(Permission.STAFF_UPDATE);
    expect(ROLE_PERMISSIONS['MANAGER']).not.toContain(Permission.STAFF_DEACTIVATE);
  });

  it('logs in staff with username + simple password without requiring orgSlug', async () => {
    const pwHash = await hashPassword('1234');
    const poolQuery = vi.fn().mockResolvedValueOnce({
      rows: [{ org_id: orgId, org_slug: 'royal-spice-bistro' }],
    });
    vi.spyOn(dbClient, 'getPool').mockReturnValue({ query: poolQuery } as never);

    const tenantQuery = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes('FROM staff_users')) {
        return {
          rows: [
            {
              id: staffId,
              username: 'kitchen',
              email: 'pilot.kitchen@royalspice.in',
              display_name: 'Chef Amit Roy',
              password_hash: pwHash,
              is_active: true,
              totp_secret_enc: null,
              totp_enrolled_at: null,
            },
          ],
        };
      }
      if (sql.includes('FROM staff_memberships')) {
        return { rows: [{ role: 'KITCHEN', outlet_id: outletId }] };
      }
      return { rows: [] };
    });

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
        fn({ query: tenantQuery } as unknown as PoolClient),
    );

    const svc = new StaffAuthService(tokenService);
    const res = await svc.loginWithOptionalOrg({
      identifier: 'Kitchen',
      password: '1234',
      clientIp: '127.0.0.1',
    });

    expect(res.requiresMfa).toBe(false);
    expect(res.username).toBe('kitchen');
    expect(res.displayName).toBe('Chef Amit Roy');
    expect(res.orgSlug).toBe('royal-spice-bistro');
    expect(res.accessToken.length).toBeGreaterThan(20);
  });

  it('disambiguates identical usernames across two orgs using the matching password', async () => {
    const hashOrgA = await hashPassword('passA1');
    const hashOrgB = await hashPassword('passB2');

    vi.spyOn(dbClient, 'getPool').mockReturnValue({
      query: vi.fn().mockResolvedValueOnce({
        rows: [
          { org_id: orgId, org_slug: 'hotel-a' },
          { org_id: otherOrgId, org_slug: 'hotel-b' },
        ],
      }),
    } as never);

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(targetOrg: string, fn: (c: PoolClient) => Promise<T>) => {
        const query = vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('FROM staff_users')) {
            return {
              rows: [
                {
                  id: staffId,
                  username: 'kitchen',
                  email: `kitchen@${targetOrg}.local`,
                  display_name: targetOrg === orgId ? 'Chef A' : 'Chef B',
                  password_hash: targetOrg === orgId ? hashOrgA : hashOrgB,
                  is_active: true,
                  totp_secret_enc: null,
                  totp_enrolled_at: null,
                },
              ],
            };
          }
          if (sql.includes('FROM staff_memberships')) {
            return { rows: [{ role: 'KITCHEN', outlet_id: outletId }] };
          }
          return { rows: [] };
        });
        return fn({ query } as unknown as PoolClient);
      },
    );

    const svc = new StaffAuthService(tokenService);
    const res = await svc.loginWithOptionalOrg({
      identifier: 'kitchen',
      password: 'passB2',
    });

    expect(res.orgId).toBe(otherOrgId);
    expect(res.orgSlug).toBe('hotel-b');
    expect(res.displayName).toBe('Chef B');
  });

  it('rejects non-OWNER roles from creating, updating, or deactivating staff credentials', async () => {
    const mgmt = new StaffManagementService();

    for (const nonOwnerRole of ['MANAGER', 'CAPTAIN', 'KITCHEN', 'CASHIER', 'WAITER']) {
      await expect(
        mgmt.createStaff(orgId, ownerId, nonOwnerRole, {
          name: 'Test Chef',
          username: 'chef1',
          password: 'pass123',
          role: 'KITCHEN',
        }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

      await expect(
        mgmt.updateStaff(orgId, ownerId, nonOwnerRole, staffId, { password: 'newpass' }),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });

      await expect(
        mgmt.deactivateStaff(orgId, ownerId, nonOwnerRole, staffId),
      ).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' });
    }
  });

  it('allows OWNER to create staff with Argon2id password and update role/username/password + revoke tokens', async () => {
    const mgmt = new StaffManagementService();
    const createdAt = new Date('2026-11-12T10:00:00Z');

    const queries: string[] = [];
    const paramsLog: unknown[][] = [];

    const queryMock = vi.fn().mockImplementation(async (sql: string, params: unknown[] = []) => {
      queries.push(sql);
      paramsLog.push(params);

      if (sql.includes('SELECT slug::text AS slug FROM organizations')) {
        return { rows: [{ slug: 'royal-spice-bistro' }] };
      }
      if (sql.includes('SELECT id FROM outlets')) {
        return { rows: [{ id: outletId }] };
      }
      if (sql.includes('INSERT INTO staff_users')) {
        return {
          rows: [
            {
              id: staffId,
              org_id: orgId,
              username: params[1],
              email: params[2],
              display_name: params[4],
              phone_e164: params[5],
              is_active: true,
              created_at: createdAt,
            },
          ],
        };
      }
      if (sql.includes('FROM staff_users su') && sql.includes('su.id = $2')) {
        return {
          rows: [
            {
              id: staffId,
              username: 'chef1',
              email: 'chef1@royal-spice-bistro.staff.local',
              display_name: 'Chef One',
              phone_e164: null,
              is_active: true,
              last_login_at: null,
              created_at: createdAt,
              role: 'KITCHEN',
              outlet_id: outletId,
            },
          ],
        };
      }
      if (sql.includes('UPDATE staff_users')) {
        return {
          rows: [
            {
              id: staffId,
              username: params[0],
              email: 'chef1@royal-spice-bistro.staff.local',
              display_name: params[1],
              phone_e164: params[2],
              is_active: params[3],
              last_login_at: null,
              created_at: createdAt,
            },
          ],
        };
      }
      if (sql.includes('UPDATE staff_memberships')) {
        return { rowCount: 1, rows: [] };
      }
      return { rows: [], rowCount: 1 };
    });

    vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
      async <T>(_o: string, fn: (c: PoolClient) => Promise<T>) =>
        fn({ query: queryMock } as unknown as PoolClient),
    );

    const created = await mgmt.createStaff(orgId, ownerId, 'OWNER', {
      name: 'Chef One',
      username: 'Chef1',
      password: '1234',
      role: 'KITCHEN',
      outletId,
    });

    expect(created.username).toBe('chef1');
    expect(created.role).toBe('KITCHEN');
    const insertIdx = queries.findIndex((q) => q.includes('INSERT INTO staff_users'));
    expect(String(paramsLog[insertIdx]?.[3])).toContain('$argon2id$');

    const updated = await mgmt.updateStaff(orgId, ownerId, 'OWNER', staffId, {
      username: 'captain_sam',
      role: 'CAPTAIN',
      password: 'new99',
    });

    expect(updated.username).toBe('captain_sam');
    expect(updated.role).toBe('CAPTAIN');
    expect(queries.some((q) => q.includes('UPDATE staff_refresh_tokens'))).toBe(true);
  });
});

