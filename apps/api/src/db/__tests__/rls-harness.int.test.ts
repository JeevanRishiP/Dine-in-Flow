import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

/**
 * RLS Harness Integration Test
 *
 * Verifies three things:
 * 1. Cross-tenant SELECT returns zero rows.
 * 2. Cross-tenant UPDATE affects zero rows.
 * 3. Cross-tenant INSERT is rejected by the WITH CHECK policy.
 * 4. (Enumeration) Every public table with an org_id column has FORCE ROW LEVEL SECURITY.
 *    A new table without RLS FAILS this test — preventing it from merging.
 *
 * Reference: ARCH §6 rule 7, AGENTS §2 rule 3
 */
describe('RLS Harness: tenant isolation', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: Pool; // Superuser — used for migrations and cross-tenant seed
  let appPool: Pool;   // dineflow_app role — subject to RLS

  const ORG_A = '00000000-0000-7000-8000-000000000001';
  const ORG_B = '00000000-0000-7000-8000-000000000002';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('dineflow_test')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();

    adminPool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: 'dineflow_test',
      user: 'postgres',
      password: 'postgres',
    });

    // Run migrations as admin (migrator role)
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
      await adminPool.query(sql);
    }

    // Grant dineflow_app role connect + usage privileges (the migration creates the role,
    // but in test we reset the password for the test container user)
    await adminPool.query(`ALTER ROLE dineflow_app PASSWORD 'testpassword'`);
    await adminPool.query(`GRANT CONNECT ON DATABASE dineflow_test TO dineflow_app`);
    await adminPool.query(`GRANT USAGE ON SCHEMA public TO dineflow_app`);

    appPool = new Pool({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: 'dineflow_test',
      user: 'dineflow_app',
      password: 'testpassword',
    });

    // Seed data for both orgs using admin (bypasses RLS for seed)
    await adminPool.query(
      `INSERT INTO _rls_test_items (org_id, label) VALUES ($1, $2), ($3, $4)`,
      [ORG_A, 'org-a-item', ORG_B, 'org-b-item'],
    );
  }, 120_000);

  afterAll(async () => {
    await appPool?.end();
    await adminPool?.end();
    await container?.stop();
  });

  async function queryAsOrg(orgId: string, sql: string, params?: unknown[]): Promise<unknown[]> {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      return result.rows as unknown[];
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  it('SELECT: org A can only see its own rows', async () => {
    const rows = await queryAsOrg(ORG_A, 'SELECT label FROM _rls_test_items');
    expect(rows).toHaveLength(1);
    expect((rows[0] as { label: string }).label).toBe('org-a-item');
  });

  it('SELECT: org B can only see its own rows', async () => {
    const rows = await queryAsOrg(ORG_B, 'SELECT label FROM _rls_test_items');
    expect(rows).toHaveLength(1);
    expect((rows[0] as { label: string }).label).toBe('org-b-item');
  });

  it('UPDATE: org A cannot update org B rows (0 rows affected)', async () => {
    const client = await appPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [ORG_A]);
      const result = await client.query(
        `UPDATE _rls_test_items SET label = 'hacked' WHERE org_id = $1`,
        [ORG_B],
      );
      await client.query('COMMIT');
      expect(result.rowCount).toBe(0);
    } finally {
      client.release();
    }
  });

  it('INSERT: org A cannot insert a row with org B id (WITH CHECK violation)', async () => {
    await expect(
      queryAsOrg(ORG_A, `INSERT INTO _rls_test_items (org_id, label) VALUES ($1, $2)`, [
        ORG_B,
        'cross-tenant-insert',
      ]),
    ).rejects.toThrow();
  });

  it('Enumeration: every public table with org_id column has FORCE ROW LEVEL SECURITY', async () => {
    // This test MUST FAIL CI if a new tenant table is added without RLS.
    const result = await adminPool.query<{ tablename: string; rlsenabled: boolean; rlsforced: boolean }>(`
      SELECT
        c.relname AS tablename,
        c.relrowsecurity AS rlsenabled,
        c.relforcerowsecurity AS rlsforced
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE
        n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname NOT LIKE '_migrations%'
        AND EXISTS (
          SELECT 1
          FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'org_id'
        )
    `);

    const violations = result.rows.filter((r) => !r.rlsenabled || !r.rlsforced);

    if (violations.length > 0) {
      const names = violations.map((v) => v.tablename).join(', ');
      throw new Error(
        `CI FAILURE: The following tables have org_id but are missing FORCE ROW LEVEL SECURITY: ${names}. ` +
          `Add ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY + a tenant_isolation policy before merging.`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
