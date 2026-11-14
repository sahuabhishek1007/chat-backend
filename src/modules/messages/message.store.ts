import {
  FieldPath,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type FirestoreDataConverter,
  type Query,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import type { LastSeenState, Message, MessageStore, ReadReceipt } from './message.types';

/*
 * Firestore layout
 *
 * chats/{chatId}                         { lastSeq, lastMessageId, lastMessageAt, updatedAt }
 * chats/{chatId}/messages/{messageId}    MessageDoc
 * chats/{chatId}/members/{userId}        LastSeenDoc
 *
 * Read receipts live on the message itself (`readBy.{userId}`) so a page of
 * messages comes back with its receipts in one query, no fan-out reads.
 */

interface ChatMetaDoc {
  lastSeq: number;
  lastMessageId: string;
  lastMessageAt: Timestamp;
  updatedAt: Timestamp;
}

interface MessageDoc {
  senderId: string;
  text: string | null;
  seq: number;
  createdAt: Timestamp;
  editedAt: Timestamp | null;
  deletedAt: Timestamp | null;
  readBy: Record<string, Timestamp>;
}

interface LastSeenDoc {
  userId: string;
  messageId: string;
  seq: number;
  updatedAt: Timestamp;
}

/** Typed converters keep the `as` casts to this single boundary. */
function converter<T extends object>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data) => data as FirebaseFirestore.DocumentData,
    fromFirestore: (snap: QueryDocumentSnapshot) => snap.data() as T,
  };
}

const chatMetaConverter = converter<ChatMetaDoc>();
const messageConverter = converter<MessageDoc>();
const lastSeenConverter = converter<LastSeenDoc>();

const iso = (ts: Timestamp): string => ts.toDate().toISOString();

function toMessage(chatId: string, id: string, doc: MessageDoc): Message {
  return {
    id,
    chatId,
    senderId: doc.senderId,
    text: doc.text,
    seq: doc.seq,
    createdAt: iso(doc.createdAt),
    editedAt: doc.editedAt ? iso(doc.editedAt) : null,
    deletedAt: doc.deletedAt ? iso(doc.deletedAt) : null,
    deleted: doc.deletedAt !== null,
    readBy: Object.fromEntries(
      Object.entries(doc.readBy ?? {}).map(([userId, ts]) => [userId, iso(ts)]),
    ),
  };
}

function toLastSeen(chatId: string, doc: LastSeenDoc): LastSeenState {
  return {
    chatId,
    userId: doc.userId,
    messageId: doc.messageId,
    seq: doc.seq,
    updatedAt: iso(doc.updatedAt),
  };
}

export class FirestoreMessageStore implements MessageStore {
  constructor(private readonly db: Firestore) {}

  private chatRef(chatId: string): DocumentReference<ChatMetaDoc> {
    return this.db.collection('chats').doc(chatId).withConverter(chatMetaConverter);
  }

  private messages(chatId: string): CollectionReference<MessageDoc> {
    return this.db.collection('chats').doc(chatId).collection('messages').withConverter(messageConverter);
  }

  private members(chatId: string): CollectionReference<LastSeenDoc> {
    return this.db.collection('chats').doc(chatId).collection('members').withConverter(lastSeenConverter);
  }

  /**
   * Assigns the next per-chat sequence number inside a transaction. Timestamps alone
   * can't guarantee order (two messages in the same millisecond, clock skew between
   * server instances); a transactional counter gives a strict, gap-free order.
   */
  async send(input: { chatId: string; senderId: string; text: string }): Promise<Message> {
    const chatRef = this.chatRef(input.chatId);
    const messageRef = this.messages(input.chatId).doc();

    const doc = await this.db.runTransaction(async (tx) => {
      const meta = (await tx.get(chatRef)).data();
      const now = Timestamp.now();
      const message: MessageDoc = {
        senderId: input.senderId,
        text: input.text,
        seq: (meta?.lastSeq ?? 0) + 1,
        createdAt: now,
        editedAt: null,
        deletedAt: null,
        readBy: {},
      };
      tx.create(messageRef, message);
      tx.set(chatRef, {
        lastSeq: message.seq,
        lastMessageId: messageRef.id,
        lastMessageAt: now,
        updatedAt: now,
      });
      return message;
    });

    return toMessage(input.chatId, messageRef.id, doc);
  }

  async list(chatId: string, options: { limit: number; beforeSeq?: number | undefined }): Promise<Message[]> {
    let query: Query<MessageDoc> = this.messages(chatId).orderBy('seq', 'desc');
    if (options.beforeSeq !== undefined) query = query.where('seq', '<', options.beforeSeq);
    const snap = await query.limit(options.limit).get();
    // Fetched newest-first so `limit` keeps the most recent; returned oldest-first for display.
    return snap.docs.map((d) => toMessage(chatId, d.id, d.data())).reverse();
  }

  async get(chatId: string, messageId: string): Promise<Message | null> {
    const snap = await this.messages(chatId).doc(messageId).get();
    const data = snap.data();
    return data ? toMessage(chatId, snap.id, data) : null;
  }

  async markRead(chatId: string, messageId: string, userId: string): Promise<ReadReceipt | null> {
    const ref = this.messages(chatId).doc(messageId);

    return this.db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data) return null;

      const existing = data.readBy?.[userId];
      if (existing) {
        return { chatId, messageId, userId, readAt: iso(existing), alreadyRead: true };
      }

      const readAt = Timestamp.now();
      // FieldPath (not the "readBy.<id>" string) so ids with special characters are safe.
      tx.update(ref, new FieldPath('readBy', userId), readAt);
      return { chatId, messageId, userId, readAt: iso(readAt), alreadyRead: false };
    });
  }

  async edit(chatId: string, messageId: string, text: string): Promise<Message | null> {
    return this.mutate(chatId, messageId, () => ({ text, editedAt: Timestamp.now() }));
  }

  async softDelete(chatId: string, messageId: string): Promise<Message | null> {
    return this.mutate(chatId, messageId, () => ({ text: null, deletedAt: Timestamp.now() }));
  }

  async updateLastSeen(
    chatId: string,
    userId: string,
    messageId: string,
  ): Promise<{ state: LastSeenState; updated: boolean } | null> {
    const messageRef = this.messages(chatId).doc(messageId);
    const memberRef = this.members(chatId).doc(userId);

    return this.db.runTransaction(async (tx) => {
      // All transaction reads must happen before any writes.
      const [messageSnap, memberSnap] = await Promise.all([tx.get(messageRef), tx.get(memberRef)]);
      const message = messageSnap.data();
      if (!message) return null;

      const current = memberSnap.data();
      // Never move the pointer backwards (out-of-order / retried requests).
      if (current && current.seq >= message.seq) {
        return { state: toLastSeen(chatId, current), updated: false };
      }

      const next: LastSeenDoc = { userId, messageId, seq: message.seq, updatedAt: Timestamp.now() };
      tx.set(memberRef, next);
      return { state: toLastSeen(chatId, next), updated: true };
    });
  }

  async listLastSeen(chatId: string): Promise<LastSeenState[]> {
    const snap = await this.members(chatId).get();
    return snap.docs.map((d) => toLastSeen(chatId, d.data()));
  }

  private async mutate(
    chatId: string,
    messageId: string,
    changes: () => Partial<MessageDoc>,
  ): Promise<Message | null> {
    const ref = this.messages(chatId).doc(messageId);
    return this.db.runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data) return null;
      const patch = changes();
      tx.update(ref, patch);
      return toMessage(chatId, messageId, { ...data, ...patch });
    });
  }
}
