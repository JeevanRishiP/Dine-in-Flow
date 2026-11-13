import { Injectable, Optional } from '@nestjs/common';
import * as crypto from 'node:crypto';
import type { PoolClient } from 'pg';
import { withTenantContextRaw, getPool } from '../../db/client.js';
import { getConfig } from '../../config/config.js';
import { domainError } from '../../common/errors/domain-error.js';
import { assertStaffOutletAccess } from '../../common/utils/outlet-scope.utils.js';
import { parseCookies } from '../../common/utils/cookie.utils.js';
import { ErrorCode } from '@dineflow/contracts';
import { TokenService } from '../auth/token.service.js';
import type { CreateTableSchema, UpdateTableSchema, OpenSessionSchema, OpenManualSessionSchema } from './tables.dto.js';
import type { z } from 'zod';

type CreateTableInput = z.infer<typeof CreateTableSchema>;
type UpdateTableInput = z.infer<typeof UpdateTableSchema>;
type OpenSessionInput = z.infer<typeof OpenSessionSchema>;
type OpenManualSessionInput = z.infer<typeof OpenManualSessionSchema>;

export function normalizeTableNumberDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '');
  return digits || '0';
}

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

  resolveCallerIdentityFromHeaders(
    cookieHeader?: string,
    authHeader?: string,
  ): { callerTempCustomerId?: string; callerCustomerId?: string } {
    const cookies = parseCookies(cookieHeader);
    const rawTempCookie = cookies['df_temp_cust'];
    const tempDecoded = rawTempCookie
      ? this.tokenService?.verifyTempCustomerToken?.(rawTempCookie)
      : null;

    let callerCustomerId: string | undefined;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const accessDecoded = this.tokenService?.verifyAccessToken?.(authHeader.slice(7).trim());
      if (accessDecoded?.type === 'customer_access') {
        callerCustomerId = accessDecoded.sub;
      }
    }

    return {
      callerTempCustomerId: tempDecoded?.sub,
      callerCustomerId,
    };
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
  async openSession(
    dto: OpenSessionInput & { callerTempCustomerId?: string; callerCustomerId?: string },
  ) {
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

    // Open session within tenant context strictly scoped to this customer/temp-customer
    return this.openOrResumeScopedSession({
      orgId: table.org_id,
      outletId: table.outlet_id,
      tableId,
      tableNumber: table.table_number,
      qrTokenVersion: version,
      pax: dto.pax,
      callerTempCustomerId: dto.callerTempCustomerId,
      callerCustomerId: dto.callerCustomerId,
    });
  }

  private async openOrResumeScopedSession(params: {
    orgId: string;
    outletId: string;
    tableId: string;
    tableNumber: string;
    qrTokenVersion: number;
    pax: number;
    callerTempCustomerId?: string;
    callerCustomerId?: string;
  }) {
    const {
      orgId,
      outletId,
      tableId,
      tableNumber,
      qrTokenVersion,
      pax,
      callerTempCustomerId,
      callerCustomerId,
    } = params;

    const result = await withTenantContextRaw(orgId, async (db) => {
      let tempCustomerId: string | undefined;

      if (!callerCustomerId) {
        if (callerTempCustomerId) {
          const { rows: tcRows } = await db.query<{ id: string }>(
            `SELECT id FROM temp_customers
             WHERE id = $1 AND org_id = $2 AND outlet_id = $3 AND status = 'ACTIVE'`,
            [callerTempCustomerId, orgId, outletId],
          );
          if (tcRows[0]) {
            tempCustomerId = tcRows[0].id;
            await db.query(
              `UPDATE temp_customers SET active_table_id = $1, updated_at = now()
               WHERE id = $2 AND org_id = $3`,
              [tableId, tempCustomerId, orgId],
            );
          }
        }
        if (!tempCustomerId) {
          const { rows: newTc } = await db.query<{ id: string }>(
            `INSERT INTO temp_customers (org_id, outlet_id, active_table_id, status)
             VALUES ($1, $2, $3, 'ACTIVE')
             RETURNING id`,
            [orgId, outletId, tableId],
          );
          tempCustomerId = newTc[0]!.id;
        }
      }

      type SessionRow = {
        id: string;
        org_id: string;
        outlet_id: string;
        table_id: string;
        status: string;
        pax: number;
        opened_at: Date | string;
        customer_id?: string | null;
        temp_customer_id?: string | null;
      };

      let existing: SessionRow | undefined;
      if (callerCustomerId) {
        const { rows } = await db.query<SessionRow>(
          `SELECT id, org_id, outlet_id, table_id, status, pax, opened_at, customer_id, temp_customer_id
           FROM table_sessions
           WHERE table_id = $1 AND org_id = $2 AND customer_id = $3 AND status = 'OPEN'
           ORDER BY opened_at DESC LIMIT 1`,
          [tableId, orgId, callerCustomerId],
        );
        existing = rows[0];
      } else if (tempCustomerId) {
        const { rows } = await db.query<SessionRow>(
          `SELECT id, org_id, outlet_id, table_id, status, pax, opened_at, customer_id, temp_customer_id
           FROM table_sessions
           WHERE table_id = $1 AND org_id = $2 AND temp_customer_id = $3 AND status = 'OPEN'
           ORDER BY opened_at DESC LIMIT 1`,
          [tableId, orgId, tempCustomerId],
        );
        existing = rows[0];
      }

      if (existing) {
        return { session: { ...existing, table_number: tableNumber }, tempCustomerId };
      }

      const { rows } = await db.query<SessionRow>(
        `INSERT INTO table_sessions (org_id, outlet_id, table_id, customer_id, temp_customer_id, qr_token_version, pax)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, org_id, outlet_id, table_id, status, pax, opened_at, customer_id, temp_customer_id`,
        [orgId, outletId, tableId, callerCustomerId ?? null, tempCustomerId ?? null, qrTokenVersion, pax],
      );
      return { session: { ...rows[0]!, table_number: tableNumber }, tempCustomerId };
    });

    const guestSessionToken = this.tokenService?.signGuestSessionToken({
      sub: result.session.id,
      org: result.session.org_id,
      outlet: result.session.outlet_id,
      table: result.session.table_id,
      sessionId: result.session.id,
      customerId: result.session.customer_id ?? callerCustomerId ?? undefined,
      tempCustomerId: result.tempCustomerId,
      type: 'guest_session',
    });

    const tempCustomerToken = result.tempCustomerId
      ? this.tokenService?.signTempCustomerToken?.({
          sub: result.tempCustomerId,
          org: result.session.org_id,
          outlet: result.session.outlet_id,
        })
      : undefined;

    return {
      ...result.session,
      ...(result.tempCustomerId ? { tempCustomerId: result.tempCustomerId } : {}),
      ...(guestSessionToken ? { guestSessionToken } : {}),
      ...(tempCustomerToken ? { tempCustomerToken } : {}),
    };
  }

  /**
   * Public directory of active tables for an active outlet (table number live matching).
   * Resolves outlet via explicit outletId -> slug -> host subdomain -> DEFAULT_PUBLIC_OUTLET_ID
   * -> pilot slug in non-production environments. Returns zero PII or session state.
   */
  private extractSlugFromHost(host?: string): string | undefined {
    if (!host) return undefined;
    const hostname = host.split(':')[0]?.trim().toLowerCase() ?? '';
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
      return undefined;
    }
    const parts = hostname.split('.');
    if (parts.length === 2 && parts[1] === 'localhost' && parts[0]) {
      return parts[0];
    }
    if (parts.length >= 3 && parts[0] && !['www', 'api', 'app', 'customer'].includes(parts[0])) {
      return parts[0];
    }
    return undefined;
  }

  async listPublicOutletTables(
    outletId?: string,
    opts?: { slug?: string; host?: string },
  ) {
    const pool = getPool();
    let resolvedOutletId = outletId;
    let orgId: string | null = null;

    if (!resolvedOutletId) {
      const cfg = getConfig();
      const candidateSlug = opts?.slug || this.extractSlugFromHost(opts?.host);
      if (candidateSlug) {
        const { rows: slugRows } = await pool.query<{ outlet_id: string; org_id: string }>(
          `SELECT outlet_id, org_id FROM resolve_public_outlet_by_slug($1)`,
          [candidateSlug],
        );
        if (slugRows[0]) {
          resolvedOutletId = slugRows[0].outlet_id;
          orgId = slugRows[0].org_id;
        }
      } else if (cfg.DEFAULT_PUBLIC_OUTLET_ID) {
        resolvedOutletId = cfg.DEFAULT_PUBLIC_OUTLET_ID;
      } else if (cfg.NODE_ENV !== 'production') {
        const { rows: pilotRows } = await pool.query<{ outlet_id: string; org_id: string }>(
          `SELECT outlet_id, org_id FROM resolve_public_outlet_by_slug($1)`,
          ['royal-spice-bistro'],
        );
        if (pilotRows[0]) {
          resolvedOutletId = pilotRows[0].outlet_id;
          orgId = pilotRows[0].org_id;
        }
      }
    }

    if (!resolvedOutletId) {
      throw domainError(ErrorCode.OUTLET_NOT_FOUND, 'Outlet not found or inactive.', 404);
    }

    if (!orgId) {
      const { rows: orgRows } = await pool.query<{ resolve_outlet_org: string | null }>(
        `SELECT resolve_outlet_org($1) AS resolve_outlet_org`,
        [resolvedOutletId],
      );
      orgId = orgRows[0]?.resolve_outlet_org ?? null;
    }

    if (!orgId) {
      throw domainError(ErrorCode.OUTLET_NOT_FOUND, 'Outlet not found or inactive.', 404);
    }

    const { rows } = await pool.query<{
      id: string;
      org_id: string;
      outlet_id: string;
      table_number: string;
      section: string | null;
      capacity: number;
    }>(
      `SELECT id, org_id, outlet_id, table_number, section, capacity
       FROM list_public_outlet_tables($1)`,
      [resolvedOutletId],
    );

    return {
      org_id: orgId,
      outlet_id: resolvedOutletId,
      tables: rows.map((r) => ({
        id: r.id,
        table_number: r.table_number,
        numeric_number: normalizeTableNumberDigits(r.table_number),
        section: r.section,
        capacity: r.capacity,
      })),
    };
  }

  /**
   * Open or join a table session via manual numeric entry (when customer opened link
   * without an NFC/QR tag; matched against active hotel tables).
   * Currently targeted for PAY_FIRST ordering; tagged with authMode='MANUAL' for future PAY_LATER risk rules.
   */
  async openManualSession(
    dto: OpenManualSessionInput & { callerTempCustomerId?: string; callerCustomerId?: string },
    host?: string,
  ) {
    const directory = await this.listPublicOutletTables(dto.outlet_id, {
      slug: dto.slug,
      host,
    });
    const wantedDigits = normalizeTableNumberDigits(dto.table_number);
    const wantedUpper = dto.table_number.trim().toUpperCase();

    const matched = directory.tables.find(
      (t) =>
        t.table_number.toUpperCase() === wantedUpper ||
        t.numeric_number === wantedDigits,
    );
    if (!matched) {
      throw domainError(ErrorCode.NOT_FOUND, 'Wrong table number for this hotel.', 404);
    }

    const tokenVersion = await withTenantContextRaw(directory.org_id, async (db) => {
      const { rows: tRows } = await db.query<{ qr_token_version: number }>(
        `SELECT qr_token_version FROM tables WHERE id = $1 AND org_id = $2`,
        [matched.id, directory.org_id],
      );
      return tRows[0]?.qr_token_version ?? 1;
    });

    const result = await this.openOrResumeScopedSession({
      orgId: directory.org_id,
      outletId: directory.outlet_id,
      tableId: matched.id,
      tableNumber: matched.table_number,
      qrTokenVersion: tokenVersion,
      pax: dto.pax,
      callerTempCustomerId: dto.callerTempCustomerId,
      callerCustomerId: dto.callerCustomerId,
    });

    return {
      ...result,
      verification_mode: 'MANUAL',
    };
  }

  /**
   * Restore an active temporary guest session from HttpOnly cookie across page reloads,
   * PhonePe redirects, or cross-tab navigation. Returns { active: false, dissolved: true }
   * once Captain cleans all tables associated with this temporary customer.
   */
  async getCurrentGuestSession(tempCustomerCookie?: string) {
    if (!tempCustomerCookie) {
      return { active: false, dissolved: false };
    }
    const decoded = this.tokenService?.verifyTempCustomerToken?.(tempCustomerCookie);
    if (!decoded) {
      return { active: false, dissolved: false };
    }

    const pool = getPool();
    const { rows: activeRows } = await pool.query<{
      id: string;
      org_id: string;
      outlet_id: string;
      active_table_id: string | null;
      table_number: string | null;
    }>(`SELECT id, org_id, outlet_id, active_table_id, table_number FROM resolve_active_temp_customer($1)`, [
      decoded.sub,
    ]);
    const tc = activeRows[0];
    if (!tc) {
      return { active: false, dissolved: true };
    }

    return withTenantContextRaw(tc.org_id, async (db) => {
      const { rows: linkedTables } = await db.query<{ id: string; table_number: string }>(
        `SELECT t.id, t.table_number
         FROM temp_customer_tables tct
         JOIN tables t ON t.id = tct.table_id AND t.org_id = tct.org_id
         WHERE tct.org_id = $1 AND tct.temp_customer_id = $2 AND tct.status = 'ACTIVE'
         ORDER BY tct.created_at ASC`,
        [tc.org_id, tc.id],
      );

      let targetTableId = tc.active_table_id || linkedTables[0]?.id || null;
      let targetTableNumber = tc.table_number || linkedTables[0]?.table_number || null;

      // If current active table was cleaned while customer still has another uncleaned table,
      // automatically switch their active table pointer to the remaining open table.
      if (linkedTables.length > 0 && targetTableId && !linkedTables.some((lt) => lt.id === targetTableId)) {
        const fallback = linkedTables[0]!;
        targetTableId = fallback.id;
        targetTableNumber = fallback.table_number;
        await db.query(
          `UPDATE temp_customers SET active_table_id = $1, updated_at = now() WHERE id = $2 AND org_id = $3`,
          [targetTableId, tc.id, tc.org_id],
        );
      }

      const { rows: openSess } = await db.query<{ id: string; table_id: string; table_number: string }>(
        `SELECT ts.id, ts.table_id, t.table_number
         FROM table_sessions ts
         JOIN tables t ON t.id = ts.table_id
         WHERE ts.org_id = $1 AND ts.temp_customer_id = $2 AND ts.status = 'OPEN'
           ${targetTableId ? 'AND ts.table_id = $3' : ''}
         ORDER BY ts.opened_at DESC LIMIT 1`,
        targetTableId ? [tc.org_id, tc.id, targetTableId] : [tc.org_id, tc.id],
      );

      let sessionId = openSess[0]?.id ?? '';
      if (!sessionId && targetTableId) {
        const { rows: tRows } = await db.query<{ qr_token_version: number }>(
          `SELECT qr_token_version FROM tables WHERE id = $1 AND org_id = $2`,
          [targetTableId, tc.org_id],
        );
        const { rows: createdSess } = await db.query<{ id: string }>(
          `INSERT INTO table_sessions (org_id, outlet_id, table_id, temp_customer_id, qr_token_version, pax)
           VALUES ($1, $2, $3, $4, $5, 2)
           RETURNING id`,
          [tc.org_id, tc.outlet_id, targetTableId, tc.id, tRows[0]?.qr_token_version ?? 1],
        );
        sessionId = createdSess[0]!.id;
      }

      const guestSessionToken = sessionId
        ? this.tokenService?.signGuestSessionToken({
            sub: sessionId,
            org: tc.org_id,
            outlet: tc.outlet_id,
            table: targetTableId ?? '',
            sessionId,
            tempCustomerId: tc.id,
            type: 'guest_session',
          })
        : undefined;

      return {
        active: true,
        dissolved: false,
        tempCustomerId: tc.id,
        orgId: tc.org_id,
        outletId: tc.outlet_id,
        tableId: targetTableId ?? '',
        tableNumber: targetTableNumber ?? '',
        sessionId,
        activeTables: linkedTables,
        ...(guestSessionToken ? { guestSessionToken } : {}),
      };
    });
  }

  /**
   * Floor view for Captain / Staff Console: physical tables + open sessions + uncleaned temp customer tables.
   */
  async getFloorOverview(orgId: string, outletId?: string) {
    return withTenantContextRaw(orgId, async (db) => {
      const params: unknown[] = [orgId];
      let outletClause = '';
      if (outletId) {
        params.push(outletId);
        outletClause = ` AND t.outlet_id = $${params.length}`;
      }

      const { rows } = await db.query<{
        id: string;
        org_id: string;
        outlet_id: string;
        table_number: string;
        capacity: number;
        section: string | null;
        qr_token_version: number;
        open_sessions_count: string;
        active_guest_pax: string;
        active_temp_tables_count: string;
        first_opened_at: string | null;
      }>(
        `SELECT t.id, t.org_id, t.outlet_id, t.table_number, t.capacity, t.section, t.qr_token_version,
                COUNT(DISTINCT ts.id) FILTER (WHERE ts.status = 'OPEN')::text AS open_sessions_count,
                COALESCE(SUM(ts.pax) FILTER (WHERE ts.status = 'OPEN'), 0)::text AS active_guest_pax,
                COUNT(DISTINCT tct.id) FILTER (WHERE tct.status = 'ACTIVE')::text AS active_temp_tables_count,
                MIN(ts.opened_at) FILTER (WHERE ts.status = 'OPEN') AS first_opened_at
         FROM tables t
         LEFT JOIN table_sessions ts ON ts.table_id = t.id AND ts.org_id = t.org_id AND ts.status = 'OPEN'
         LEFT JOIN temp_customer_tables tct ON tct.table_id = t.id AND tct.org_id = t.org_id AND tct.status = 'ACTIVE'
         WHERE t.org_id = $1 AND t.is_active = true ${outletClause}
         GROUP BY t.id
         ORDER BY t.outlet_id, t.table_number`,
        params,
      );

      return rows.map((r) => {
        const openSessionsCount = Number(r.open_sessions_count || 0);
        const activeTempTablesCount = Number(r.active_temp_tables_count || 0);
        return {
          id: r.id,
          org_id: r.org_id,
          outlet_id: r.outlet_id,
          table_number: r.table_number,
          capacity: r.capacity,
          section: r.section,
          qr_token_version: r.qr_token_version,
          open_sessions_count: openSessionsCount,
          active_guest_pax: Number(r.active_guest_pax || 0),
          active_temp_tables_count: activeTempTablesCount,
          needs_cleaning: openSessionsCount > 0 || activeTempTablesCount > 0,
          first_opened_at: r.first_opened_at,
        };
      });
    });
  }

  /**
   * Captain/Waiter marks a table cleaned & ready for the next customer.
   * Marks active table links for this table CLEANED, closes open sessions on this table,
   * and dissolves a temporary customer ONLY once ALL tables linked to them are cleaned.
   */
  async cleanTableAndDissolve(
    orgId: string,
    tableId: string,
    staffUserId: string,
    staffOutletId?: string,
  ) {
    return withTenantContextRaw(orgId, async (db) => {
      const table = await this.getTableInTx(orgId, tableId, db, staffOutletId);
      const tableNumber = table['table_number'] as string;

      // Gather every temporary customer tied to this table (ordered or currently seated here)
      const { rows: linkedTcs } = await db.query<{ temp_customer_id: string }>(
        `SELECT DISTINCT temp_customer_id FROM (
           SELECT temp_customer_id FROM temp_customer_tables
           WHERE org_id = $1 AND table_id = $2 AND status = 'ACTIVE'
           UNION
           SELECT id AS temp_customer_id FROM temp_customers
           WHERE org_id = $1 AND active_table_id = $2 AND status = 'ACTIVE'
           UNION
           SELECT temp_customer_id FROM table_sessions
           WHERE org_id = $1 AND table_id = $2 AND status = 'OPEN' AND temp_customer_id IS NOT NULL
         ) sub`,
        [orgId, tableId],
      );

      await db.query(
        `UPDATE temp_customer_tables
         SET status = 'CLEANED', cleaned_at = now(), cleaned_by = $3, updated_at = now()
         WHERE org_id = $1 AND table_id = $2 AND status = 'ACTIVE'`,
        [orgId, tableId, staffUserId],
      );

      await db.query(
        `UPDATE table_sessions
         SET status = 'CLOSED', closed_at = now(), updated_at = now()
         WHERE org_id = $1 AND table_id = $2 AND status = 'OPEN'`,
        [orgId, tableId],
      );

      const dissolvedTempCustomerIds: string[] = [];
      let stillActiveOtherTablesCount = 0;

      for (const row of linkedTcs) {
        const tcId = row.temp_customer_id;
        const { rows: remRows } = await db.query<{ remaining: number }>(
          `SELECT COUNT(*)::int AS remaining
           FROM temp_customer_tables
           WHERE org_id = $1 AND temp_customer_id = $2 AND status = 'ACTIVE'`,
          [orgId, tcId],
        );
        const remaining = Number(remRows[0]?.remaining ?? 0);
        if (remaining === 0) {
          await db.query(
            `UPDATE temp_customers
             SET status = 'DISSOLVED', dissolved_at = now(), updated_at = now()
             WHERE id = $1 AND org_id = $2 AND status = 'ACTIVE'`,
            [tcId, orgId],
          );
          await db.query(
            `UPDATE table_sessions
             SET status = 'CLOSED', closed_at = now(), updated_at = now()
             WHERE org_id = $1 AND temp_customer_id = $2 AND status = 'OPEN'`,
            [orgId, tcId],
          );
          dissolvedTempCustomerIds.push(tcId);
        } else {
          stillActiveOtherTablesCount += remaining;
        }
      }

      return {
        cleaned: true,
        tableId,
        tableNumber,
        dissolvedTempCustomerIds,
        stillActiveOtherTablesCount,
      };
    });
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
