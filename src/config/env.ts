import dotenv from 'dotenv';
import { z } from 'zod';

// A root .env wins; key/.env is the fallback shipped with the repo so a fresh clone runs as-is.
dotenv.config({ quiet: true });
dotenv.config({ path: 'key/.env', quiet: true });

/** Treat `FOO=` (empty string in .env) as "not set". */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),
  DATABASE_URL: z
    .string()
    .regex(/^mysql:\/\//, 'DATABASE_URL must be a mysql:// connection string'),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),
  FIREBASE_PROJECT_ID: z.string().min(1, 'FIREBASE_PROJECT_ID is required'),
  FIREBASE_SERVICE_ACCOUNT_PATH: optionalString,
  FIRESTORE_EMULATOR_HOST: optionalString,
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment configuration:\n${problems}\n\n` +
        'Copy .env.example to .env and fill in your MySQL and Firebase values.',
    );
  }
  return result.data;
}
