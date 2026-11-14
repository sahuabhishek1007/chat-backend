import { AppError } from '../../common/errors';
import type { User, UserRepository } from './user.types';

export class UserService {
  constructor(private readonly users: UserRepository) {}

  create(name: string): Promise<User> {
    return this.users.create(name);
  }

  async get(userId: string): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound(`User ${userId} not found`, 'USER_NOT_FOUND');
    return user;
  }

  /** Throws 404 listing every id that doesn't exist. */
  async assertAllExist(userIds: readonly string[]): Promise<void> {
    const unique = [...new Set(userIds)];
    const found = await this.users.findExistingIds(unique);
    const missing = unique.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw AppError.notFound(`Unknown user(s): ${missing.join(', ')}`, 'USER_NOT_FOUND', {
        missing,
      });
    }
  }
}
