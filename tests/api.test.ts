import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app';
import { buildInMemoryServices } from './support/fakes';

let app: Express;

async function createUser(name: string): Promise<string> {
  const res = await request(app).post('/user').send({ name }).expect(201);
  return res.body.data.id as string;
}

async function createChat(userAId: string, userBId: string): Promise<string> {
  const res = await request(app).post('/chat/create').send({ userAId, userBId });
  return res.body.data.chatId as string;
}

async function send(chatId: string, senderId: string, text: string) {
  const res = await request(app).post(`/chat/${chatId}/message/send`).send({ senderId, text }).expect(201);
  return res.body.data as { id: string; seq: number; text: string };
}

beforeEach(() => {
  app = createApp(buildInMemoryServices());
});

describe('POST /chat/create', () => {
  it('creates a chat once and returns the same chat for either user order', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');

    const first = await request(app).post('/chat/create').send({ userAId: alice, userBId: bob }).expect(201);
    expect(first.body.data.created).toBe(true);

    const again = await request(app).post('/chat/create').send({ userAId: bob, userBId: alice }).expect(200);
    expect(again.body.data).toEqual({ chatId: first.body.data.chatId, created: false });
  });

  it('treats UUIDs case-insensitively', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const chatId = await createChat(alice, bob);
    const res = await request(app).post('/chat/create').send({ userAId: alice.toUpperCase(), userBId: bob }).expect(200);
    expect(res.body.data.chatId).toBe(chatId);
  });

  it('validates input', async () => {
    const alice = await createUser('Alice');
    const res = await request(app).post('/chat/create').send({ userAId: 'nope' }).expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const self = await request(app).post('/chat/create').send({ userAId: alice, userBId: alice }).expect(400);
    expect(self.body.error.code).toBe('SAME_USER');
  });

  it('returns 404 for unknown users', async () => {
    const alice = await createUser('Alice');
    const ghost = randomUUID();
    const res = await request(app).post('/chat/create').send({ userAId: alice, userBId: ghost }).expect(404);
    expect(res.body.error.details.missing).toEqual([ghost]);
  });

  it('rejects malformed JSON', async () => {
    const res = await request(app)
      .post('/chat/create')
      .set('Content-Type', 'application/json')
      .send('{"userAId":')
      .expect(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('messages', () => {
  let alice: string;
  let bob: string;
  let chatId: string;

  beforeEach(async () => {
    alice = await createUser('Alice');
    bob = await createUser('Bob');
    chatId = await createChat(alice, bob);
  });

  it('sends and lists messages in send order', async () => {
    await send(chatId, alice, 'hi');
    await send(chatId, bob, 'hello');
    await send(chatId, alice, 'how are you?');

    const res = await request(app).get(`/chat/${chatId}/messages`).expect(200);
    const { messages, nextCursor } = res.body.data;
    expect(messages.map((m: { text: string }) => m.text)).toEqual(['hi', 'hello', 'how are you?']);
    expect(messages.map((m: { seq: number }) => m.seq)).toEqual([1, 2, 3]);
    expect(nextCursor).toBeNull();
  });

  it('paginates: limit returns the newest messages, `before` walks backwards', async () => {
    for (let i = 1; i <= 5; i++) await send(chatId, alice, `m${i}`);

    const page1 = await request(app).get(`/chat/${chatId}/messages?limit=2`).expect(200);
    expect(page1.body.data.messages.map((m: { text: string }) => m.text)).toEqual(['m4', 'm5']);
    expect(page1.body.data.nextCursor).toBe(4);

    const page2 = await request(app).get(`/chat/${chatId}/messages?limit=2&before=4`).expect(200);
    expect(page2.body.data.messages.map((m: { text: string }) => m.text)).toEqual(['m2', 'm3']);

    const page3 = await request(app).get(`/chat/${chatId}/messages?limit=2&before=2`).expect(200);
    expect(page3.body.data.messages.map((m: { text: string }) => m.text)).toEqual(['m1']);
    expect(page3.body.data.nextCursor).toBeNull();
  });

  it('rejects senders who are not members, empty text and bad limits', async () => {
    const eve = await createUser('Eve');
    const res = await request(app).post(`/chat/${chatId}/message/send`).send({ senderId: eve, text: 'hey' }).expect(403);
    expect(res.body.error.code).toBe('NOT_A_MEMBER');

    await request(app).post(`/chat/${chatId}/message/send`).send({ senderId: alice, text: '   ' }).expect(400);
    await request(app).get(`/chat/${chatId}/messages?limit=500`).expect(400);
  });

  it('returns 404 for an unknown chat', async () => {
    const res = await request(app).get(`/chat/${randomUUID()}/messages`).expect(404);
    expect(res.body.error.code).toBe('CHAT_NOT_FOUND');
  });

  it('marks a message read idempotently and shows it in the message list', async () => {
    const msg = await send(chatId, alice, 'read me');

    const first = await request(app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: bob }).expect(200);
    expect(first.body.data.alreadyRead).toBe(false);

    const second = await request(app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: bob }).expect(200);
    expect(second.body.data).toMatchObject({ alreadyRead: true, readAt: first.body.data.readAt });

    const list = await request(app).get(`/chat/${chatId}/messages`).expect(200);
    expect(list.body.data.messages[0].readBy).toEqual({ [bob]: first.body.data.readAt });
  });

  it('rejects read receipts for own messages, non-members and unknown messages', async () => {
    const msg = await send(chatId, alice, 'mine');
    const eve = await createUser('Eve');

    await request(app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: alice }).expect(400);
    await request(app).post(`/chat/${chatId}/message/${msg.id}/read`).send({ userId: eve }).expect(403);
    await request(app).post(`/chat/${chatId}/message/doesNotExist/read`).send({ userId: bob }).expect(404);
  });

  it('only moves the last-seen pointer forward', async () => {
    const m1 = await send(chatId, alice, 'one');
    const m2 = await send(chatId, alice, 'two');

    const forward = await request(app).post(`/chat/${chatId}/lastseen`).send({ userId: bob, messageId: m2.id }).expect(200);
    expect(forward.body.data).toMatchObject({ updated: true, state: { messageId: m2.id, seq: 2 } });

    const backward = await request(app).post(`/chat/${chatId}/lastseen`).send({ userId: bob, messageId: m1.id }).expect(200);
    expect(backward.body.data).toMatchObject({ updated: false, state: { messageId: m2.id, seq: 2 } });

    const states = await request(app).get(`/chat/${chatId}/lastseen`).expect(200);
    expect(states.body.data).toHaveLength(1);
  });

  it('lets only the sender edit or delete, and keeps deleted messages as tombstones', async () => {
    const msg = await send(chatId, alice, 'typo');

    await request(app).patch(`/chat/${chatId}/message/${msg.id}`).send({ userId: bob, text: 'hacked' }).expect(403);

    const edited = await request(app).patch(`/chat/${chatId}/message/${msg.id}`).send({ userId: alice, text: 'fixed' }).expect(200);
    expect(edited.body.data).toMatchObject({ text: 'fixed', seq: 1 });
    expect(edited.body.data.editedAt).not.toBeNull();

    const deleted = await request(app).delete(`/chat/${chatId}/message/${msg.id}`).send({ userId: alice }).expect(200);
    expect(deleted.body.data).toMatchObject({ deleted: true, text: null });

    await request(app).patch(`/chat/${chatId}/message/${msg.id}`).send({ userId: alice, text: 'again' }).expect(409);

    const list = await request(app).get(`/chat/${chatId}/messages`).expect(200);
    expect(list.body.data.messages).toHaveLength(1);
    expect(list.body.data.messages[0].deleted).toBe(true);
  });
});

describe('GET /user/:userId/chats', () => {
  it('lists every chat the user is in with member ids', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');
    const ab = await createChat(alice, bob);
    const ac = await createChat(alice, carol);

    const res = await request(app).get(`/user/${alice}/chats`).expect(200);
    const chats = res.body.data as { id: string; memberIds: string[] }[];
    expect(chats.map((c) => c.id).sort()).toEqual([ab, ac].sort());
    expect(chats.find((c) => c.id === ab)?.memberIds.sort()).toEqual([alice, bob].sort());

    const bobs = await request(app).get(`/user/${bob}/chats`).expect(200);
    expect(bobs.body.data).toHaveLength(1);
  });

  it('returns 404 for an unknown user', async () => {
    await request(app).get(`/user/${randomUUID()}/chats`).expect(404);
  });
});

describe('group chats', () => {
  it('creates, renames and manages members with admin rules', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const carol = await createUser('Carol');

    const created = await request(app)
      .post('/chat/group')
      .send({ creatorId: alice, name: 'Team', memberIds: [bob] })
      .expect(201);
    const group = created.body.data;
    expect(group.type).toBe('group');
    expect(group.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: alice, role: 'admin' }),
        expect.objectContaining({ userId: bob, role: 'member' }),
      ]),
    );

    // Non-admins can't rename or add people
    await request(app).patch(`/chat/${group.id}`).send({ requesterId: bob, name: 'Mine' }).expect(403);
    await request(app).post(`/chat/${group.id}/members`).send({ requesterId: bob, userIds: [carol] }).expect(403);

    const renamed = await request(app).patch(`/chat/${group.id}`).send({ requesterId: alice, name: 'Core team' }).expect(200);
    expect(renamed.body.data.name).toBe('Core team');

    const added = await request(app).post(`/chat/${group.id}/members`).send({ requesterId: alice, userIds: [carol] }).expect(200);
    expect(added.body.data.members).toHaveLength(3);

    // Members can't remove others, but can leave
    await request(app).delete(`/chat/${group.id}/members/${carol}`).send({ requesterId: bob }).expect(403);
    await request(app).delete(`/chat/${group.id}/members/${bob}`).send({ requesterId: bob }).expect(204);

    // Group messaging works for members
    await send(group.id, carol, 'hi team');

    // When the last admin leaves, the longest-standing member is promoted
    await request(app).delete(`/chat/${group.id}/members/${alice}`).send({ requesterId: alice }).expect(204);
    const details = await request(app).get(`/chat/${group.id}`).expect(200);
    expect(details.body.data.members).toEqual([expect.objectContaining({ userId: carol, role: 'admin' })]);
  });

  it('refuses group operations on 1:1 chats', async () => {
    const alice = await createUser('Alice');
    const bob = await createUser('Bob');
    const chatId = await createChat(alice, bob);
    const res = await request(app).patch(`/chat/${chatId}`).send({ requesterId: alice, name: 'x' }).expect(400);
    expect(res.body.error.code).toBe('NOT_A_GROUP');
  });
});
