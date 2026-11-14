export type ChatType = 'direct' | 'group';
export type MemberRole = 'admin' | 'member';

export interface Chat {
  id: string;
  type: ChatType;
  /** Always null for 1:1 chats. */
  name: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMember {
  userId: string;
  role: MemberRole;
  joinedAt: Date;
}

/** Shape returned by "list user chats". */
export interface ChatSummary extends Chat {
  memberIds: string[];
}

export interface ChatDetails extends Chat {
  members: ChatMember[];
}

export interface ChatRepository {
  /** Race-safe: concurrent calls for the same pair always resolve to one chat. */
  findOrCreateDirect(userAId: string, userBId: string): Promise<{ chatId: string; created: boolean }>;
  /** Creator becomes admin; `memberIds` must not include the creator. Returns the new chat id. */
  createGroup(input: { creatorId: string; name: string; memberIds: string[] }): Promise<string>;
  findById(chatId: string): Promise<Chat | null>;
  findMember(chatId: string, userId: string): Promise<ChatMember | null>;
  listMembers(chatId: string): Promise<ChatMember[]>;
  listForUser(userId: string): Promise<ChatSummary[]>;
  rename(chatId: string, name: string): Promise<void>;
  /** Adds users as plain members; users already in the chat are ignored. */
  addMembers(chatId: string, userIds: string[]): Promise<void>;
  /** Removes a member; if no admin is left, the longest-standing member is promoted. */
  removeMember(chatId: string, userId: string): Promise<void>;
}

/** Order-independent key for a 1:1 chat, so (A,B) and (B,A) map to the same row. */
export function directChatKey(userAId: string, userBId: string): string {
  return [userAId, userBId].sort().join(':');
}
