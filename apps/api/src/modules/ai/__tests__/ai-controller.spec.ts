import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CustomerAiController, ConsoleAiController } from '../ai.controller.js';
import type { AiService } from '../ai.service.js';
import type { StaffJwtPayload } from '../../../common/decorators/auth.decorators.js';
import type { CustomerJwtPayload } from '../../auth/token.service.js';

describe('AI Controllers Dispatching & RBAC (Phase 10)', () => {
  let mockAiService: Partial<AiService>;
  let customerController: CustomerAiController;
  let consoleController: ConsoleAiController;

  const orgId = '00000000-0000-0000-0000-000000000001';
  const outletId = '00000000-0000-0000-0000-000000000002';
  const customerId = '00000000-0000-0000-0000-000000000003';
  const staffUserId = '00000000-0000-0000-0000-000000000004';

  beforeEach(() => {
    mockAiService = {
      chat: vi.fn().mockResolvedValue({
        sessionId: 'session-123',
        answer: 'Here are our recommendations.',
        tokensUsed: 45,
      }),
      reindexOutletMenu: vi.fn().mockResolvedValue({ itemsIndexed: 15 }),
    };

    customerController = new CustomerAiController(mockAiService as AiService);
    consoleController = new ConsoleAiController(mockAiService as AiService);
  });

  describe('CustomerAiController', () => {
    it('dispatches chatPublic for guest diner with null customerId', async () => {
      const body = {
        orgId,
        outletId,
        message: 'What is your specialty?',
      };

      const result = await customerController.chatPublic(body);

      expect(mockAiService.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId,
          outletId,
          message: 'What is your specialty?',
        }),
        null,
      );
      expect(result.sessionId).toBe('session-123');
    });

    it('dispatches chatAuth for authenticated diner with their customer sub', async () => {
      const user: CustomerJwtPayload = {
        sub: customerId,
        org: orgId,
        phone: '+919876543210',
      };

      const body = {
        orgId,
        outletId,
        message: 'Any vegan desserts?',
      };

      const result = await customerController.chatAuth(user, body);

      expect(mockAiService.chat).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId,
          outletId,
          message: 'Any vegan desserts?',
        }),
        customerId,
      );
      expect(result.sessionId).toBe('session-123');
    });
  });

  describe('ConsoleAiController', () => {
    it('dispatches reindexOutletMenu with authenticated staff org and outletId', async () => {
      const user: StaffJwtPayload = {
        sub: staffUserId,
        org: orgId,
        role: 'MANAGER',
        outletId,
      };

      const body = { outletId };

      const result = await consoleController.reindexOutletMenu(user, body);

      expect(mockAiService.reindexOutletMenu).toHaveBeenCalledWith(orgId, outletId);
      expect(result.itemsIndexed).toBe(15);
    });
  });
});
