import express, { type Express } from 'express';
import { errorHandler, notFoundHandler } from './common/http';
import { createChatRouter } from './modules/chats/chat.routes';
import type { ChatService } from './modules/chats/chat.service';
import { createMessageRouter } from './modules/messages/message.routes';
import type { MessageService } from './modules/messages/message.service';
import { createUserRouter } from './modules/users/user.routes';
import type { UserService } from './modules/users/user.service';

export interface AppServices {
  users: UserService;
  chats: ChatService;
  messages: MessageService;
}

/** Builds the HTTP app from already-wired services (real ones in prod, in-memory in tests). */
export function createApp(services: AppServices): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/', (_req, res) => {
    res.json({
      name: 'Chat Backend',
      status: 'running',
      endpoints: [
        'POST   /user                                  { name }',
        'POST   /chat/create                           { userAId, userBId }',
        'POST   /chat/:chatId/message/send             { senderId, text }',
        'GET    /chat/:chatId/messages?limit=50',
        'POST   /chat/:chatId/message/:messageId/read  { userId }',
        'POST   /chat/:chatId/lastseen                 { userId, messageId }',
        'GET    /user/:userId/chats',
      ],
      docs: 'See README.md for all endpoints (including group chats and edit/delete).',
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/user', createUserRouter(services.users, services.chats));
  app.use('/chat', createChatRouter(services.chats));
  app.use('/chat', createMessageRouter(services.messages));

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
