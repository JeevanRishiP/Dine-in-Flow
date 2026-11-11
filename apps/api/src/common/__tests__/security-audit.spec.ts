import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Reflector } from '@nestjs/core';
import { PUBLIC_KEY, PERMISSION_KEY } from '../decorators/auth.decorators.js';
import { Permission } from '@dineflow/contracts';

// Controllers
import { HealthController } from '../health/health.controller.js';
import { CustomerAuthController } from '../../modules/auth/customer-auth.controller.js';
import { StaffAuthController } from '../../modules/auth/staff-auth.controller.js';
import { PublicMenuController } from '../../modules/menu/public-menu.controller.js';
import { ConsoleMenuController } from '../../modules/menu/console-menu.controller.js';
import { ConsoleTablesController, PublicSessionsController } from '../../modules/tables/tables.controller.js';
import { ConsoleOrdersController, CustomerOrdersController } from '../../modules/orders/orders.controller.js';
import {
  ConsolePaymentsController,
  CustomerPaymentsController,
  PublicWebhookController,
} from '../../modules/payments/payments.controller.js';
import { SseController } from '../../modules/realtime/sse.controller.js';
import { AnalyticsController } from '../../modules/analytics/analytics.controller.js';
import { ConsoleLoyaltyController, CustomerLoyaltyController } from '../../modules/loyalty/loyalty.controller.js';
import { CustomerFeedbackController, ConsoleFeedbackController } from '../../modules/feedback/feedback.controller.js';
import { ConsoleMessagingController, CustomerConsentController, WhatsAppWebhookController } from '../../modules/messaging/messaging.controller.js';
import { CustomerAiController, ConsoleAiController } from '../../modules/ai/ai.controller.js';
import { CustomerPrivacyController, ConsolePrivacyController } from '../../modules/privacy/privacy.controller.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

describe('Full Security & Authz Matrix Audit (Phase 11 — ARCH §22, §26, AGENTS §2)', () => {
  const reflector = new Reflector();

  const ALL_CONTROLLERS = [
    HealthController,
    CustomerAuthController,
    StaffAuthController,
    PublicMenuController,
    ConsoleMenuController,
    ConsoleTablesController,
    PublicSessionsController,
    ConsoleOrdersController,
    CustomerOrdersController,
    ConsolePaymentsController,
    CustomerPaymentsController,
    PublicWebhookController,
    SseController,
    AnalyticsController,
    ConsoleLoyaltyController,
    CustomerLoyaltyController,
    CustomerFeedbackController,
    ConsoleFeedbackController,
    ConsoleMessagingController,
    CustomerConsentController,
    WhatsAppWebhookController,
    CustomerAiController,
    ConsoleAiController,
    CustomerPrivacyController,
    ConsolePrivacyController,
  ];

  describe('1. Full Route-Permission Matrix (Default-Deny Rule: AGENTS §2 rule 4)', () => {
    it('verifies that EVERY route handler on EVERY controller has explicit @Require() or @Public()', () => {
      let routeCount = 0;
      const unclassifiedRoutes: string[] = [];

      for (const ControllerClass of ALL_CONTROLLERS) {
        const controllerName = ControllerClass.name;
        const proto = ControllerClass.prototype;
        const methodNames = Object.getOwnPropertyNames(proto).filter(
          (m) => m !== 'constructor' && typeof proto[m] === 'function',
        );

        for (const method of methodNames) {
          const handler = proto[method];
          const isPublic = reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [handler, ControllerClass]);
          const requiredPermission = reflector.getAllAndOverride<Permission | undefined>(
            PERMISSION_KEY,
            [handler, ControllerClass],
          );

          routeCount++;

          if (!isPublic && !requiredPermission) {
            unclassifiedRoutes.push(`${controllerName}.${method}`);
          }
        }
      }

      expect(
        unclassifiedRoutes,
        `Found routes lacking explicit authorization or @Public() decoration:\n${unclassifiedRoutes.join('\n')}`,
      ).toEqual([]);
      expect(routeCount).toBeGreaterThan(30);
    });
  });

  describe('2. Forced Row-Level Security (RLS) Static Analysis (AGENTS §2 rule 3)', () => {
    it('verifies that EVERY table with an org_id column has forced RLS and tenant_isolation policy', () => {
      const migrationFiles = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      const tablesWithOrgId: string[] = [];
      const tablesWithForcedRls: Set<string> = new Set();
      const tablesWithTenantIsolation: Set<string> = new Set();

      for (const file of migrationFiles) {
        const content = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

        // Match table creations
        const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
        let match: RegExpExecArray | null;

        while ((match = createTableRegex.exec(content)) !== null) {
          const tableName = match[1]!;
          const tableBody = match[2]!;

          if (tableBody.includes('org_id') && tableName !== '_rls_test_items') {
            tablesWithOrgId.push(tableName);
          }
        }

        // Match FORCE ROW LEVEL SECURITY
        const forceRlsRegex = /ALTER\s+TABLE\s+([a-zA-Z0-9_]+)\s+FORCE\s+ROW\s+LEVEL\s+SECURITY/gi;
        while ((match = forceRlsRegex.exec(content)) !== null) {
          tablesWithForcedRls.add(match[1]!);
        }

        // Match tenant_isolation policy
        const policyRegex = /CREATE\s+POLICY\s+tenant_isolation\s+ON\s+([a-zA-Z0-9_]+)/gi;
        while ((match = policyRegex.exec(content)) !== null) {
          tablesWithTenantIsolation.add(match[1]!);
        }
      }

      // Verify every table with org_id has forced RLS
      const missingForcedRls = tablesWithOrgId.filter((t) => !tablesWithForcedRls.has(t));
      const missingPolicy = tablesWithOrgId.filter((t) => !tablesWithTenantIsolation.has(t));

      expect(
        missingForcedRls,
        `Tenant tables missing FORCE ROW LEVEL SECURITY: ${missingForcedRls.join(', ')}`,
      ).toEqual([]);

      expect(
        missingPolicy,
        `Tenant tables missing tenant_isolation policy: ${missingPolicy.join(', ')}`,
      ).toEqual([]);

      expect(tablesWithOrgId.length).toBeGreaterThan(20);
    });
  });

  describe('3. Append-Only Table Grant Restrictions (AGENTS §2 rule 6)', () => {
    it('verifies that append-only tables (consents, audit_logs, loyalty_ledger, order_events) do not grant UPDATE or DELETE to app role', () => {
      const appendOnlyTables = ['consents', 'audit_logs', 'loyalty_ledger', 'order_events'];
      const migrationFiles = fs
        .readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

      const combinedSql = migrationFiles
        .map((f) => fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'))
        .join('\n');

      for (const table of appendOnlyTables) {
        // Find grants to dineflow_app for this table
        const grantRegex = new RegExp(`GRANT\\s+([A-Z,\\s]+)\\s+ON\\s+${table}\\s+TO\\s+dineflow_app`, 'gi');
        let grantMatch: RegExpExecArray | null;

        while ((grantMatch = grantRegex.exec(combinedSql)) !== null) {
          const grantedPrivileges = grantMatch[1]!.toUpperCase();
          expect(grantedPrivileges).not.toContain('UPDATE');
          expect(grantedPrivileges).not.toContain('DELETE');
        }
      }
    });
  });
});
