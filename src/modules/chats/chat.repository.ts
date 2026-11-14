import { randomUUID } from 'node:crypto';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { isDuplicateKeyError, withTransaction } from '../../infra/mysql';
import {
  directChatKey,
  type Chat,
  type ChatMember,
  type ChatRepository,
  type ChatSummary,
  type ChatType,
  type MemberRole,
} from './chat.types';

interface ChatRow extends RowDataPacket {
  id: string;
  type: ChatType;
  name: string | null;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

interface MemberRow extends RowDataPacket {
  chat_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: Date;
}

const CHAT_COLUMNS = 'c.id, c.type, c.name, c.created_by, c.created_at, c.updated_at';

const toChat = (row: ChatRow): Chat => ({
  id: row.id,
  type: row.type,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toMember = (row: MemberRow): ChatMember => ({
  userId: row.user_id,
  role: row.role,
  joinedAt: row.joined_at,
});

export class MysqlChatRepository implements ChatRepository {
  constructor(private readonly pool: Pool) {}

  async findOrCreateDirect(userAId: string, userBId: string): Promise<{ chatId: string; created: boolean }> {
    const key = directChatKey(userAId, userBId);

    const existing = await this.findDirectId(key);
    if (existing) return { chatId: existing, created: false };

    const chatId = randomUUID();
    const now = new Date();
    try {
      await withTransaction(this.pool, async (conn) => {
        await conn.execute(
          `INSERT INTO chats (id, type, direct_key, created_by, created_at, updated_at)
           VALUES (?, 'direct', ?, ?, ?, ?)`,
          [chatId, key, userAId, now, now],
        );
        await this.insertMembers(conn, chatId, [userAId, userBId], 'member', now);
      });
      return { chatId, created: true };
    } catch (err) {
      // Lost a race with a concurrent request for the same pair: the UNIQUE
      // direct_key rejected our row, so return the chat the winner created.
      if (!isDuplicateKeyError(err)) throw err;
      const winner = await this.findDirectId(key);
      if (!winner) throw err;
      return { chatId: winner, created: false };
    }
  }

  async createGroup(input: { creatorId: string; name: string; memberIds: string[] }): Promise<string> {
    const chatId = randomUUID();
    const now = new Date();
    await withTransaction(this.pool, async (conn) => {
      await conn.execute(
        `INSERT INTO chats (id, type, name, created_by, created_at, updated_at)
         VALUES (?, 'group', ?, ?, ?, ?)`,
        [chatId, input.name, input.creatorId, now, now],
      );
      await this.insertMembers(conn, chatId, [input.creatorId], 'admin', now);
      await this.insertMembers(conn, chatId, input.memberIds, 'member', now);
    });
    return chatId;
  }

  async findById(chatId: string): Promise<Chat | null> {
    const [rows] = await this.pool.execute<ChatRow[]>(
      `SELECT ${CHAT_COLUMNS} FROM chats c WHERE c.id = ?`,
      [chatId],
    );
    const row = rows[0];
    return row ? toChat(row) : null;
  }

  async findMember(chatId: string, userId: string): Promise<ChatMember | null> {
    const [rows] = await this.pool.execute<MemberRow[]>(
      'SELECT chat_id, user_id, role, joined_at FROM chat_members WHERE chat_id = ? AND user_id = ?',
      [chatId, userId],
    );
    const row = rows[0];
    return row ? toMember(row) : null;
  }

  async listMembers(chatId: string): Promise<ChatMember[]> {
    const [rows] = await this.pool.execute<MemberRow[]>(
      `SELECT chat_id, user_id, role, joined_at FROM chat_members
       WHERE chat_id = ? ORDER BY joined_at, user_id`,
      [chatId],
    );
    return rows.map(toMember);
  }

  async listForUser(userId: string): Promise<ChatSummary[]> {
    const [chats] = await this.pool.execute<ChatRow[]>(
      `SELECT ${CHAT_COLUMNS}
       FROM chats c
       JOIN chat_members me ON me.chat_id = c.id AND me.user_id = ?
       ORDER BY c.updated_at DESC, c.id`,
      [userId],
    );
    if (chats.length === 0) return [];

    // One extra query for all members (instead of GROUP_CONCAT, which silently
    // truncates at group_concat_max_len for large groups).
    const [members] = await this.pool.query<MemberRow[]>(
      `SELECT chat_id, user_id, role, joined_at FROM chat_members
       WHERE chat_id IN (?) ORDER BY joined_at, user_id`,
      [chats.map((c) => c.id)],
    );
    const byChat = new Map<string, string[]>();
    for (const m of members) {
      const list = byChat.get(m.chat_id) ?? [];
      list.push(m.user_id);
      byChat.set(m.chat_id, list);
    }

    return chats.map((row) => ({ ...toChat(row), memberIds: byChat.get(row.id) ?? [] }));
  }

  async rename(chatId: string, name: string): Promise<void> {
    await this.pool.execute('UPDATE chats SET name = ?, updated_at = ? WHERE id = ?', [
      name,
      new Date(),
      chatId,
    ]);
  }

  async addMembers(chatId: string, userIds: string[]): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      const now = new Date();
      await this.lockChat(conn, chatId);
      await this.insertMembers(conn, chatId, userIds, 'member', now);
      await conn.execute('UPDATE chats SET updated_at = ? WHERE id = ?', [now, chatId]);
    });
  }

  async removeMember(chatId: string, userId: string): Promise<void> {
    await withTransaction(this.pool, async (conn) => {
      // Serialise membership changes per chat so two admins leaving at the same
      // time can't both see "the other admin is still here" and leave none.
      await this.lockChat(conn, chatId);
      await conn.execute('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', [chatId, userId]);

      const [admins] = await conn.execute<RowDataPacket[]>(
        `SELECT 1 FROM chat_members WHERE chat_id = ? AND role = 'admin' LIMIT 1`,
        [chatId],
      );
      if (admins.length === 0) {
        const [oldest] = await conn.execute<MemberRow[]>(
          `SELECT chat_id, user_id, role, joined_at FROM chat_members
           WHERE chat_id = ? ORDER BY joined_at, user_id LIMIT 1`,
          [chatId],
        );
        const successor = oldest[0];
        if (successor) {
          await conn.execute(
            `UPDATE chat_members SET role = 'admin' WHERE chat_id = ? AND user_id = ?`,
            [chatId, successor.user_id],
          );
        }
      }
      await conn.execute('UPDATE chats SET updated_at = ? WHERE id = ?', [new Date(), chatId]);
    });
  }

  private async findDirectId(key: string): Promise<string | null> {
    const [rows] = await this.pool.execute<(RowDataPacket & { id: string })[]>(
      'SELECT id FROM chats WHERE direct_key = ?',
      [key],
    );
    return rows[0]?.id ?? null;
  }

  private async lockChat(conn: PoolConnection, chatId: string): Promise<void> {
    await conn.execute('SELECT id FROM chats WHERE id = ? FOR UPDATE', [chatId]);
  }

  private async insertMembers(
    conn: PoolConnection,
    chatId: string,
    userIds: string[],
    role: MemberRole,
    joinedAt: Date,
  ): Promise<void> {
    if (userIds.length === 0) return;
    // Bulk insert; users already in the chat are left untouched.
    await conn.query(
      `INSERT INTO chat_members (chat_id, user_id, role, joined_at) VALUES ?
       ON DUPLICATE KEY UPDATE chat_id = chat_id`,
      [userIds.map((userId) => [chatId, userId, role, joinedAt])],
    );
  }
}
