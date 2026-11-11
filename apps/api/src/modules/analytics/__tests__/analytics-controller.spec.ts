import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnalyticsController } from '../analytics.controller.js';
import { AnalyticsService } from '../analytics.service.js';
import { AnalyticsRollupService } from '../analytics-rollup.service.js';
import { DateRangeQuerySchema, CreateExportSchema } from '../analytics.dto.js';
import { ROLE_PERMISSIONS, Permission } from '@dineflow/contracts';
import type { StaffJwtPayload } from '../../../common/decorators/auth.decorators.js';

describe('AnalyticsController & RBAC Guard Validation', () => {
  let controller: AnalyticsController;
  let mockAnalyticsService: Partial<AnalyticsService>;
  let mockRollupService: Partial<AnalyticsRollupService>;

  const mockStaffUser: StaffJwtPayload = {
    sub: 'staff-user-uuid-1',
    org: 'org-uuid-1',
    role: 'OWNER',
    type: 'staff_access',
  };

  beforeEach(() => {
    mockAnalyticsService = {
      getOverview: vi.fn().mockResolvedValue({
        current: {
          orderCount: 15,
          grossSalesPaise: '150000',
          subtotalPaise: '135000',
          taxPaise: '15000',
          discountPaise: '0',
          refundPaise: '0',
          netSalesPaise: '150000',
          tipPaise: '0',
          averageOrderValuePaise: '10000',
        },
      }),
      getSales: vi.fn().mockResolvedValue({
        from: '2026-10-01',
        to: '2026-10-02',
        data: [],
      }),
      getItems: vi.fn().mockResolvedValue({
        topItems: [],
        bottomItems: [],
      }),
      getHeatmap: vi.fn().mockResolvedValue({
        heatmap: [],
      }),
      getPaymentMix: vi.fn().mockResolvedValue({
        paymentMix: [],
      }),
      getCustomers: vi.fn().mockResolvedValue({
        totalCustomers: 10,
        newCustomers: 7,
        returningCustomers: 3,
        repeatRatePercent: 30,
      }),
      createExport: vi.fn().mockResolvedValue({
        exportId: 'export-uuid-1',
        status: 'COMPLETED',
        format: 'CSV',
        rowCount: 10,
        fileSizeBytes: 250,
        content: 'date,orders\n2026-10-01,10',
      }),
      listExports: vi.fn().mockResolvedValue([]),
      getExport: vi.fn().mockResolvedValue({ id: 'export-uuid-1' }),
    };

    mockRollupService = {
      recomputeOutletDay: vi.fn().mockResolvedValue({
        date: '2026-10-01',
        orderCount: 5,
        grossSalesPaise: '50000',
        netSalesPaise: '50000',
      }),
    };

    controller = new AnalyticsController(
      mockAnalyticsService as AnalyticsService,
      mockRollupService as AnalyticsRollupService,
    );
  });

  describe('Endpoint Dispatching', () => {
    it('calls getOverview with org and validated query params', async () => {
      const query = { from: '2026-10-01', to: '2026-10-05', comparison: 'previous_period' as const };
      const res = await controller.getOverview(mockStaffUser, query);
      expect(mockAnalyticsService.getOverview).toHaveBeenCalledWith(mockStaffUser.org, query);
      expect(res.current.orderCount).toBe(15);
    });

    it('calls getSales with org and query', async () => {
      const query = { from: '2026-10-01', to: '2026-10-05', comparison: 'none' as const };
      await controller.getSales(mockStaffUser, query);
      expect(mockAnalyticsService.getSales).toHaveBeenCalledWith(mockStaffUser.org, query);
    });

    it('calls getItems with org and item query limit', async () => {
      const query = { from: '2026-10-01', to: '2026-10-05', limit: 20 };
      await controller.getItems(mockStaffUser, query);
      expect(mockAnalyticsService.getItems).toHaveBeenCalledWith(mockStaffUser.org, query);
    });

    it('calls getHeatmap for traffic distribution', async () => {
      const query = { from: '2026-10-01', to: '2026-10-05', comparison: 'none' as const };
      await controller.getHeatmap(mockStaffUser, query);
      expect(mockAnalyticsService.getHeatmap).toHaveBeenCalledWith(mockStaffUser.org, query);
    });

    it('calls getPaymentMix for gateway and cash breakdown', async () => {
      const query = { from: '2026-10-01', to: '2026-10-05', comparison: 'none' as const };
      await controller.getPaymentMix(mockStaffUser, query);
      expect(mockAnalyticsService.getPaymentMix).toHaveBeenCalledWith(mockStaffUser.org, query);
    });

    it('calls getCustomers for cohort analysis', async () => {
      const query = { from: '2026-10-01', to: '2026-10-05', comparison: 'none' as const };
      const res = await controller.getCustomers(mockStaffUser, query);
      expect(mockAnalyticsService.getCustomers).toHaveBeenCalledWith(mockStaffUser.org, query);
      expect(res.repeatRatePercent).toBe(30);
    });

    it('creates export and audits request', async () => {
      const dto = {
        exportType: 'SALES' as const,
        format: 'CSV' as const,
        dateFrom: '2026-10-01',
        dateTo: '2026-10-05',
      };
      const res = await controller.createExport(mockStaffUser, dto);
      expect(mockAnalyticsService.createExport).toHaveBeenCalledWith(
        mockStaffUser.org,
        mockStaffUser.sub,
        dto,
      );
      expect(res.exportId).toBe('export-uuid-1');
    });

    it('triggers rollup re-computation for outlet and date', async () => {
      const dto = { outletId: 'b947c6a9-839f-4f76-8dc2-4806a6b57111', date: '2026-10-01' };
      const res = await controller.triggerRollup(mockStaffUser, dto);
      expect(mockRollupService.recomputeOutletDay).toHaveBeenCalledWith(
        mockStaffUser.org,
        dto.outletId,
        dto.date,
      );
      expect(res.orderCount).toBe(5);
    });
  });

  describe('Zod Schema Validation', () => {
    it('accepts valid date range', () => {
      const parsed = DateRangeQuerySchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-15',
        comparison: 'previous_period',
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects inverted date range (from > to)', () => {
      const parsed = DateRangeQuerySchema.safeParse({
        from: '2026-10-20',
        to: '2026-10-10',
      });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.errors[0]?.message).toContain('from date must be before or equal to to date');
      }
    });

    it('rejects malformed date formats', () => {
      const parsed = DateRangeQuerySchema.safeParse({
        from: '2026/10/01',
        to: '2026-10-05',
      });
      expect(parsed.success).toBe(false);
    });

    it('enforces strict object schemas (rejects unexpected extra keys per AGENTS §2 rule 5)', () => {
      const parsed = DateRangeQuerySchema.safeParse({
        from: '2026-10-01',
        to: '2026-10-05',
        unexpectedInjectedField: 'hack',
      });
      expect(parsed.success).toBe(false);
    });

    it('validates export schema with allowed formats and types', () => {
      const valid = CreateExportSchema.safeParse({
        exportType: 'SALES',
        format: 'CSV',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-05',
      });
      expect(valid.success).toBe(true);

      const invalidType = CreateExportSchema.safeParse({
        exportType: 'UNKNOWN_TYPE',
        format: 'CSV',
        dateFrom: '2026-10-01',
        dateTo: '2026-10-05',
      });
      expect(invalidType.success).toBe(false);
    });
  });

  describe('RBAC Permission Rules (AGENTS §2 rule 4)', () => {
    it('OWNER and MANAGER have ANALYTICS_VIEW and ANALYTICS_EXPORT', () => {
      const ownerPerms = ROLE_PERMISSIONS['OWNER'] ?? [];
      const managerPerms = ROLE_PERMISSIONS['MANAGER'] ?? [];

      expect(ownerPerms).toContain(Permission.ANALYTICS_VIEW);
      expect(ownerPerms).toContain(Permission.ANALYTICS_EXPORT);

      expect(managerPerms).toContain(Permission.ANALYTICS_VIEW);
      expect(managerPerms).toContain(Permission.ANALYTICS_EXPORT);
    });

    it('CASHIER, KITCHEN, and WAITER cannot view analytics or trigger exports', () => {
      const cashierPerms = ROLE_PERMISSIONS['CASHIER'] ?? [];
      const kitchenPerms = ROLE_PERMISSIONS['KITCHEN'] ?? [];
      const waiterPerms = ROLE_PERMISSIONS['WAITER'] ?? [];

      expect(cashierPerms).not.toContain(Permission.ANALYTICS_VIEW);
      expect(cashierPerms).not.toContain(Permission.ANALYTICS_EXPORT);

      expect(kitchenPerms).not.toContain(Permission.ANALYTICS_VIEW);
      expect(kitchenPerms).not.toContain(Permission.ANALYTICS_EXPORT);

      expect(waiterPerms).not.toContain(Permission.ANALYTICS_VIEW);
      expect(waiterPerms).not.toContain(Permission.ANALYTICS_EXPORT);
    });
  });
});
