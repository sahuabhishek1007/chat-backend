import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { createConnection, type RowDataPacket } from 'mysql2/promise';
import { loadEnv } from '../config/env';
import { createMysqlPool } from '../infra/mysql';

// Resolves to <project>/db/migrations from both src/db (tsx) and dist/db (node).
const MIGRATIONS_DIR = path.resolve(__dirname, '../../db/migrations');

/** Creates the database named in the URL if it doesn't exist yet. */
async function ensureDatabase(databaseUrl: string): Promise<void> {
  const url = new URL(databaseUrl);
  const dbName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^\w+$/.test(dbName)) {
    throw new Error(`DATABASE_URL must end with a simple database name, got "${dbName}"`);
  }
  url.pathname = '/';
  const conn = await createConnection({ uri: url.toString() });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
  } finally {
    await conn.end();
  }
}

/** Creates the database and applies any SQL migrations that haven't run yet. Safe to run every startup. */
export async function runMigrations(databaseUrl: string): Promise<void> {
  await ensureDatabase(databaseUrl);

  // Migration files contain several statements.
  const pool = createMysqlPool(databaseUrl, 1, { multipleStatements: true });
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       VARCHAR(191) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

    const [rows] = await pool.query<(RowDataPacket & { name: string })[]>(
      'SELECT name FROM schema_migrations',
    );
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      // MySQL DDL auto-commits, so migrations are written to be re-runnable (IF NOT EXISTS).
      await pool.query(sql);
      await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
      console.log(`[migrate] applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

// `npm run migrate` still works on its own.
if (require.main === module) {
  runMigrations(loadEnv().DATABASE_URL)
    .then(() => console.log('[migrate] database is up to date'))
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
