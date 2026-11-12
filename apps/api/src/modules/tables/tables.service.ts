import { Injectable, Optional } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTenantContextRaw, getPool } from '../../db/client.js';
import { getConfig } from '../../config/config.js';
import { domainError } from '../../common/errors/domain-error.js';
import { assertStaffOutletAccess } from '../../common/utils/outlet-scope.utils.js';
import { ErrorCode } from '@dineflow/contracts';
import { TokenService } from '../auth/token.service.js';
import type { CreateTableSchema, UpdateTableSchema, OpenSessionSchema } from './tables.dto.js';
import type { z } from 'zod';

type CreateTableInput = z.infer<typeof CreateTableSchema>;
type UpdateTableInput = z.infer<typeof UpdateTableSchema>;
type OpenSessionInput = z.infer<typeof OpenSessionSchema>;

/**
 * Tables Service — manages physical restaurant tables and dine-in sessions.
 *
 * QR token design:
 *   token = HMAC-SHA256(QR_TOKEN_SECRET, `${table_id}:${qr_token_version}`)
 *   → Bumping qr_token_version invalidates all existing tokens instantly.
 *   → Tokens are stateless; no DB lookup needed to verify structure.
 *
 * NEEDS_HUMAN_REVIEW: QR token validation (timing-safe compare), session open idempotency
 * Reference: ARCH §5, AGENTS §2 rule 8
 */
@Injectable()
export class TablesService {
  private readonly qrSecret: Buffer;
  private readonly appBaseUrl: string;

  constructor(@Optional() private readonly tokenService?: TokenService) {
    const cfg = getConfig();
    this.qrSecret = Buffer.from(cfg.QR_TOKEN_SECRET, 'utf8');
    this.appBaseUrl = process.env['APP_BASE_URL'] ?? 'http://localhost:3003';
  }

  // ─── CRUD ────────────────────────────────────────────────────────────────────

  async listTables(orgId: string, outletId?: string) {
    return withTenantContextRaw(orgId, async (db) => {
      const params: unknown[] = [orgId];
      let query = `
        SELECT id, org_id, outlet_id, table_number, capacity, section,
               qr_token_version, is_active, created_at, updated_at
        FROM tables
        WHERE org_id = $1 AND is_active = true
      `;
      if (outletId) {
        params.push(outletId);
        query += ` AND outlet_id = $${params.length}`;
      }
      query += ' ORDER BY outlet_id, table_number';
      const { rows } = await db.query(query, params);
      return rows;
    });
  }

  async getTable(orgId: string, tableId: string, staffOutletId?: string) {
    return withTenantContextRaw(orgId, async (db) => {
      return this.getTableInTx(orgId, tableId, db, staffOutletId);
    });
  }

  private async getTableInTx(
    orgId: string,
    tableId: string,
    db: PoolClient,
    staffOutletId?: string,
  ): Promise<Record<string, unknown>> {
    const { rows } = await db.query(
      `SELECT id, org_id, outlet_id, table_number, capacity, section,
              qr_token_version, is_active, created_at, updated_at
       FROM tables WHERE id = $1 AND org_id = $2`,
      [tableId, orgId],
    );
    if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Table not found.', 404);
    assertStaffOutletAccess(staffOutletId, rows[0]['outlet_id'] as string | undefined);
    return rows[0] as Record<string, unknown>;
  }

  async createTable(orgId: string, dto: CreateTableInput) {
    return withTenantContextRaw(orgId, async (db) => {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO tables (org_id, outlet_id, table_number, capacity, section)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [orgId, dto.outlet_id, dto.table_number, dto.capacity, dto.section ?? null],
      );
      return this.getTableInTx(orgId, rows[0]!.id, db);
    });
  }

  async updateTable(orgId: string, tableId: string, dto: UpdateTableInput, staffOutletId?: string) {
    return withTenantContextRaw(orgId, async (db) => {
      await this.getTableInTx(orgId, tableId, db, staffOutletId);
      const setClauses: string[] = [];
      const params: unknown[] = [orgId, tableId];
      if (dto.table_number !== undefined) { params.push(dto.table_number); setClauses.push(`table_number = $${params.length}`); }
      if (dto.capacity !== undefined)     { params.push(dto.capacity);     setClauses.push(`capacity = $${params.length}`); }
      if (dto.section !== undefined)      { params.push(dto.section);      setClauses.push(`section = $${params.length}`); }
      if (setClauses.length === 0) return this.getTableInTx(orgId, tableId, db, staffOutletId);

      setClauses.push(`updated_at = now()`);
      const { rowCount } = await db.query(
        `UPDATE tables SET ${setClauses.join(', ')} WHERE org_id = $1 AND id = $2`,
        params,
      );
      if (!rowCount) throw domainError(ErrorCode.NOT_FOUND, 'Table not found.', 404);
      return this.getTableInTx(orgId, tableId, db, staffOutletId);
    });
  }

  async deleteTable(orgId: string, tableId: string, staffOutletId?: string) {
    return withTenantContextRaw(orgId, async (db) => {
      await this.getTableInTx(orgId, tableId, db, staffOutletId);
      const { rowCount } = await db.query(
        `UPDATE tables SET is_active = false, updated_at = now()
         WHERE org_id = $1 AND id = $2`,
        [orgId, tableId],
      );
      if (!rowCount) throw domainError(ErrorCode.NOT_FOUND, 'Table not found.', 404);
    });
  }

  // ─── QR Tokens ───────────────────────────────────────────────────────────────

  generateQrToken(tableId: string, version: number): string {
    return crypto
      .createHmac('sha256', this.qrSecret)
      .update(`${tableId}:${version}`)
      .digest('hex');
  }

  async getTableQr(orgId: string, tableId: string, staffOutletId?: string) {
    const table = await this.getTable(orgId, tableId, staffOutletId);
    const version = table['qr_token_version'] as number;
    const token = this.generateQrToken(tableId, version);
    return {
      table_id: tableId,
      token,
      version,
      scan_url: `${this.appBaseUrl}/scan?t=${tableId}&v=${version}&sig=${token}`,
    };
  }

  async rotateQrToken(orgId: string, tableId: string, staffOutletId?: string) {
    return withTenantContextRaw(orgId, async (db) => {
      await this.getTableInTx(orgId, tableId, db, staffOutletId);
      const { rows } = await db.query<{ qr_token_version: number }>(
        `UPDATE tables
         SET qr_token_version = qr_token_version + 1, updated_at = now()
         WHERE org_id = $1 AND id = $2
         RETURNING qr_token_version`,
        [orgId, tableId],
      );
      if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Table not found.', 404);
      const version = rows[0]!.qr_token_version;
      return { table_id: tableId, version, token: this.generateQrToken(tableId, version) };
    });
  }

  // ─── Sessions ────────────────────────────────────────────────────────────────

  /**
   * Open a dine-in session after customer scans QR.
   * QR token format: base64url(table_id:version:hmac_hex)
   *
   * NEEDS_HUMAN_REVIEW: timing-safe compare, cross-version token rejection
   */
  async openSession(dto: OpenSessionInput) {
    const pool = getPool();
    let tableId: string | null = null;
    let version: number | null = null;
    let sig: string | null = null;

    // Check if qr_token is a base64url composite token: table_id:version:hmac_hex
    try {
      const decoded = Buffer.from(dto.qr_token, 'base64url').toString('utf8');
      const parts = decoded.split(':');
      if (parts.length === 3) {
        tableId = parts[0]!;
        version = parseInt(parts[1]!, 10);
        sig = parts[2]!;
      }
    } catch {
      // not base64url composite
    }

    if (!tableId && dto.qr_token.includes(':')) {
      const parts = dto.qr_token.split(':');
      if (parts.length === 3) {
        tableId = parts[0]!;
        version = parseInt(parts[1]!, 10);
        sig = parts[2]!;
      }
    }

    if (
      !tableId ||
      !sig ||
      version === null ||
      Number.isNaN(version) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tableId) ||
      !/^[0-9a-f]+$/i.test(sig)
    ) {
      throw domainError(
        ErrorCode.TABLE_TOKEN_INVALID,
        'Valid HMAC-signed QR token is required.',
        401,
      );
    }

    // Verify HMAC (timing-safe)
    const expected = this.generateQrToken(tableId, version);
    const expectedBuf = Buffer.from(expected, 'hex');
    const sigBuf = Buffer.from(sig, 'hex');
    const valid =
      expectedBuf.length === sigBuf.length &&
      crypto.timingSafeEqual(expectedBuf, sigBuf);
    if (!valid) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'QR token signature invalid.', 401);
    }

    // Resolve table org_id safely under dineflow_app RLS via SECURITY DEFINER helper
    const { rows } = await pool.query<{
      id: string; org_id: string; qr_token_version: number; outlet_id: string; is_active: boolean; table_number: string;
    }>(
      `SELECT id, org_id, outlet_id, qr_token_version, is_active, table_number
       FROM resolve_table_for_qr($1)`,
      [tableId],
    );
    if (!rows[0] || !rows[0].is_active) {
      throw domainError(ErrorCode.NOT_FOUND, 'Table not found.', 404);
    }
    const table = rows[0];
    if (table.qr_token_version !== version) {
      throw domainError(ErrorCode.UNAUTHORIZED, 'QR code has been rotated. Please scan the new code.', 401);
    }

    // Open session within tenant context (idempotent)
    const session = await withTenantContextRaw(table.org_id, async (db) => {
      const { rows: existing } = await db.query<{
        id: string;
        org_id: string;
        outlet_id: string;
        table_id: string;
        status: string;
        pax: number;
        opened_at: Date | string;
        table_number: string;
        customer_id?: string | null;
      }>(
        `SELECT ts.id, ts.org_id, ts.outlet_id, ts.table_id, ts.status, ts.pax, ts.opened_at,
                ts.customer_id, t.table_number
         FROM table_sessions ts
         LEFT JOIN tables t ON t.id = ts.table_id
         WHERE ts.table_id = $1 AND ts.status = 'OPEN'`,
        [tableId],
      );
      if (existing[0]) return existing[0];

      const { rows } = await db.query<{
        id: string;
        org_id: string;
        outlet_id: string;
        table_id: string;
        status: string;
        pax: number;
        opened_at: Date | string;
        customer_id?: string | null;
      }>(
        `INSERT INTO table_sessions (org_id, outlet_id, table_id, qr_token_version, pax)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, org_id, outlet_id, table_id, status, pax, opened_at, customer_id`,
        [table.org_id, table.outlet_id, tableId, version, dto.pax],
      );
      return { ...rows[0]!, table_number: table.table_number };
    });

    const guestSessionToken = this.tokenService?.signGuestSessionToken({
      sub: session.id,
      org: session.org_id,
      outlet: session.outlet_id,
      table: session.table_id,
      sessionId: session.id,
      customerId: session.customer_id ?? undefined,
      type: 'guest_session',
    });

    return {
      ...session,
      ...(guestSessionToken ? { guestSessionToken } : {}),
    };
  }

  async closeSession(orgId: string, sessionId: string, staffOutletId?: string) {
    return withTenantContextRaw(orgId, async (db) => {
      const { rows } = await db.query<{ id: string; outlet_id: string }>(
        `SELECT id, outlet_id FROM table_sessions WHERE org_id = $1 AND id = $2 AND status = 'OPEN'`,
        [orgId, sessionId],
      );
      if (!rows[0]) throw domainError(ErrorCode.NOT_FOUND, 'Open session not found.', 404);
      assertStaffOutletAccess(staffOutletId, rows[0].outlet_id);

      const { rowCount } = await db.query(
        `UPDATE table_sessions
         SET status = 'CLOSED', closed_at = now(), updated_at = now()
         WHERE org_id = $1 AND id = $2 AND status = 'OPEN'`,
        [orgId, sessionId],
      );
      if (!rowCount) throw domainError(ErrorCode.NOT_FOUND, 'Open session not found.', 404);
    });
  }
}
