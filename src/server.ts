import { createApp } from './app';
import { loadEnv } from './config/env';
import { buildContainer } from './container';
import { runMigrations } from './db/migrate';

async function main(): Promise<void> {
  const env = loadEnv();

  // Creates the database and tables on first run, so `npm start` is all that's needed.
  await runMigrations(env.DATABASE_URL);

  const container = buildContainer(env);
  const app = createApp(container.services);

  const server = app.listen(env.PORT, () => {
    console.log(`Chat backend listening on http://localhost:${env.PORT}`);
    if (env.FIRESTORE_EMULATOR_HOST) {
      console.log(`Using Firestore emulator at ${env.FIRESTORE_EMULATOR_HOST}`);
    }
  });

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down...`);
    server.close(() => {
      void container.close().finally(() => process.exit(0));
    });
    // Don't hang forever on keep-alive connections.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err: unknown) => {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
  if (code === 'ECONNREFUSED') {
    console.error('\nCannot reach MySQL. Is it running, and is DATABASE_URL in .env correct?\n');
  } else if (code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('\nMySQL rejected the username/password in DATABASE_URL (.env).\n');
  } else {
    console.error(`\n${err instanceof Error ? err.message : String(err)}\n`);
  }
  process.exit(1);
});
