import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { Permission, ROLE_PERMISSIONS } from '@dineflow/contracts';
import { RbacGuard } from '../guards/rbac.guard.js';
import { PUBLIC_KEY, PERMISSION_KEY } from '../decorators/auth.decorators.js';
import type {
  TokenService,
  GuestSessionJwtPayload,
  CustomerJwtPayload,
} from '../../modules/auth/token.service.js';
import { CustomerPaymentsController } from '../../modules/payments/payments.controller.js';
import { PaymentsService } from '../../modules/payments/payments.service.js';
import {
  ConsoleOrdersController,
  CustomerOrdersController,
} from '../../modules/orders/orders.controller.js';
import { OrdersService } from '../../modules/orders/orders.service.js';
import { CustomerAuthController } from '../../modules/auth/customer-auth.controller.js';
import { CustomerOtpService } from '../../modules/auth/customer-otp.service.js';
import { CustomerFeedbackController } from '../../modules/feedback/feedback.controller.js';
import { FeedbackService } from '../../modules/feedback/feedback.service.js';
import { SseController } from '../../modules/realtime/sse.controller.js';
import * as dbClient from '../../db/client.js';

function mockExecutionContext(
  handler: () => unknown,
  controllerClass: unknown,
  authHeader?: string,
): ExecutionContext {
  const req: { headers: Record<string, string | undefined>; user?: unknown } = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  return {
    getHandler: () => handler,
    getClass: () => controllerClass,
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe('P0 Security Lockdown Verification (Slice 1)', () => {
  const reflector = new Reflector();
  const orgId = '11111111-1111-4111-8111-111111111111';
  const otherOrgId = '22222222-2222-4222-8222-222222222222';
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const otherSessionId = '44444444-4444-4444-8444-444444444444';
  const orderId = '55555555-5555-4555-8555-555555555555';
  const customerId = '66666666-6666-4666-8666-666666666666';

  const originalEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  describe('RbacGuard & Token Scoping', () => {
    const guestPayload: GuestSessionJwtPayload = {
      sub: sessionId,
      org: orgId,
      outlet: '77777777-7777-4777-8777-777777777777',
      table: '88888888-8888-4888-8888-888888888888',
      sessionId,
      type: 'guest_session',
    };

    const customerPayload: CustomerJwtPayload = {
      sub: customerId,
      org: orgId,
      phone: '+919876543210',
      type: 'customer_access',
    };

    it('allows guest_session ONLY for Permission.GUEST_SESSION and denies customer/staff perms', () => {
      const tokenSvc = { verifyAccessToken: () => guestPayload } as unknown as TokenService;
      const guard = new RbacGuard(reflector, tokenSvc);

      const guestHandler = () => {};
      Reflect.defineMetadata(PERMISSION_KEY, Permission.GUEST_SESSION, guestHandler);
      expect(guard.canActivate(mockExecutionContext(guestHandler, Object, 'Bearer tok'))).toBe(true);

      const custHandler = () => {};
      Reflect.defineMetadata(PERMISSION_KEY, Permission.CUSTOMER_READ, custHandler);
      expect(() =>
        guard.canActivate(mockExecutionContext(custHandler, Object, 'Bearer tok')),
      ).toThrowError(expect.objectContaining({ status: 403 }));

      const staffHandler = () => {};
      Reflect.defineMetadata(PERMISSION_KEY, Permission.ORDER_UPDATE_STATUS, staffHandler);
      expect(() =>
        guard.canActivate(mockExecutionContext(staffHandler, Object, 'Bearer tok')),
      ).toThrowError(expect.objectContaining({ status: 403 }));
    });

    it('allows customer_access for CUSTOMER_* and GUEST_SESSION but denies staff perms', () => {
      const tokenSvc = { verifyAccessToken: () => customerPayload } as unknown as TokenService;
      const guard = new RbacGuard(reflector, tokenSvc);

      const readHandler = () => {};
      Reflect.defineMetadata(PERMISSION_KEY, Permission.CUSTOMER_READ, readHandler);
      expect(guard.canActivate(mockExecutionContext(readHandler, Object, 'Bearer tok'))).toBe(true);

      const payHandler = () => {};
      Reflect.defineMetadata(PERMISSION_KEY, Permission.GUEST_SESSION, payHandler);
      expect(guard.canActivate(mockExecutionContext(payHandler, Object, 'Bearer tok'))).toBe(true);

      const staffHandler = () => {};
      Reflect.defineMetadata(PERMISSION_KEY, Permission.PAYMENT_MARK_PAID, staffHandler);
      expect(() =>
        guard.canActivate(mockExecutionContext(staffHandler, Object, 'Bearer tok')),
      ).toThrowError(expect.objectContaining({ status: 403 }));
    });

    it('defines permissions for CAPTAIN role matching StaffRole enum', () => {
      expect(ROLE_PERMISSIONS['CAPTAIN']).toBeDefined();
      expect(ROLE_PERMISSIONS['CAPTAIN']).toContain(Permission.ORDER_READ);
      expect(ROLE_PERMISSIONS['CAPTAIN']).not.toContain(Permission.PAYMENT_REFUND);
    });
  });

  describe('Payments Lockdown (SEC-01)', () => {
    it('removes simulate-success endpoints and @Public decorators from CustomerPaymentsController', () => {
      const proto = CustomerPaymentsController.prototype as unknown as Record<string, unknown>;
      expect(proto['simulatePaymentSuccess']).toBeUndefined();
      expect(proto['simulatePaymentByOrder']).toBeUndefined();

      for (const method of ['createPayment', 'verifyPaymentByOrder', 'verifyPaymentStatus', 'getPayment']) {
        const handler = proto[method] as object;
        expect(reflector.get(PUBLIC_KEY, handler)).toBeUndefined();
        expect(reflector.get(PERMISSION_KEY, handler)).toBe(Permission.GUEST_SESSION);
      }
    });

    it('forbids simulatePaymentSuccess and simulatePaymentByOrder when NODE_ENV !== test', async () => {
      process.env['NODE_ENV'] = 'production';
      const service = new PaymentsService();
      await expect(service.simulatePaymentSuccess('pay-1')).rejects.toMatchObject({ status: 403 });
      await expect(service.simulatePaymentByOrder(orderId)).rejects.toMatchObject({ status: 403 });
    });

    it('records CUSTOMER CASH/PAY_AT_COUNTER request as PENDING without confirming order', async () => {
      const queryMock = vi.fn()
        .mockResolvedValueOnce({ rows: [] }) // idempotency check
        .mockResolvedValueOnce({
          rows: [{
            id: orderId,
            total_paise: 50000,
            status: 'PENDING',
            session_id: sessionId,
            customer_id: null,
            session_customer_id: null,
          }],
        }) // order load
        .mockResolvedValueOnce({ rows: [{ id: 'pay-pending-1' }] }) // insert payments
        .mockResolvedValueOnce({ rows: [] }); // insert order_events

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      const service = new PaymentsService();
      const res = await service.createPayment(
        orgId,
        { order_id: orderId, method: 'CASH', idempotency_key: 'idem-1' },
        sessionId,
        'CUSTOMER',
        { sessionId },
      );

      expect(res).toEqual({ id: 'pay-pending-1', status: 'PENDING', method: 'CASH' });
      const insertSql = queryMock.mock.calls[2]![0] as string;
      expect(insertSql).toContain("'PENDING'");
      expect(insertSql).not.toContain("'PAID'");
      const orderUpdateCall = queryMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0].includes('UPDATE orders'),
      );
      expect(orderUpdateCall).toBeUndefined();
    });

    it('blocks cross-session customer payment creation with 403 FORBIDDEN', async () => {
      const queryMock = vi.fn()
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{
            id: orderId,
            total_paise: 50000,
            status: 'PENDING',
            session_id: otherSessionId,
            customer_id: null,
            session_customer_id: null,
          }],
        });

      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      const service = new PaymentsService();
      await expect(
        service.createPayment(
          orgId,
          { order_id: orderId, method: 'CASH', idempotency_key: 'idem-2' },
          sessionId,
          'CUSTOMER',
          { sessionId },
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('Orders & KDS Lockdown (SEC-02)', () => {
    it('removes public KDS routes from ConsoleOrdersController and @Public from CustomerOrdersController', () => {
      const consoleProto = ConsoleOrdersController.prototype as unknown as Record<string, unknown>;
      expect(consoleProto['listKdsFeed']).toBeUndefined();
      expect(consoleProto['updateOrderStatusPublic']).toBeUndefined();
      expect(consoleProto['updateItemStatusPublic']).toBeUndefined();

      const customerProto = CustomerOrdersController.prototype as unknown as Record<string, unknown>;
      for (const method of ['placeOrder', 'getSessionOrders', 'getOrder']) {
        const handler = customerProto[method] as object;
        expect(reflector.get(PUBLIC_KEY, handler)).toBeUndefined();
        expect(reflector.get(PERMISSION_KEY, handler)).toBe(Permission.GUEST_SESSION);
      }
    });

    it('rejects empty orgId in listOrders and cross-session placeOrder with 401/403', async () => {
      const service = new OrdersService();
      await expect(service.listOrders('', { limit: 20, offset: 0 })).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        service.placeOrder(
          orgId,
          { session_id: otherSessionId, idempotency_key: 'ord-1', items: [] },
          sessionId,
          'CUSTOMER',
          { sessionId },
        ),
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('Customer Profile, Feedback & SSE Lockdown (SEC-05, SEC-06)', () => {
    it('protects customer profile and diner-profiles endpoints with CUSTOMER_READ / CUSTOMER_UPDATE', () => {
      const proto = CustomerAuthController.prototype as unknown as Record<string, unknown>;
      for (const method of ['getProfile', 'listDinerProfiles']) {
        expect(reflector.get(PUBLIC_KEY, proto[method] as object)).toBeUndefined();
        expect(reflector.get(PERMISSION_KEY, proto[method] as object)).toBe(Permission.CUSTOMER_READ);
      }
      for (const method of [
        'updateProfile',
        'createDinerProfile',
        'updateDinerProfile',
        'deleteDinerProfileById',
        'deleteDinerProfile',
      ]) {
        expect(reflector.get(PUBLIC_KEY, proto[method] as object)).toBeUndefined();
        expect(reflector.get(PERMISSION_KEY, proto[method] as object)).toBe(Permission.CUSTOMER_UPDATE);
      }
    });

    it('rejects missing orgId in CustomerOtpService.getProfile instead of defaulting to hardcoded org', async () => {
      const otpService = new CustomerOtpService(
        { sendOtp: vi.fn() } as never,
        { signAccessToken: vi.fn() } as never,
        {} as never,
      );
      await expect(otpService.getProfile('', customerId)).rejects.toMatchObject({ status: 401 });
    });

    it('protects submitFeedbackGuest with GUEST_SESSION and blocks cross-session feedback submission', async () => {
      const fbProto = CustomerFeedbackController.prototype as unknown as Record<string, unknown>;
      expect(reflector.get(PUBLIC_KEY, fbProto['submitFeedbackGuest'] as object)).toBeUndefined();
      expect(reflector.get(PERMISSION_KEY, fbProto['submitFeedbackGuest'] as object)).toBe(
        Permission.GUEST_SESSION,
      );

      const queryMock = vi.fn().mockResolvedValueOnce({
        rows: [{
          id: orderId,
          outlet_id: 'outlet-1',
          customer_id: null,
          session_id: otherSessionId,
          session_customer_id: null,
        }],
      });
      vi.spyOn(dbClient, 'withTenantContextRaw').mockImplementation(
        async <T>(_org: string, fn: (c: PoolClient) => Promise<T>) =>
          fn({ query: queryMock } as unknown as PoolClient),
      );

      const fbService = new FeedbackService();
      await expect(
        fbService.submitFeedback(
          orgId,
          null,
          { orderId, rating: 5, tags: [] },
          { scope: { sessionId } },
        ),
      ).rejects.toMatchObject({ status: 403 });
    });

    it('requires GBP_TOKEN_ENCRYPTION_KEY in production', async () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['GBP_TOKEN_ENCRYPTION_KEY'];
      const fbService = new FeedbackService();
      await expect(
        fbService.connectGbp(orgId, {
          outletId: 'outlet-1',
          googleAccountRef: 'acc-1',
          locationRef: 'loc-1',
          refreshToken: 'ref-1',
        }),
      ).rejects.toMatchObject({ status: 500 });
    });

    it('protects SseController with GUEST_SESSION and blocks cross-tenant orgId access', async () => {
      const sseProto = SseController.prototype as unknown as Record<string, unknown>;
      expect(reflector.get(PUBLIC_KEY, sseProto['orderEvents'] as object)).toBeUndefined();
      expect(reflector.get(PERMISSION_KEY, sseProto['orderEvents'] as object)).toBe(
        Permission.GUEST_SESSION,
      );

      const sseController = new SseController({} as never);
      const guestUser: GuestSessionJwtPayload = {
        sub: sessionId,
        org: orgId,
        outlet: 'outlet-1',
        table: 'table-1',
        sessionId,
        type: 'guest_session',
      };

      await expect(
        sseController.orderEvents(guestUser, otherOrgId, orderId, {} as never, {} as never),
      ).rejects.toMatchObject({ status: 403 });
    });
  });
});
