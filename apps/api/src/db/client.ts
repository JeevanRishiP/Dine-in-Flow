import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import { getConfig } from '../config/config.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDrizzleDb = NodePgDatabase<Record<string, any>>;

/**
 * Application-level database client.
 * Uses the `app` role which has NO BYPASSRLS — all queries are subject to RLS.
 * Reference: ARCH §6, AGENTS §2 rule 3
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const config = getConfig();
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error', err);
    });
  }
  return pool;
}

export function getDb(): AnyDrizzleDb {
  return drizzle(getPool()) as unknown as AnyDrizzleDb;
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/**
 * Run a callback inside a transaction with the tenant org_id set as a
 * transaction-local session variable. All RLS policies depend on this.
 *
 * Usage:
 *   await withTenantContext(orgId, async (db) => {
 *     return db.select().from(orders).where(...);
 *   });
 *
 * Reference: ARCH §6 rule 4
 */
export async function withTenantContext<T>(
  orgId: string,
  fn: (db: AnyDrizzleDb) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      // Transaction-local set — safe for pooled connections
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const db = drizzle(client) as unknown as AnyDrizzleDb;
      const result = await fn(db);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Like withTenantContext but yields the raw PoolClient (for services that use
 * pg's .query() API directly rather than Drizzle's query builder).
 * The tenant org_id is still set as a transaction-local variable.
 * Reference: ARCH §6 rule 4
 */
export async function withTenantContextRaw<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('app.org_id', $1, true)`, [orgId]);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}


/**
 * System context — bypasses tenant RLS for platform admin and background jobs.
 * Must be used only with explicit justification, never in user-facing request handlers.
 * Reference: ARCH §6 rule 5
 */
export async function withSystemContext<T>(
  fn: (db: AnyDrizzleDb) => Promise<T>,
): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL app.is_system_context = 'true'`);
      const db = drizzle(client) as unknown as AnyDrizzleDb;
      const result = await fn(db);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
