import type { AppServices } from './app';
import type { Env } from './config/env';
import { createFirestore } from './infra/firestore';
import { createMysqlPool } from './infra/mysql';
import { MysqlChatRepository } from './modules/chats/chat.repository';
import { ChatService } from './modules/chats/chat.service';
import { FirestoreMessageStore } from './modules/messages/message.store';
import { MessageService } from './modules/messages/message.service';
import { MysqlUserRepository } from './modules/users/user.repository';
import { UserService } from './modules/users/user.service';

/** Composition root: the only place that knows about concrete MySQL/Firestore classes. */
export function buildContainer(env: Env): { services: AppServices; close: () => Promise<void> } {
  const pool = createMysqlPool(env.DATABASE_URL, env.DB_POOL_MAX);
  const firestore = createFirestore(env);

  const users = new UserService(new MysqlUserRepository(pool));
  const chats = new ChatService(new MysqlChatRepository(pool), users);
  const messages = new MessageService(chats, new FirestoreMessageStore(firestore));

  return {
    services: { users, chats, messages },
    close: async () => {
      await Promise.allSettled([pool.end(), firestore.terminate()]);
    },
  };
}
