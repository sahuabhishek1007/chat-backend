import { randomUUID } from 'node:crypto';
import type { AppServices } from '../../src/app';
import {
  directChatKey,
  type Chat,
  type ChatMember,
  type ChatRepository,
  type ChatSummary,
} from '../../src/modules/chats/chat.types';
import { ChatService } from '../../src/modules/chats/chat.service';
import type {
  LastSeenState,
  Message,
  MessageStore,
  ReadReceipt,
} from '../../src/modules/messages/message.types';
import { MessageService } from '../../src/modules/messages/message.service';
import type { User, UserRepository } from '../../src/modules/users/user.types';
import { UserService } from '../../src/modules/users/user.service';

/** In-memory stand-ins with the same contracts as the MySQL / Firestore implementations. */

export class InMemoryUserRepository implements UserRepository {
  readonly users = new Map<string, User>();

  async create(name: string): Promise<User> {
    const user = { id: randomUUID(), name, createdAt: new Date() };
    this.users.set(user.id, user);
    return user;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async findExistingIds(ids: readonly string[]): Promise<Set<string>> {
    return new Set(ids.filter((id) => this.users.has(id)));
  }
}

export class InMemoryChatRepository implements ChatRepository {
  private readonly chats = new Map<string, Chat & { directKey: string | null }>();
  private readonly members = new Map<string, ChatMember[]>();
  private clock = 0;

  /** Strictly increasing timestamps so ordering assertions are deterministic. */
  private now(): Date {
    this.clock += 1;
    return new Date(Date.UTC(2026, 0, 1) + this.clock);
  }

  async findOrCreateDirect(userAId: string, userBId: string) {
    const key = directChatKey(userAId, userBId);
    for (const chat of this.chats.values()) {
      if (chat.directKey === key) return { chatId: chat.id, created: false };
    }
    const now = this.now();
    const id = randomUUID();
    this.chats.set(id, { id, type: 'direct', name: null, createdBy: userAId, createdAt: now, updatedAt: now, directKey: key });
    this.members.set(id, [
      { userId: userAId, role: 'member', joinedAt: now },
      { userId: userBId, role: 'member', joinedAt: now },
    ]);
    return { chatId: id, created: true };
  }

  async createGroup(input: { creatorId: string; name: string; memberIds: string[] }): Promise<string> {
    const now = this.now();
    const id = randomUUID();
    this.chats.set(id, { id, type: 'group', name: input.name, createdBy: input.creatorId, createdAt: now, updatedAt: now, directKey: null });
    this.members.set(id, [
      { userId: input.creatorId, role: 'admin', joinedAt: now },
      ...input.memberIds.map((userId) => ({ userId, role: 'member' as const, joinedAt: now })),
    ]);
    return id;
  }

  async findById(chatId: string): Promise<Chat | null> {
    const chat = this.chats.get(chatId);
    if (!chat) return null;
    const { directKey: _ignored, ...rest } = chat;
    return rest;
  }

  async findMember(chatId: string, userId: string): Promise<ChatMember | null> {
    return this.members.get(chatId)?.find((m) => m.userId === userId) ?? null;
  }

  async listMembers(chatId: string): Promise<ChatMember[]> {
    return [...(this.members.get(chatId) ?? [])];
  }

  async listForUser(userId: string): Promise<ChatSummary[]> {
    const result: ChatSummary[] = [];
    for (const [chatId, list] of this.members) {
      if (!list.some((m) => m.userId === userId)) continue;
      const chat = await this.findById(chatId);
      if (chat) result.push({ ...chat, memberIds: list.map((m) => m.userId) });
    }
    return result.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async rename(chatId: string, name: string): Promise<void> {
    const chat = this.chats.get(chatId);
    if (chat) Object.assign(chat, { name, updatedAt: this.now() });
  }

  async addMembers(chatId: string, userIds: string[]): Promise<void> {
    const list = this.members.get(chatId) ?? [];
    const now = this.now();
    for (const userId of userIds) {
      if (!list.some((m) => m.userId === userId)) list.push({ userId, role: 'member', joinedAt: now });
    }
    this.members.set(chatId, list);
  }

  async removeMember(chatId: string, userId: string): Promise<void> {
    const list = (this.members.get(chatId) ?? []).filter((m) => m.userId !== userId);
    const first = list[0];
    if (first && !list.some((m) => m.role === 'admin')) first.role = 'admin';
    this.members.set(chatId, list);
  }
}

export class InMemoryMessageStore implements MessageStore {
  private readonly messages = new Map<string, Message[]>();
  private readonly lastSeen = new Map<string, Map<string, LastSeenState>>();

  async send(input: { chatId: string; senderId: string; text: string }): Promise<Message> {
    const list = this.messages.get(input.chatId) ?? [];
    const message: Message = {
      id: randomUUID().replace(/-/g, '').slice(0, 20),
      chatId: input.chatId,
      senderId: input.senderId,
      text: input.text,
      seq: list.length + 1,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      deleted: false,
      readBy: {},
    };
    list.push(message);
    this.messages.set(input.chatId, list);
    return structuredClone(message);
  }

  async list(chatId: string, options: { limit: number; beforeSeq?: number | undefined }): Promise<Message[]> {
    const before = options.beforeSeq;
    const all = (this.messages.get(chatId) ?? []).filter((m) => before === undefined || m.seq < before);
    return structuredClone(all.slice(-options.limit));
  }

  async get(chatId: string, messageId: string): Promise<Message | null> {
    const m = this.find(chatId, messageId);
    return m ? structuredClone(m) : null;
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt | null> {
    const m = this.find(chatId, messageId);
    if (!m) return null;
    const existing = m.readBy[userId];
    if (existing) return { chatId, messageId, userId, readAt: existing, alreadyRead: true };
    const readAt = new Date().toISOString();
    m.readBy[userId] = readAt;
    return { chatId, messageId, userId, readAt, alreadyRead: false };
  }

  async edit(chatId: string, messageId: string, text: string): Promise<Message | null> {
    const m = this.find(chatId, messageId);
    if (!m) return null;
    Object.assign(m, { text, editedAt: new Date().toISOString() });
    return structuredClone(m);
  }

  async softDelete(chatId: string, messageId: string): Promise<Message | null> {
    const m = this.find(chatId, messageId);
    if (!m) return null;
    Object.assign(m, { text: null, deleted: true, deletedAt: new Date().toISOString() });
    return structuredClone(m);
  }

  async updateLastSeen(chatId: string, userId: string, messageId: string) {
    const m = this.find(chatId, messageId);
    if (!m) return null;
    const states = this.lastSeen.get(chatId) ?? new Map<string, LastSeenState>();
    this.lastSeen.set(chatId, states);
    const current = states.get(userId);
    if (current && current.seq >= m.seq) return { state: current, updated: false };
    const next = { chatId, userId, messageId, seq: m.seq, updatedAt: new Date().toISOString() };
    states.set(userId, next);
    return { state: next, updated: true };
  }

  async listLastSeen(chatId: string): Promise<LastSeenState[]> {
    return [...(this.lastSeen.get(chatId)?.values() ?? [])];
  }

  private find(chatId: string, messageId: string): Message | undefined {
    return this.messages.get(chatId)?.find((m) => m.id === messageId);
  }
}

export function buildInMemoryServices(): AppServices {
  const users = new UserService(new InMemoryUserRepository());
  const chats = new ChatService(new InMemoryChatRepository(), users);
  const messages = new MessageService(chats, new InMemoryMessageStore());
  return { users, chats, messages };
}
