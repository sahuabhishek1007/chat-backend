import { Router } from 'express';
import { z } from 'zod';
import { parse, userIdParams } from '../../common/validation';
import type { ChatService } from '../chats/chat.service';
import type { UserService } from './user.service';

const createUserBody = z.object({
  name: z.string().trim().min(1).max(100),
});

export function createUserRouter(users: UserService, chats: ChatService): Router {
  const router = Router();

  // Helper endpoint so the chat APIs can be exercised end to end.
  router.post('/', async (req, res) => {
    const { name } = parse(createUserBody, req.body);
    res.status(201).json({ data: await users.create(name) });
  });

  router.get('/:userId', async (req, res) => {
    const { userId } = parse(userIdParams, req.params);
    res.json({ data: await users.get(userId) });
  });

  // 6. List User Chats
  router.get('/:userId/chats', async (req, res) => {
    const { userId } = parse(userIdParams, req.params);
    res.json({ data: await chats.listUserChats(userId) });
  });

  return router;
}
