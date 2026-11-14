import { randomUUID } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { User, UserRepository } from './user.types';

interface UserRow extends RowDataPacket {
  id: string;
  name: string;
  created_at: Date;
}

const toUser = (row: UserRow): User => ({
  id: row.id,
  name: row.name,
  createdAt: row.created_at,
});

export class MysqlUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async create(name: string): Promise<User> {
    const user: User = { id: randomUUID(), name, createdAt: new Date() };
    await this.pool.execute('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)', [
      user.id,
      user.name,
      user.createdAt,
    ]);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    const [rows] = await this.pool.execute<UserRow[]>(
      'SELECT id, name, created_at FROM users WHERE id = ?',
      [id],
    );
    const row = rows[0];
    return row ? toUser(row) : null;
  }

  async findExistingIds(ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    // `query` (not `execute`) expands an array into `IN (?, ?, ...)`.
    const [rows] = await this.pool.query<(RowDataPacket & { id: string })[]>(
      'SELECT id FROM users WHERE id IN (?)',
      [ids],
    );
    return new Set(rows.map((r) => r.id));
  }
}
