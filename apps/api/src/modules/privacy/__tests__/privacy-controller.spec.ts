import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CustomerPrivacyController,
  ConsolePrivacyController,
} from '../privacy.controller.js';
import type { PrivacyService } from '../privacy.service.js';
import type { CustomerJwtPayload } from '../../auth/token.service.js';
import type { StaffJwtPayload } from '../../../common/decorators/auth.decorators.js';

describe('Privacy Controllers Dispatching & RBAC (Phase 11)', () => {
  let mockPrivacyService: Partial<PrivacyService>;
  let customerController: CustomerPrivacyController;
  let consoleController: ConsolePrivacyController;

  const orgId = '00000000-0000-0000-0000-000000000001';
  const customerId = '00000000-0000-0000-0000-000000000002';
  const staffUserId = '00000000-0000-0000-0000-000000000003';

  beforeEach(() => {
    mockPrivacyService = {
      exportCustomerData: vi.fn().mockResolvedValue({
        exportedAt: '2026-10-26T12:00:00Z',
        orgId,
        dataSubject: { id: customerId },
      }),
      anonymizeCustomer: vi.fn().mockResolvedValue({
        success: true,
        customerId,
        anonymizedAt: '2026-10-26T12:00:00Z',
      }),
      runRetentionPurge: vi.fn().mockResolvedValue({
        expiredOtpsPurged: 5,
        staleTranscriptsPurged: 3,
        staleWebhooksPurged: 10,
      }),
    };

    customerController = new CustomerPrivacyController(mockPrivacyService as PrivacyService);
    consoleController = new ConsolePrivacyController(mockPrivacyService as PrivacyService);
  });

  describe('CustomerPrivacyController', () => {
    it('dispatches exportMyData with authenticated customer identity', async () => {
      const user: CustomerJwtPayload = {
        sub: customerId,
        org: orgId,
        phone: '+919876543210',
      };

      const result = await customerController.exportMyData(user);

      expect(mockPrivacyService.exportCustomerData).toHaveBeenCalledWith(orgId, customerId, 'CUSTOMER');
      expect(result.orgId).toBe(orgId);
    });

    it('dispatches deleteMyData for customer self-service erasure', async () => {
      const user: CustomerJwtPayload = {
        sub: customerId,
        org: orgId,
        phone: '+919876543210',
      };

      const body = { reason: 'No longer dining here' };
      const result = await customerController.deleteMyData(user, body);

      expect(mockPrivacyService.anonymizeCustomer).toHaveBeenCalledWith(
        orgId,
        customerId,
        'CUSTOMER',
        'No longer dining here',
      );
      expect(result.success).toBe(true);
    });
  });

  describe('ConsolePrivacyController', () => {
    it('dispatches exportCustomerData for staff compliance officer with target customerId', async () => {
      const user: StaffJwtPayload = {
        sub: staffUserId,
        org: orgId,
        role: 'MANAGER',
      };

      const body = { customerId };
      const result = await consoleController.exportCustomerData(user, body);

      expect(mockPrivacyService.exportCustomerData).toHaveBeenCalledWith(orgId, customerId, 'STAFF');
      expect(result.orgId).toBe(orgId);
    });

    it('dispatches anonymizeCustomer for staff compliance officer', async () => {
      const user: StaffJwtPayload = {
        sub: staffUserId,
        org: orgId,
        role: 'OWNER',
      };

      const body = { customerId, reason: 'Written DSAR request received' };
      const result = await consoleController.anonymizeCustomer(user, body);

      expect(mockPrivacyService.anonymizeCustomer).toHaveBeenCalledWith(
        orgId,
        customerId,
        'STAFF',
        'Written DSAR request received',
      );
      expect(result.success).toBe(true);
    });

    it('dispatches runRetentionPurge for staff manager', async () => {
      const user: StaffJwtPayload = {
        sub: staffUserId,
        org: orgId,
        role: 'MANAGER',
      };

      const result = await consoleController.runRetentionPurge(user);

      expect(mockPrivacyService.runRetentionPurge).toHaveBeenCalledWith(orgId);
      expect(result.expiredOtpsPurged).toBe(5);
    });
  });
});
