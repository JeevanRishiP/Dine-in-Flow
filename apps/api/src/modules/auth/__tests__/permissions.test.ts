import { describe, it, expect } from 'vitest';
import { ROLE_PERMISSIONS, Permission } from '@dineflow/contracts';

describe('RBAC permissions map', () => {
  const allPermissions = Object.values(Permission) as string[];

  it('OWNER has all permissions', () => {
    const ownerPerms = ROLE_PERMISSIONS['OWNER'] ?? [];
    for (const perm of allPermissions) {
      expect(ownerPerms).toContain(perm);
    }
  });

  it('MANAGER has a meaningful subset (not empty)', () => {
    expect((ROLE_PERMISSIONS['MANAGER'] ?? []).length).toBeGreaterThan(10);
  });

  it('KITCHEN cannot refund payments', () => {
    expect(ROLE_PERMISSIONS['KITCHEN']).not.toContain(Permission.PAYMENT_REFUND);
    expect(ROLE_PERMISSIONS['KITCHEN']).not.toContain(Permission.ORDER_REFUND);
  });

  it('WAITER cannot access reports', () => {
    expect(ROLE_PERMISSIONS['WAITER']).not.toContain(Permission.REPORT_READ);
  });

  it('CASHIER cannot manage staff', () => {
    expect(ROLE_PERMISSIONS['CASHIER']).not.toContain(Permission.STAFF_INVITE);
    expect(ROLE_PERMISSIONS['CASHIER']).not.toContain(Permission.STAFF_DEACTIVATE);
  });

  it('WAITER, KITCHEN, and CASHIER cannot manage feedback or reply to reviews', () => {
    const restrictedRoles = ['WAITER', 'KITCHEN', 'CASHIER'];
    for (const role of restrictedRoles) {
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.FEEDBACK_MANAGE);
      expect(ROLE_PERMISSIONS[role]).not.toContain(Permission.REVIEWS_REPLY);
    }
  });

  it('OWNER and MANAGER have FEEDBACK and REVIEWS permissions', () => {
    const feedbackPerms = [
      Permission.FEEDBACK_READ,
      Permission.FEEDBACK_MANAGE,
      Permission.REVIEWS_READ,
      Permission.REVIEWS_REPLY,
    ];
    for (const perm of feedbackPerms) {
      expect(ROLE_PERMISSIONS['OWNER']).toContain(perm);
      expect(ROLE_PERMISSIONS['MANAGER']).toContain(perm);
    }
  });

  it('OWNER and MANAGER have MESSAGING permissions', () => {
    const messagingPerms = [
      Permission.MESSAGING_READ,
      Permission.MESSAGING_SEND,
      Permission.MESSAGING_MANAGE,
    ];
    for (const perm of messagingPerms) {
      expect(ROLE_PERMISSIONS['OWNER']).toContain(perm);
      expect(ROLE_PERMISSIONS['MANAGER']).toContain(perm);
    }
    expect(ROLE_PERMISSIONS['WAITER']).not.toContain(Permission.MESSAGING_MANAGE);
    expect(ROLE_PERMISSIONS['KITCHEN']).not.toContain(Permission.MESSAGING_MANAGE);
    expect(ROLE_PERMISSIONS['CASHIER']).not.toContain(Permission.MESSAGING_MANAGE);
  });

  it('all roles are defined', () => {
    const expectedRoles = ['OWNER', 'MANAGER', 'CASHIER', 'KITCHEN', 'WAITER'];
    for (const role of expectedRoles) {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(ROLE_PERMISSIONS[role]!.length).toBeGreaterThan(0);
    }
  });

  it('no unknown permissions appear in any role', () => {
    const validSet = new Set(allPermissions);
    for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
      for (const perm of perms) {
        expect(validSet.has(perm), `Unknown permission '${perm}' found in role '${role}'`).toBe(true);
      }
    }
  });
});
