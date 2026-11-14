import { z, type ZodTypeAny } from 'zod';
import { AppError } from './errors';

/** Parses untrusted input (body / params / query) or throws a 400 listing every problem. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw AppError.badRequest('Request validation failed', 'VALIDATION_ERROR', details);
  }
  return result.data;
}

/** UUIDs are normalised to lower case so "A1.." and "a1.." refer to the same user. */
export const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());

/** Firestore auto-IDs are 20 alphanumeric chars; never allow "/" (path traversal into other docs). */
export const firestoreId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Invalid message id');

export const chatIdParams = z.object({ chatId: uuid });
export const userIdParams = z.object({ userId: uuid });
