import { createPool, type Pool, type PoolConnection } from 'mysql2/promise';

export function createMysqlPool(
  uri: string,
  connectionLimit: number,
  options: { multipleStatements?: boolean } = {},
): Pool {
  return createPool({
    uri,
    connectionLimit,
    // Read DATETIME columns as UTC and serialise JS Dates as UTC. The app always
    // supplies timestamps itself, so values never depend on the server's time zone.
    timezone: 'Z',
    multipleStatements: options.multipleStatements ?? false,
  });
}

/** Runs `fn` inside START TRANSACTION/COMMIT, rolling back on any error. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (conn: PoolConnection) => Promise<T>,
): Promise<T> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback().catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export function isDuplicateKeyError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ER_DUP_ENTRY';
}
