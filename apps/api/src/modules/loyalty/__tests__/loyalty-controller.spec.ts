import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLoyaltyController, CustomerLoyaltyController } from '../loyalty.controller.js';
import { LoyaltyService } from '../loyalty.service.js';
import { ROLE_PERMISSIONS, Permission } from '@dineflow/contracts';
import type { StaffJwtPayload } from '../../../common/decorators/auth.decorators.js';
import type { CustomerJwtPayload } from '../../auth/token.service.js';

describe('Loyalty Controllers & RBAC Guard Validation', () => {
  let consoleController: ConsoleLoyaltyController;
  let customerController: CustomerLoyaltyController;
  let mockLoyaltyService: Partial<LoyaltyService>;

  const mockStaffUser: StaffJwtPayload = {
    sub: 'staff-user-uuid-1',
    org: 'org-uuid-1',
    role: 'MANAGER',
    type: 'staff_access',
  };

  const mockCustomerUser: CustomerJwtPayload = {
    sub: 'customer-uuid-1',
    org: 'org-uuid-1',
    phone: '+919876543210',
    type: 'customer_access',
  };

  beforeEach(() => {
    mockLoyaltyService = {
      createCoupon: vi.fn().mockResolvedValue({ id: 'coupon-1', code: 'SAVE10' }),
      listCoupons: vi.fn().mockResolvedValue([]),
      getCoupon: vi.fn().mockResolvedValue({ id: 'coupon-1', code: 'SAVE10' }),
      updateCoupon: vi.fn().mockResolvedValue({ id: 'coupon-1', code: 'SAVE10' }),
      getSettings: vi.fn().mockResolvedValue({ is_loyalty_enabled: true }),
      updateSettings: vi.fn().mockResolvedValue({ is_loyalty_enabled: true }),
      validateCoupon: vi.fn().mockResolvedValue({ valid: true, discountPaise: 5000 }),
      getWallet: vi.fn().mockResolvedValue({ balancePaise: '10000', entries: [] }),
      claimReferral: vi.fn().mockResolvedValue({ status: 'PENDING' }),
    };

    consoleController = new ConsoleLoyaltyController(mockLoyaltyService as LoyaltyService);
    customerController = new CustomerLoyaltyController(mockLoyaltyService as LoyaltyService);
  });

  describe('Console Controller Dispatching', () => {
    it('dispatches createCoupon with org context', async () => {
      const dto = {
        code: 'SAVE10',
        type: 'PERCENT' as const,
        value: 1000,
        validFrom: '2026-01-01T00:00:00.000Z',
        validTo: '2026-12-31T23:59:59.000Z',
        minOrderPaise: 0,
        audience: 'ALL' as const,
        usageLimitPerCustomer: 1,
        stackable: false,
        outlets: [],
        isActive: true,
      };
      const res = await consoleController.createCoupon(mockStaffUser, dto);
      expect(mockLoyaltyService.createCoupon).toHaveBeenCalledWith(mockStaffUser.org, dto);
      expect(res.code).toBe('SAVE10');
    });

    it('dispatches listCoupons', async () => {
      await consoleController.listCoupons(mockStaffUser);
      expect(mockLoyaltyService.listCoupons).toHaveBeenCalledWith(mockStaffUser.org);
    });

    it('dispatches getSettings and updateSettings', async () => {
      await consoleController.getSettings(mockStaffUser);
      expect(mockLoyaltyService.getSettings).toHaveBeenCalledWith(mockStaffUser.org);

      await consoleController.updateSettings(mockStaffUser, { maxWalletRedemptionPercent: 30 });
      expect(mockLoyaltyService.updateSettings).toHaveBeenCalledWith(mockStaffUser.org, { maxWalletRedemptionPercent: 30 });
    });
  });

  describe('Customer Controller Dispatching', () => {
    it('dispatches public validateCoupon', async () => {
      const dto = {
        code: 'SAVE10',
        subtotalPaise: 50000,
        outletId: 'outlet-uuid-1',
      };
      const res = await customerController.validateCoupon(dto);
      expect(mockLoyaltyService.validateCoupon).toHaveBeenCalledWith(dto.outletId, dto);
      expect(res.valid).toBe(true);
    });

    it('dispatches getWallet for authenticated customer', async () => {
      const res = await customerController.getWallet(mockCustomerUser);
      expect(mockLoyaltyService.getWallet).toHaveBeenCalledWith(mockCustomerUser.org, mockCustomerUser.sub);
      expect(res.balancePaise).toBe('10000');
    });

    it('dispatches claimReferral for authenticated customer', async () => {
      const dto = { referralCode: 'ref-code-123' };
      const res = await customerController.claimReferral(mockCustomerUser, dto);
      expect(mockLoyaltyService.claimReferral).toHaveBeenCalledWith(mockCustomerUser.org, mockCustomerUser.sub, dto);
      expect(res.status).toBe('PENDING');
    });
  });

  describe('RBAC Permissions Verification', () => {
    it('OWNER and MANAGER roles possess COUPON_MANAGE and LOYALTY_MANAGE', () => {
      const ownerPerms = ROLE_PERMISSIONS['OWNER'] ?? [];
      const managerPerms = ROLE_PERMISSIONS['MANAGER'] ?? [];

      expect(ownerPerms).toContain(Permission.COUPON_MANAGE);
      expect(ownerPerms).toContain(Permission.LOYALTY_MANAGE);

      expect(managerPerms).toContain(Permission.COUPON_MANAGE);
      expect(managerPerms).toContain(Permission.LOYALTY_MANAGE);
    });

    it('CASHIER, KITCHEN, and WAITER cannot manage coupons or loyalty settings', () => {
      const cashierPerms = ROLE_PERMISSIONS['CASHIER'] ?? [];
      const kitchenPerms = ROLE_PERMISSIONS['KITCHEN'] ?? [];
      const waiterPerms = ROLE_PERMISSIONS['WAITER'] ?? [];

      expect(cashierPerms).not.toContain(Permission.COUPON_MANAGE);
      expect(cashierPerms).not.toContain(Permission.LOYALTY_MANAGE);

      expect(kitchenPerms).not.toContain(Permission.COUPON_MANAGE);
      expect(kitchenPerms).not.toContain(Permission.LOYALTY_MANAGE);

      expect(waiterPerms).not.toContain(Permission.COUPON_MANAGE);
      expect(waiterPerms).not.toContain(Permission.LOYALTY_MANAGE);
    });
  });
});
