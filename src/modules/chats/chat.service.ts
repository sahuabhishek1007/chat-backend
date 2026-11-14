import { AppError } from '../../common/errors';
import type { UserService } from '../users/user.service';
import type { Chat, ChatDetails, ChatMember, ChatRepository, ChatSummary } from './chat.types';

export class ChatService {
  constructor(
    private readonly chats: ChatRepository,
    private readonly users: UserService,
  ) {}

  /** 1. Create or get a 1:1 chat. */
  async createOrGetDirect(
    userAId: string,
    userBId: string,
  ): Promise<{ chatId: string; created: boolean }> {
    if (userAId === userBId) {
      throw AppError.badRequest('A chat needs two different users', 'SAME_USER');
    }
    await this.users.assertAllExist([userAId, userBId]);
    return this.chats.findOrCreateDirect(userAId, userBId);
  }

  /** 6. List a user's chats with member ids. */
  async listUserChats(userId: string): Promise<ChatSummary[]> {
    await this.users.get(userId);
    return this.chats.listForUser(userId);
  }

  async getDetails(chatId: string): Promise<ChatDetails> {
    const chat = await this.requireChat(chatId);
    const members = await this.chats.listMembers(chatId);
    return { ...chat, members };
  }

  async requireChat(chatId: string): Promise<Chat> {
    const chat = await this.chats.findById(chatId);
    if (!chat) throw AppError.notFound(`Chat ${chatId} not found`, 'CHAT_NOT_FOUND');
    return chat;
  }

  /** Used by every message operation: the chat must exist and the user must belong to it. */
  async requireMember(chatId: string, userId: string): Promise<{ chat: Chat; member: ChatMember }> {
    const chat = await this.requireChat(chatId);
    const member = await this.chats.findMember(chatId, userId);
    if (!member) {
      throw AppError.forbidden(`User ${userId} is not a member of chat ${chatId}`, 'NOT_A_MEMBER');
    }
    return { chat, member };
  }

  // ---------- Bonus: group chats ----------

  async createGroup(creatorId: string, name: string, memberIds: string[]): Promise<ChatDetails> {
    const others = [...new Set(memberIds)].filter((id) => id !== creatorId);
    if (others.length === 0) {
      throw AppError.badRequest('A group needs at least one member besides the creator', 'EMPTY_GROUP');
    }
    await this.users.assertAllExist([creatorId, ...others]);
    const chatId = await this.chats.createGroup({ creatorId, name, memberIds: others });
    return this.getDetails(chatId);
  }

  async renameGroup(chatId: string, requesterId: string, name: string): Promise<ChatDetails> {
    await this.requireGroupAdmin(chatId, requesterId);
    await this.chats.rename(chatId, name);
    return this.getDetails(chatId);
  }

  async addMembers(chatId: string, requesterId: string, userIds: string[]): Promise<ChatDetails> {
    await this.requireGroupAdmin(chatId, requesterId);
    const unique = [...new Set(userIds)];
    await this.users.assertAllExist(unique);
    await this.chats.addMembers(chatId, unique);
    return this.getDetails(chatId);
  }

  /** Admins can remove anyone; any member can remove themselves (leave). */
  async removeMember(chatId: string, requesterId: string, userId: string): Promise<void> {
    const { chat, member: requester } = await this.requireMember(chatId, requesterId);
    this.assertGroup(chat);
    if (requesterId !== userId && requester.role !== 'admin') {
      throw AppError.forbidden('Only group admins can remove other members', 'NOT_ADMIN');
    }
    const target = await this.chats.findMember(chatId, userId);
    if (!target) {
      throw AppError.notFound(`User ${userId} is not a member of chat ${chatId}`, 'MEMBER_NOT_FOUND');
    }
    await this.chats.removeMember(chatId, userId);
  }

  private async requireGroupAdmin(chatId: string, requesterId: string): Promise<Chat> {
    const { chat, member } = await this.requireMember(chatId, requesterId);
    this.assertGroup(chat);
    if (member.role !== 'admin') {
      throw AppError.forbidden('Only group admins can do this', 'NOT_ADMIN');
    }
    return chat;
  }

  private assertGroup(chat: Chat): void {
    if (chat.type !== 'group') {
      throw AppError.badRequest('This operation is only allowed on group chats', 'NOT_A_GROUP');
    }
  }
}
