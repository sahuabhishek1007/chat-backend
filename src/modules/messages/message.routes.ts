import { Router } from 'express';
import { z } from 'zod';
import { chatIdParams, firestoreId, parse, uuid } from '../../common/validation';
import type { MessageService } from './message.service';

const messageText = z.string().trim().min(1, 'text must not be empty').max(4000);

const sendBody = z.object({ senderId: uuid, text: messageText });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.coerce.number().int().positive().optional(),
  userId: uuid.optional(),
});

const messageParams = z.object({ chatId: uuid, messageId: firestoreId });
const userBody = z.object({ userId: uuid });
const lastSeenBody = z.object({ userId: uuid, messageId: firestoreId });
const editBody = z.object({ userId: uuid, text: messageText });

export function createMessageRouter(messages: MessageService): Router {
  const router = Router();

  // 2. Send Message
  router.post('/:chatId/message/send', async (req, res) => {
    const { chatId } = parse(chatIdParams, req.params);
    const { senderId, text } = parse(sendBody, req.body);
    res.status(201).json({ data: await messages.send(chatId, senderId, text) });
  });

  // 3. Get Messages
  router.get('/:chatId/messages', async (req, res) => {
    const { chatId } = parse(chatIdParams, req.params);
    const query = parse(listQuery, req.query);
    res.json({ data: await messages.list(chatId, query) });
  });

  // 4. Mark Message Read
  router.post('/:chatId/message/:messageId/read', async (req, res) => {
    const { chatId, messageId } = parse(messageParams, req.params);
    const { userId } = parse(userBody, req.body);
    res.json({ data: await messages.markRead(chatId, messageId, userId) });
  });

  // 5. Update Last Seen Message
  router.post('/:chatId/lastseen', async (req, res) => {
    const { chatId } = parse(chatIdParams, req.params);
    const { userId, messageId } = parse(lastSeenBody, req.body);
    res.json({ data: await messages.updateLastSeen(chatId, userId, messageId) });
  });

  router.get('/:chatId/lastseen', async (req, res) => {
    const { chatId } = parse(chatIdParams, req.params);
    res.json({ data: await messages.listLastSeen(chatId) });
  });

  // ---- Bonus: edit / delete ----

  router.patch('/:chatId/message/:messageId', async (req, res) => {
    const { chatId, messageId } = parse(messageParams, req.params);
    const { userId, text } = parse(editBody, req.body);
    res.json({ data: await messages.edit(chatId, messageId, userId, text) });
  });

  router.delete('/:chatId/message/:messageId', async (req, res) => {
    const { chatId, messageId } = parse(messageParams, req.params);
    const { userId } = parse(userBody, req.body);
    res.json({ data: await messages.delete(chatId, messageId, userId) });
  });

  return router;
}
