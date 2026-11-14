export interface Message {
  id: string;
  chatId: string;
  senderId: string;
  /** null once the message is deleted (tombstone keeps ordering/pagination stable). */
  text: string | null;
  /** Per-chat, gap-free, strictly increasing sequence number. This is the ordering key. */
  seq: number;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  deleted: boolean;
  /** userId -> ISO time the user read the message. */
  readBy: Record<string, string>;
}

export interface ReadReceipt {
  chatId: string;
  messageId: string;
  userId: string;
  readAt: string;
  /** true when the message had already been read; the original readAt is kept. */
  alreadyRead: boolean;
}

export interface LastSeenState {
  chatId: string;
  userId: string;
  messageId: string;
  seq: number;
  updatedAt: string;
}

export interface MessageStore {
  send(input: { chatId: string; senderId: string; text: string }): Promise<Message>;
  /** Newest `limit` messages (older than `beforeSeq` if given), returned oldest -> newest. */
  list(chatId: string, options: { limit: number; beforeSeq?: number | undefined }): Promise<Message[]>;
  get(chatId: string, messageId: string): Promise<Message | null>;
  /** Idempotent. Returns null if the message doesn't exist. */
  markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt | null>;
  edit(chatId: string, messageId: string, text: string): Promise<Message | null>;
  softDelete(chatId: string, messageId: string): Promise<Message | null>;
  /**
   * Moves the user's last-seen pointer forward only. Returns null if the message
   * doesn't exist; `updated: false` if the pointer was already at/after it.
   */
  updateLastSeen(
    chatId: string,
    userId: string,
    messageId: string,
  ): Promise<{ state: LastSeenState; updated: boolean } | null>;
  listLastSeen(chatId: string): Promise<LastSeenState[]>;
}
