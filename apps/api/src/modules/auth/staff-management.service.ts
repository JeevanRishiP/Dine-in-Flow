import { Injectable } from '@nestjs/common';
import { withTenantContextRaw } from '../../db/client.js';
import { hashPassword } from './crypto.js';
import { ErrorCode } from '@dineflow/contracts';
import { domainError } from '../../common/errors/domain-error.js';

export type ManagedStaffRole =
  | 'OWNER'
  | 'MANAGER'
  | 'CAPTAIN'
  | 'KITCHEN'
  | 'CASHIER'
  | 'WAITER';

export interface StaffDirectoryItem {
  id: string;
  orgId: string;
  username: string;
  email: string;
  displayName: string;
  phone: string | null;
  role: ManagedStaffRole;
  outletId: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface StaffDirectoryResponse {
  orgId: string;
  orgSlug: string;
  orgName: string;
  outlets: Array<{
    id: string;
    name: string;
    address: string | null;
    isActive: boolean;
  }>;
  staff: StaffDirectoryItem[];
}

export interface CreateStaffInput {
  name: string;
  username: string;
  password: string;
  role: ManagedStaffRole;
  outletId?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface UpdateStaffInput {
  name?: string;
  username?: string;
  password?: string;
  role?: ManagedStaffRole;
  outletId?: string | null;
  phone?: string | null;
  isActive?: boolean;
}

function normalizeUsername(raw: string): string {
  const clean = raw.trim().toLowerCase();
  if (!/^[a-z0-9._@-]{2,64}$/.test(clean)) {
    throw domainError(
      ErrorCode.VALIDATION_ERROR,
      'Username must be 2–64 characters using letters, numbers, dots, underscores, hyphens, or @.',
      400,
    );
  }
  return clean;
}

function assertOwnerActor(actorRole: string): void {
  if (actorRole.toUpperCase() !== 'OWNER') {
    throw domainError(
      ErrorCode.FORBIDDEN,
      'Only the Restaurant Owner can assign or change staff roles, usernames, and passwords.',
      403,
    );
  }
}

/**
 * Owner-only staff directory and credential management.
 * All credentials are hashed with Argon2id server-side and scoped by org_id + forced RLS.
 *
 * NEEDS_HUMAN_REVIEW: owner-only staff credential & role provisioning
 * Reference: ARCH §12, AGENTS §3
 */
@Injectable()
export class StaffManagementService {
  async listDirectory(orgId: string): Promise<StaffDirectoryResponse> {
    return withTenantContextRaw(orgId, async (client) => {
      const orgRes = await client.query<{ id: string; slug: string; name: string }>(
        `SELECT id, slug::text AS slug, name FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId],
      );
      const org = orgRes.rows[0];
      if (!org) {
        throw domainError(ErrorCode.NOT_FOUND, 'Organization not found.', 404);
      }

      const outletsRes = await client.query<{
        id: string;
        name: string;
        address: string | null;
        is_active: boolean;
      }>(
        `SELECT id, name, address, is_active
         FROM outlets
         WHERE org_id = $1
         ORDER BY created_at ASC, name ASC`,
        [orgId],
      );

      const staffRes = await client.query<{
        id: string;
        org_id: string;
        username: string | null;
        email: string;
        display_name: string;
        phone_e164: string | null;
        is_active: boolean;
        last_login_at: Date | null;
        created_at: Date;
        role: string | null;
        outlet_id: string | null;
      }>(
        `SELECT su.id,
                su.org_id,
                su.username::text AS username,
                su.email::text AS email,
                su.display_name,
                su.phone_e164,
                su.is_active,
                su.last_login_at,
                su.created_at,
                sm.role,
                sm.outlet_id
         FROM staff_users su
         LEFT JOIN LATERAL (
           SELECT role, outlet_id
           FROM staff_memberships m
           WHERE m.org_id = su.org_id AND m.user_id = su.id
           ORDER BY m.is_active DESC, (m.outlet_id IS NULL) DESC, m.created_at ASC
           LIMIT 1
         ) sm ON true
         WHERE su.org_id = $1
         ORDER BY
           CASE COALESCE(sm.role, 'CAPTAIN')
             WHEN 'OWNER' THEN 1
             WHEN 'MANAGER' THEN 2
             WHEN 'CAPTAIN' THEN 3
             WHEN 'KITCHEN' THEN 4
             WHEN 'CASHIER' THEN 5
             ELSE 6
           END,
           su.created_at ASC`,
        [orgId],
      );

      return {
        orgId: org.id,
        orgSlug: org.slug,
        orgName: org.name,
        outlets: outletsRes.rows.map((o) => ({
          id: o.id,
          name: o.name,
          address: o.address,
          isActive: o.is_active,
        })),
        staff: staffRes.rows.map((row) => ({
          id: row.id,
          orgId: row.org_id,
          username: row.username || row.email.split('@')[0] || row.email,
          email: row.email,
          displayName: row.display_name,
          phone: row.phone_e164,
          role: ((row.role || 'CAPTAIN').toUpperCase() as ManagedStaffRole),
          outletId: row.outlet_id,
          isActive: row.is_active,
          lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
          createdAt: new Date(row.created_at).toISOString(),
        })),
      };
    });
  }

  async createStaff(
    orgId: string,
    actorId: string,
    actorRole: string,
    input: CreateStaffInput,
  ): Promise<StaffDirectoryItem> {
    assertOwnerActor(actorRole);

    const username = normalizeUsername(input.username);
    const displayName = input.name.trim();
    if (!displayName) {
      throw domainError(ErrorCode.VALIDATION_ERROR, 'Staff name is required.', 400);
    }

    const passwordHash = await hashPassword(input.password);
    const outletId = input.outletId ?? null;
    const phone = input.phone?.trim() || null;

    try {
      return await withTenantContextRaw(orgId, async (client) => {
        const orgRes = await client.query<{ slug: string }>(
          `SELECT slug::text AS slug FROM organizations WHERE id = $1 LIMIT 1`,
          [orgId],
        );
        const orgSlug = orgRes.rows[0]?.slug || 'restaurant';

        if (outletId) {
          const outletCheck = await client.query<{ id: string }>(
            `SELECT id FROM outlets WHERE id = $1 AND org_id = $2 LIMIT 1`,
            [outletId, orgId],
          );
          if (!outletCheck.rows[0]) {
            throw domainError(ErrorCode.NOT_FOUND, 'Selected hotel/outlet was not found in this organization.', 404);
          }
        }

        const internalEmail =
          input.email?.trim().toLowerCase() ||
          (username.includes('@') ? username : `${username}@${orgSlug}.staff.local`);

        const insertedUser = await client.query<{
          id: string;
          org_id: string;
          username: string;
          email: string;
          display_name: string;
          phone_e164: string | null;
          is_active: boolean;
          created_at: Date;
        }>(
          `INSERT INTO staff_users
             (org_id, username, email, password_hash, display_name, phone_e164, is_active, email_verified)
           VALUES ($1, $2, $3, $4, $5, $6, true, true)
           RETURNING id, org_id, username::text AS username, email::text AS email,
                     display_name, phone_e164, is_active, created_at`,
          [orgId, username, internalEmail, passwordHash, displayName, phone],
        );
        const created = insertedUser.rows[0]!;

        await client.query(
          `INSERT INTO staff_memberships (org_id, user_id, outlet_id, role, is_active)
           VALUES ($1, $2, $3, $4, true)`,
          [orgId, created.id, outletId, input.role],
        );

        await client.query(
          `INSERT INTO audit_logs (org_id, actor_id, actor_type, action, resource, resource_id, metadata)
           VALUES ($1, $2, 'staff', 'staff.created', 'staff_user', $3, $4::jsonb)`,
          [
            orgId,
            actorId,
            created.id,
            JSON.stringify({ role: input.role, outletId, username: created.username }),
          ],
        );

        return {
          id: created.id,
          orgId: created.org_id,
          username: created.username,
          email: created.email,
          displayName: created.display_name,
          phone: created.phone_e164,
          role: input.role,
          outletId,
          isActive: created.is_active,
          lastLoginAt: null,
          createdAt: new Date(created.created_at).toISOString(),
        };
      });
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw domainError(
          ErrorCode.CONFLICT,
          'That username or email is already assigned to another staff member.',
          409,
        );
      }
      throw err;
    }
  }

  async updateStaff(
    orgId: string,
    actorId: string,
    actorRole: string,
    targetStaffId: string,
    input: UpdateStaffInput,
  ): Promise<StaffDirectoryItem> {
    assertOwnerActor(actorRole);

    const cleanUsername = input.username !== undefined ? normalizeUsername(input.username) : undefined;
    const cleanName = input.name !== undefined ? input.name.trim() : undefined;
    if (cleanName !== undefined && !cleanName) {
      throw domainError(ErrorCode.VALIDATION_ERROR, 'Staff name cannot be empty.', 400);
    }
    const newPasswordHash =
      input.password !== undefined ? await hashPassword(input.password) : undefined;

    try {
      return await withTenantContextRaw(orgId, async (client) => {
        const existingRes = await client.query<{
          id: string;
          username: string | null;
          email: string;
          display_name: string;
          phone_e164: string | null;
          is_active: boolean;
          last_login_at: Date | null;
          created_at: Date;
          role: string | null;
          outlet_id: string | null;
        }>(
          `SELECT su.id,
                  su.username::text AS username,
                  su.email::text AS email,
                  su.display_name,
                  su.phone_e164,
                  su.is_active,
                  su.last_login_at,
                  su.created_at,
                  sm.role,
                  sm.outlet_id
           FROM staff_users su
           LEFT JOIN LATERAL (
             SELECT role, outlet_id
             FROM staff_memberships m
             WHERE m.org_id = su.org_id AND m.user_id = su.id
             ORDER BY m.is_active DESC, (m.outlet_id IS NULL) DESC, m.created_at ASC
             LIMIT 1
           ) sm ON true
           WHERE su.org_id = $1 AND su.id = $2
           LIMIT 1`,
          [orgId, targetStaffId],
        );

        const existing = existingRes.rows[0];
        if (!existing) {
          throw domainError(ErrorCode.NOT_FOUND, 'Staff member not found.', 404);
        }

        const currentRole = ((existing.role || 'CAPTAIN').toUpperCase() as ManagedStaffRole);
        const nextRole = input.role ?? currentRole;
        const nextActive = input.isActive ?? existing.is_active;

        // Prevent leaving the organization without an active OWNER
        if (currentRole === 'OWNER' && (nextRole !== 'OWNER' || !nextActive)) {
          const otherOwners = await client.query<{ cnt: number }>(
            `SELECT COUNT(*)::int AS cnt
             FROM staff_memberships sm
             JOIN staff_users su ON su.id = sm.user_id AND su.org_id = sm.org_id
             WHERE sm.org_id = $1
               AND sm.role = 'OWNER'
               AND sm.is_active = true
               AND su.is_active = true
               AND su.id <> $2`,
            [orgId, targetStaffId],
          );
          if ((otherOwners.rows[0]?.cnt ?? 0) === 0) {
            throw domainError(
              ErrorCode.CONFLICT,
              'Cannot remove or deactivate the only active Owner account.',
              409,
            );
          }
        }

        const nextOutletId = input.outletId === undefined ? existing.outlet_id : input.outletId;
        if (nextOutletId) {
          const outletCheck = await client.query<{ id: string }>(
            `SELECT id FROM outlets WHERE id = $1 AND org_id = $2 LIMIT 1`,
            [nextOutletId, orgId],
          );
          if (!outletCheck.rows[0]) {
            throw domainError(ErrorCode.NOT_FOUND, 'Selected hotel/outlet was not found.', 404);
          }
        }

        const nextUsername = cleanUsername ?? existing.username ?? existing.email.split('@')[0]!;
        const nextName = cleanName ?? existing.display_name;
        const nextPhone = input.phone === undefined ? existing.phone_e164 : (input.phone?.trim() || null);

        const updatedUser = await client.query<{
          id: string;
          username: string;
          email: string;
          display_name: string;
          phone_e164: string | null;
          is_active: boolean;
          last_login_at: Date | null;
          created_at: Date;
        }>(
          `UPDATE staff_users
           SET username = $1,
               display_name = $2,
               phone_e164 = $3,
               is_active = $4,
               password_hash = COALESCE($5, password_hash),
               updated_at = now()
           WHERE org_id = $6 AND id = $7
           RETURNING id, username::text AS username, email::text AS email,
                     display_name, phone_e164, is_active, last_login_at, created_at`,
          [nextUsername, nextName, nextPhone, nextActive, newPasswordHash ?? null, orgId, targetStaffId],
        );

        const updatedMembership = await client.query(
          `UPDATE staff_memberships
           SET role = $1, outlet_id = $2, is_active = $3, updated_at = now()
           WHERE org_id = $4 AND user_id = $5`,
          [nextRole, nextOutletId, nextActive, orgId, targetStaffId],
        );

        if ((updatedMembership.rowCount ?? 0) === 0) {
          await client.query(
            `INSERT INTO staff_memberships (org_id, user_id, outlet_id, role, is_active)
             VALUES ($1, $2, $3, $4, $5)`,
            [orgId, targetStaffId, nextOutletId, nextRole, nextActive],
          );
        }

        if (newPasswordHash || input.role !== undefined || input.outletId !== undefined || input.isActive === false) {
          await client.query(
            `UPDATE staff_refresh_tokens
             SET is_revoked = true
             WHERE org_id = $1 AND user_id = $2 AND is_revoked = false`,
            [orgId, targetStaffId],
          );
        }

        await client.query(
          `INSERT INTO audit_logs (org_id, actor_id, actor_type, action, resource, resource_id, metadata)
           VALUES ($1, $2, 'staff', 'staff.updated', 'staff_user', $3, $4::jsonb)`,
          [
            orgId,
            actorId,
            targetStaffId,
            JSON.stringify({
              role: nextRole,
              outletId: nextOutletId,
              isActive: nextActive,
              passwordChanged: Boolean(newPasswordHash),
            }),
          ],
        );

        const row = updatedUser.rows[0]!;
        return {
          id: row.id,
          orgId,
          username: row.username,
          email: row.email,
          displayName: row.display_name,
          phone: row.phone_e164,
          role: nextRole,
          outletId: nextOutletId,
          isActive: row.is_active,
          lastLoginAt: row.last_login_at ? new Date(row.last_login_at).toISOString() : null,
          createdAt: new Date(row.created_at).toISOString(),
        };
      });
    } catch (err) {
      if ((err as { code?: string })?.code === '23505') {
        throw domainError(
          ErrorCode.CONFLICT,
          'That username is already assigned to another staff member.',
          409,
        );
      }
      throw err;
    }
  }

  async deactivateStaff(
    orgId: string,
    actorId: string,
    actorRole: string,
    targetStaffId: string,
  ): Promise<{ deactivated: true; id: string }> {
    assertOwnerActor(actorRole);
    if (actorId === targetStaffId) {
      throw domainError(ErrorCode.CONFLICT, 'You cannot deactivate your own Owner account.', 409);
    }

    return withTenantContextRaw(orgId, async (client) => {
      const res = await client.query<{ id: string }>(
        `UPDATE staff_users
         SET is_active = false, updated_at = now()
         WHERE org_id = $1 AND id = $2
         RETURNING id`,
        [orgId, targetStaffId],
      );
      if (!res.rows[0]) {
        throw domainError(ErrorCode.NOT_FOUND, 'Staff member not found.', 404);
      }

      await client.query(
        `UPDATE staff_memberships SET is_active = false, updated_at = now()
         WHERE org_id = $1 AND user_id = $2`,
        [orgId, targetStaffId],
      );
      await client.query(
        `UPDATE staff_refresh_tokens SET is_revoked = true
         WHERE org_id = $1 AND user_id = $2 AND is_revoked = false`,
        [orgId, targetStaffId],
      );
      await client.query(
        `INSERT INTO audit_logs (org_id, actor_id, actor_type, action, resource, resource_id, metadata)
         VALUES ($1, $2, 'staff', 'staff.deactivated', 'staff_user', $3, '{}'::jsonb)`,
        [orgId, actorId, targetStaffId],
      );
      return { deactivated: true, id: targetStaffId };
    });
  }
}
