import { loadEnv } from '../config/env';
import { createMysqlPool } from '../infra/mysql';
import { MysqlUserRepository } from '../modules/users/user.repository';

/** Creates a few demo users and prints their ids for use in the API calls. */
async function main(): Promise<void> {
  const env = loadEnv();
  const pool = createMysqlPool(env.DATABASE_URL, 1);
  try {
    const users = new MysqlUserRepository(pool);
    for (const name of ['Alice', 'Bob', 'Charlie']) {
      const user = await users.create(name);
      console.log(`${user.name.padEnd(8)} ${user.id}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
