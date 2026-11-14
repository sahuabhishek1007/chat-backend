import { AppError } from '../../common/errors';
import type { ChatService } from '../chats/chat.service';
import type { LastSeenState, Message, MessageStore, ReadReceipt } from './message.types';

export interface MessagePage {
  messages: Message[];
  /** Pass as `before` to fetch the previous (older) page; null when there is nothing older. */
  nextCursor: number | null;
}

export class MessageService {
  constructor(
    private readonly chats: ChatService,
    private readonly store: MessageStore,
  ) {}

  /** 2. Send message. */
  async send(chatId: string, senderId: string, text: string): Promise<Message> {
    await this.chats.requireMember(chatId, senderId);
    return this.store.send({ chatId, senderId, text });
  }

  /** 3. Get messages, ordered by sequence (= send order). */
  async list(
    chatId: string,
    options: { limit: number; before?: number | undefined; userId?: string | undefined },
  ): Promise<MessagePage> {
    if (options.userId) await this.chats.requireMember(chatId, options.userId);
    else await this.chats.requireChat(chatId);

    // Fetch one extra to know whether an older page exists without a count query.
    const fetched = await this.store.list(chatId, { limit: options.limit + 1, beforeSeq: options.before });
    const hasMore = fetched.length > options.limit;
    const messages = hasMore ? fetched.slice(1) : fetched;
    return { messages, nextCursor: hasMore ? (messages[0]?.seq ?? null) : null };
  }

  /** 4. Mark a message read. */
  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt> {
    await this.chats.requireMember(chatId, userId);
    const message = await this.requireMessage(chatId, messageId);
    if (message.deleted) throw AppError.conflict('Message has been deleted', 'MESSAGE_DELETED');
    if (message.senderId === userId) {
      throw AppError.badRequest('Users cannot mark their own messages as read', 'OWN_MESSAGE');
    }
    const receipt = await this.store.markRead(chatId, messageId, userId);
    if (!receipt) throw this.messageNotFound(messageId);
    return receipt;
  }

  /** 5. Update the user's last seen message. */
  async updateLastSeen(
    chatId: string,
    userId: string,
    messageId: string,
  ): Promise<{ state: LastSeenState; updated: boolean }> {
    await this.chats.requireMember(chatId, userId);
    const result = await this.store.updateLastSeen(chatId, userId, messageId);
    if (!result) throw this.messageNotFound(messageId);
    return result;
  }

  async listLastSeen(chatId: string): Promise<LastSeenState[]> {
    await this.chats.requireChat(chatId);
    return this.store.listLastSeen(chatId);
  }

  // ---------- Bonus: edit / delete ----------

  async edit(chatId: string, messageId: string, userId: string, text: string): Promise<Message> {
    await this.requireOwnMessage(chatId, messageId, userId, 'edit');
    const updated = await this.store.edit(chatId, messageId, text);
    if (!updated) throw this.messageNotFound(messageId);
    return updated;
  }

  async delete(chatId: string, messageId: string, userId: string): Promise<Message> {
    const message = await this.requireOwnMessage(chatId, messageId, userId, 'delete');
    if (message.deleted) return message; // idempotent
    const deleted = await this.store.softDelete(chatId, messageId);
    if (!deleted) throw this.messageNotFound(messageId);
    return deleted;
  }

  private async requireOwnMessage(
    chatId: string,
    messageId: string,
    userId: string,
    action: 'edit' | 'delete',
  ): Promise<Message> {
    await this.chats.requireMember(chatId, userId);
    const message = await this.requireMessage(chatId, messageId);
    if (message.senderId !== userId) {
      throw AppError.forbidden(`Only the sender can ${action} a message`, 'NOT_SENDER');
    }
    if (action === 'edit' && message.deleted) {
      throw AppError.conflict('Message has been deleted', 'MESSAGE_DELETED');
    }
    return message;
  }

  private async requireMessage(chatId: string, messageId: string): Promise<Message> {
    const message = await this.store.get(chatId, messageId);
    if (!message) throw this.messageNotFound(messageId);
    return message;
  }

  private messageNotFound(messageId: string): AppError {
    return AppError.notFound(`Message ${messageId} not found`, 'MESSAGE_NOT_FOUND');
  }
}
