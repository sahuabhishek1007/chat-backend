import { existsSync } from 'node:fs';
import path from 'node:path';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import type { Env } from '../config/env';

/**
 * Initialises the Firebase Admin SDK.
 * - FIREBASE_SERVICE_ACCOUNT_PATH set  -> explicit service-account key
 * - otherwise                          -> Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS)
 * - FIRESTORE_EMULATOR_HOST set        -> the SDK talks to the local emulator automatically
 */
export function createFirestore(
  env: Pick<Env, 'FIREBASE_PROJECT_ID' | 'FIREBASE_SERVICE_ACCOUNT_PATH'>,
): Firestore {
  if (env.FIREBASE_SERVICE_ACCOUNT_PATH && !existsSync(env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
    throw new Error(
      `Firebase key not found at ${path.resolve(env.FIREBASE_SERVICE_ACCOUNT_PATH)}.\n` +
        'Download it from Firebase console -> Project settings -> Service accounts -> ' +
        'Generate new private key, and save it at that path.',
    );
  }

  const app =
    getApps()[0] ??
    initializeApp({
      projectId: env.FIREBASE_PROJECT_ID,
      ...(env.FIREBASE_SERVICE_ACCOUNT_PATH
        ? { credential: cert(env.FIREBASE_SERVICE_ACCOUNT_PATH) }
        : {}),
    });

  const db = getFirestore(app);
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}
