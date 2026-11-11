import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

function loadLocalEnvIfPresent() {
  if (process.env['DATABASE_URL'] || process.env['DATABASE_MIGRATOR_URL']) return;
  const candidates = [
    path.resolve(process.cwd(), '.env.local'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '../../.env.local'),
    path.resolve(process.cwd(), '../../.env'),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
      break;
    }
  }
}

loadLocalEnvIfPresent();

/**
 * Simple migration runner — applies SQL files in numeric order.
 * Tracks applied migrations in `_migrations` table.
 * Uses the MIGRATOR connection (privileged role, not the app role).
 * Reference: ARCH §6 (migrations use separate privileged role)
 */
async function runMigrations(): Promise<void> {
  const connectionString =
    process.env['DATABASE_MIGRATOR_URL'] ?? process.env['DATABASE_URL'];
  if (!connectionString) {
    console.error('[MIGRATE] DATABASE_URL or DATABASE_MIGRATOR_URL must be set');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    // Create migrations tracking table if not exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         serial PRIMARY KEY,
        filename   text NOT NULL UNIQUE,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Read all SQL migration files in order
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const row = await client.query('SELECT 1 FROM _migrations WHERE filename = $1', [file]);
      if ((row.rowCount ?? 0) > 0) {
        console.log(`[MIGRATE] Skipping (already applied): ${file}`);
        continue;
      }

      console.log(`[MIGRATE] Applying: ${file}`);
      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log(`[MIGRATE] ✓ Applied: ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[MIGRATE] ✗ Failed: ${file}`, err);
        throw err;
      }
    }

    console.log('[MIGRATE] All migrations complete.');
  } finally {
    client.release();
    await pool.end();
  }
}

runMigrations().catch((err: unknown) => {
  console.error('[MIGRATE] Fatal error', err);
  process.exit(1);
});
