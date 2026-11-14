import { Router } from 'express';
import { z } from 'zod';
import { chatIdParams, parse, uuid } from '../../common/validation';
import type { ChatService } from './chat.service';

const createDirectBody = z.object({ userAId: uuid, userBId: uuid });

const groupName = z.string().trim().min(1).max(100);

const createGroupBody = z.object({
  creatorId: uuid,
  name: groupName,
  memberIds: z.array(uuid).min(1).max(255),
});

const renameBody = z.object({ requesterId: uuid, name: groupName });

const addMembersBody = z.object({
  requesterId: uuid,
  userIds: z.array(uuid).min(1).max(255),
});

const removeMemberParams = z.object({ chatId: uuid, userId: uuid });
const requesterBody = z.object({ requesterId: uuid });

export function createChatRouter(chats: ChatService): Router {
  const router = Router();

  // 1. Create or Get Chat
  router.post('/create', async (req, res) => {
    const { userAId, userBId } = parse(createDirectBody, req.body);
    const result = await chats.createOrGetDirect(userAId, userBId);
    res.status(result.created ? 201 : 200).json({ data: result });
  });

  // ---- Bonus: group chat management ----

  router.post('/group', async (req, res) => {
    const { creatorId, name, memberIds } = parse(createGroupBody, req.body);
    res.status(201).json({ data: await chats.createGroup(creatorId, name, memberIds) });
  });

  router.get('/:chatId', async (req, res) => {
    const { chatId } = parse(chatIdParams, req.params);
    res.json({ data: await chats.getDetails(chatId) });
  });

  router.patch('/:chatId', async (req, res) => {
    const { chatId } = parse(chatIdParams, req.params);
    const { requesterId, name } = parse(renameBody, req.body);
    res.json({ data: await chats.renameGroup(chatId, requesterId, name) });
  });

  router.post('/:chatId/members', async (req, res) => {
    const { chatId } = parse(chatIdParams, req.params);
    const { requesterId, userIds } = parse(addMembersBody, req.body);
    res.json({ data: await chats.addMembers(chatId, requesterId, userIds) });
  });

  router.delete('/:chatId/members/:userId', async (req, res) => {
    const { chatId, userId } = parse(removeMemberParams, req.params);
    const { requesterId } = parse(requesterBody, req.body);
    await chats.removeMember(chatId, requesterId, userId);
    res.status(204).end();
  });

  return router;
}
