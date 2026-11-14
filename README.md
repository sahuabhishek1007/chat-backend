# Chat Backend — Node.js + TypeScript, MySQL & Firebase Firestore

A chat backend that supports 1:1 chats, sending messages, strict message ordering, read receipts and last-seen tracking, plus group chats and message edit/delete (the optional bonus tasks).

- **MySQL** stores users, chats and chat membership (relational data that needs constraints and joins).
- **Firestore** stores messages, read receipts and last-seen pointers (high-volume, append-heavy data).

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js ≥ 20, TypeScript (`strict`, `noUncheckedIndexedAccess`, …) |
| HTTP | Express 5 (async errors are forwarded to the error handler natively) |
| Relational DB | MySQL 5.6.5+ / 8 via `mysql2` (parameterised queries, connection pool) |
| Document DB | Firebase Firestore via `firebase-admin` |
| Validation | `zod`: every body, param and query is parsed and typed |
| Tests | Vitest + Supertest against in-memory implementations of the storage interfaces |

## Getting started

You need Node.js 20+, a running MySQL server (5.6.5+ or 8.x) and a Firebase project with Firestore enabled.

```bash
git clone <this-repo> && cd chat-backend
npm install
cp .env.example .env     # set DATABASE_URL to your MySQL login (Windows: copy .env.example .env)
#                          and put your Firebase key at ./service-account.json (see below)
npm start                # http://localhost:5000
```

On startup, `npm start` builds the project, creates the database if it doesn't exist, and creates the tables. No separate migration step is needed. If something is missing, such as `.env`, the Firebase key or a working MySQL login, the app stops with a message saying what to fix.

Optional:
- `npm run seed` creates the demo users Alice, Bob and Charlie and prints their ids.
- `npm run dev` runs the server with reload on change, for development.
- If you don't have MySQL installed, run `docker compose up -d mysql` and use `DATABASE_URL=mysql://chat:chat@localhost:3306/chat`.

### Firebase setup

1. In the Firebase console, create a Firestore database.
2. Go to **Project settings → Service accounts → Generate new private key** and save the file as `service-account.json` in the project root. It is git-ignored.
3. Set `FIREBASE_PROJECT_ID` and `FIREBASE_SERVICE_ACCOUNT_PATH` in `.env`.

To work locally without a real project, run the Firestore emulator (`firebase emulators:start --only firestore`) and set `FIRESTORE_EMULATOR_HOST=localhost:8080`.

`firestore.rules` denies all direct client access. Only this backend, through the Admin SDK, can read or write messages.

### Scripts

| Script | What it does |
| --- | --- |
| `npm start` | Builds, creates the database and tables, and starts the server |
| `npm run dev` | Starts the server with reload on change (tsx) |
| `npm run build` | Compiles to `dist/` |
| `npm run migrate` | Applies pending migrations on its own (`npm start` already does this) |
| `npm run seed` | Inserts demo users |
| `npm test` | Runs the API test suite |
| `npm run typecheck` | Runs `tsc --noEmit` over the source and tests |

## API

All responses use the envelope `{ "data": ... }`. Errors use `{ "error": { "code", "message", "details?" } }`. IDs are UUIDs. A Postman collection is in [`postman/`](postman/chat-backend.postman_collection.json).

### Required endpoints

| # | Method & path | Body / query | Notes |
| --- | --- | --- | --- |
| 1 | `POST /chat/create` | `{ userAId, userBId }` | Returns `{ chatId, created }`: `201` when the chat is new, `200` when it already existed. The order of the two users doesn't matter. |
| 2 | `POST /chat/:chatId/message/send` | `{ senderId, text }` | The sender must be a member. Stores the message in Firestore with `createdAt` and a per-chat `seq`. |
| 3 | `GET /chat/:chatId/messages` | `?limit=50&before=<seq>&userId=<id>` | Returns the newest `limit` messages (max 100), oldest first, with their read receipts. `nextCursor` is the value to pass as `before` to get older messages. `userId` is optional and turns on the membership check. |
| 4 | `POST /chat/:chatId/message/:messageId/read` | `{ userId }` | Idempotent: repeating the call keeps the first `readAt`. A user can't mark their own message as read. |
| 5 | `POST /chat/:chatId/lastseen` | `{ userId, messageId }` | Returns `{ state, updated }`. The pointer only moves forward, so a stale or retried request can't move it back. |
| 6 | `GET /user/:userId/chats` | — | Returns the user's chats from MySQL with `memberIds`, most recently updated first. |

### Supporting and bonus endpoints

| Method & path | Body | Notes |
| --- | --- | --- |
| `POST /user` | `{ name }` | Creates a user |
| `GET /user/:userId` | — | |
| `GET /chat/:chatId` | — | Chat details with members and roles |
| `GET /chat/:chatId/lastseen` | — | Last-seen state of every member |
| `POST /chat/group` | `{ creatorId, name, memberIds[] }` | The creator becomes the group admin |
| `PATCH /chat/:chatId` | `{ requesterId, name }` | Renames the group (admin only) |
| `POST /chat/:chatId/members` | `{ requesterId, userIds[] }` | Adds members (admin only) |
| `DELETE /chat/:chatId/members/:userId` | `{ requesterId }` | An admin can remove anyone; any member can remove themselves. If the last admin leaves, the longest-standing member is promoted. |
| `PATCH /chat/:chatId/message/:messageId` | `{ userId, text }` | Edits a message (sender only). Sets `editedAt`. |
| `DELETE /chat/:chatId/message/:messageId` | `{ userId }` | Soft delete (sender only). The message stays as a tombstone with `text: null`, so ordering and pagination don't shift. |

### Example

```bash
curl -X POST localhost:5000/chat/create -H 'Content-Type: application/json' \
  -d '{"userAId":"<alice>","userBId":"<bob>"}'
# {"data":{"chatId":"5b0c…","created":true}}

curl -X POST localhost:5000/chat/5b0c…/message/send -H 'Content-Type: application/json' \
  -d '{"senderId":"<alice>","text":"Hi Bob"}'
# {"data":{"id":"Xk3…","seq":1,"text":"Hi Bob","createdAt":"…","readBy":{},…}}

curl 'localhost:5000/chat/5b0c…/messages?limit=50'
# {"data":{"messages":[…],"nextCursor":null}}
```

## Data model

### MySQL ([`db/migrations/001_init.sql`](db/migrations/001_init.sql))

```
users         (id PK, name, created_at)
chats         (id PK, type ENUM('direct','group'), name, direct_key UNIQUE, created_by FK, created_at, updated_at)
chat_members  (chat_id FK, user_id FK, role ENUM('admin','member'), joined_at)  PK(chat_id, user_id), INDEX(user_id)
```

### Firestore

```
chats/{chatId}                        { lastSeq, lastMessageId, lastMessageAt, updatedAt }
chats/{chatId}/messages/{messageId}   { senderId, text, seq, createdAt, editedAt, deletedAt, readBy: { [userId]: Timestamp } }
chats/{chatId}/members/{userId}       { userId, messageId, seq, updatedAt }        ← last seen
```

## Design decisions

- **Race-safe "create or get".** A 1:1 chat gets a `direct_key` made of the two user ids, sorted and joined. A `UNIQUE` key on that column means two concurrent requests can never create duplicate chats. The request that loses the race gets `ER_DUP_ENTRY` and returns the winner's chat.
- **Strict message ordering.** Timestamps alone don't guarantee order: two messages can arrive in the same millisecond, and server clocks can drift. Each send runs a Firestore transaction that increments `chats/{chatId}.lastSeq` and writes the message with that `seq`. Messages are ordered and paginated by `seq`. This is a cursor, not an offset, so new messages arriving between page loads don't shift the pages. Trade-off: Firestore handles about 1 sustained write per second per document, which is plenty for a single conversation. A very busy group chat would need a sharded counter or ordering by `createdAt` plus id.
- **Read receipts on the message document.** Each receipt is stored in `readBy.{userId}`, so a page of messages comes back with its receipts in one query instead of N extra reads. The update uses a `FieldPath`, so a user id can never be read as a nested field path.
- **Last seen only moves forward.** The update compares the stored `seq` with the new message's `seq` inside a transaction. Out-of-order or retried client calls can't move the pointer back.
- **Membership is checked in MySQL before every message operation.** MySQL holds membership, so a user who isn't in a chat can't send, read or move their last-seen pointer in it.
- **Safe concurrent group changes.** Member changes lock the chat row (`SELECT … FOR UPDATE`), so two admins leaving at the same moment can't leave a group with no admin.
- **Layered, testable code.** Routes validate input, services hold the business rules, and repositories/stores hold the storage code. Services depend on interfaces (`UserRepository`, `ChatRepository`, `MessageStore`). `container.ts` is the only file that wires in MySQL and Firestore, and the tests replace them with in-memory versions.
- **Input hardening.** UUIDs are lower-cased so that `ABC…` and `abc…` are the same user. Message IDs must match `^[A-Za-z0-9_-]+$`, so `/` can't be used to reach other Firestore paths. Message text is limited to 4,000 characters and request bodies to 100 KB.
- **Two databases, no distributed transaction.** Chats are created in MySQL; messages go to Firestore only after MySQL has confirmed the chat and the membership. The one cross-store link, the chat id, is therefore always valid when a Firestore write happens.

### Out of scope / next steps

- **Authentication.** The spec passes user ids in the request, so this backend trusts them. In production the acting user would come from a verified token, such as a Firebase ID token checked in middleware, and `senderId`/`userId` would be removed from request bodies.
- Real-time delivery to clients: Firestore listeners on the client, or WebSockets/SSE from this service.
- Rate limiting, structured logging and request IDs.
- Integration tests against MySQL and the Firestore emulator, run in CI.

## Project structure

```
src/
  app.ts                 Express app factory (dependency-injected services)
  server.ts              Entry point + graceful shutdown
  container.ts           Composition root (MySQL + Firestore wiring)
  config/env.ts          Validated environment variables
  infra/                 MySQL pool/transactions, Firebase Admin init
  common/                AppError, zod helpers, error/404 handlers
  db/                    migrate + seed scripts
  modules/
    users/               routes · service · repository · types
    chats/               routes · service · repository (MySQL) · types
    messages/            routes · service · store (Firestore) · types
tests/
  api.test.ts            End-to-end HTTP tests
  support/fakes.ts       In-memory UserRepository / ChatRepository / MessageStore
db/migrations/           SQL schema
postman/                 Postman collection
```
