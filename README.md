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

## Quick check (no setup needed)

Run the full API test suite. It uses in-memory storage, so it needs no MySQL or Firebase:

```bash
git clone https://github.com/sahuabhishek1007/chat-backend.git
cd chat-backend
npm install
npm test
```

## Fastest way to run (using the bundled `key/` folder)

The `key/` folder contains a ready-made `.env` and the Firebase `service-account.json`. The app reads `key/.env` automatically when there's no `.env` in the project root. If your MySQL login is different, edit `DATABASE_URL` in `key/.env`.

```bash
git clone https://github.com/sahuabhishek1007/chat-backend.git
cd chat-backend
npm install
npm start
```

To use your own MySQL or Firebase instead, follow the steps below. A root `.env` always takes priority over `key/.env`.

## How to run the project

### Step 1: Install the requirements

| Requirement | Version | Download |
| --- | --- | --- |
| Node.js | 20 or newer | https://nodejs.org (LTS) |
| MySQL | 5.6.5+ or 8.x | https://dev.mysql.com/downloads/installer/ (or use Docker, see Step 4) |
| A Firebase project | free Spark plan is enough | https://console.firebase.google.com |

To check Node.js, run `node -v`. It should print `v20` or higher.

### Step 2: Clone the repo and install packages

```bash
git clone https://github.com/sahuabhishek1007/chat-backend.git
cd chat-backend
npm install
```

### Step 3: Create the `.env` file

Copy the template:

```bash
# Windows (cmd / PowerShell)
copy .env.example .env

# macOS / Linux
cp .env.example .env
```

Open `.env` and fill it in:

```env
NODE_ENV=development
PORT=5000

# MySQL: mysql://<user>:<password>@<host>:<port>/<database>
DATABASE_URL=mysql://root:yourpassword@localhost:3306/chat
DB_POOL_MAX=10

# Firebase
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_SERVICE_ACCOUNT_PATH=./service-account.json
FIRESTORE_EMULATOR_HOST=
```

- **DATABASE_URL:** use your own MySQL username and password. The database (`chat` above) doesn't need to exist; the app creates it. If the password contains `@ # : /`, URL-encode it (for example, `@` becomes `%40`).
- **FIREBASE_PROJECT_ID:** your Firebase project ID. It's shown in Firebase console → Project settings → General.

### Step 4: Set up MySQL

Use either option.

**A. MySQL already installed:** make sure the MySQL service is running and that the user/password in `DATABASE_URL` can log in. That's all; tables are created automatically in Step 6.

**B. No MySQL, but you have Docker:**

```bash
docker compose up -d mysql
```

Then set this in `.env`:

```env
DATABASE_URL=mysql://chat:chat@localhost:3306/chat
```

### Step 5: Set up Firebase

1. Open https://console.firebase.google.com and create a project, or open an existing one.
2. In the left menu, click **Build → Firestore Database → Create database**. Pick any location and **Production mode**, then click **Create**.
3. Click the **gear icon → Project settings → Service accounts** tab.
4. Click **Generate new private key**, then **Generate key**. A `.json` file downloads.
5. Rename it to `service-account.json` and put it in the project root, next to `package.json`.

> ⚠️ `service-account.json` gives full access to your Firebase project. Never commit or share it. It is already in `.gitignore`.

Not using a real Firebase project? Run the [Firestore emulator](https://firebase.google.com/docs/emulator-suite) (`firebase emulators:start --only firestore`) and set `FIRESTORE_EMULATOR_HOST=localhost:8080` in `.env`. You can then leave `FIREBASE_SERVICE_ACCOUNT_PATH` empty.

### Step 6: Start the server

```bash
npm start
```

This builds the TypeScript, creates the MySQL database and tables if they don't exist, and starts the API. You should see:

```
[migrate] applied 001_init.sql
Chat backend listening on http://localhost:5000
```

Open http://localhost:5000 in a browser. It shows `"status": "running"` and the list of endpoints.

For development with reload on file changes, use `npm run dev` instead.

### Step 7: Test the APIs with Postman

1. Open Postman and click **Import** (or press Ctrl+O).
2. Select `postman/chat-backend.postman_collection.json` from this repo.
3. Open the **Chat Backend** collection and run the requests **top to bottom**:
   - **Users** creates 3 users.
   - **Required APIs 1–6** creates a chat, then sends, lists, marks read, updates last seen and lists chats.
   - **Bonus** covers edit/delete messages and group chats.

   To run everything in one go, click **⋯ → Run collection → Run Chat Backend**.

You don't need to copy any ids by hand. Each request saves the ids it creates (users, chat, message) into collection variables, and later requests use them.

Prefer the command line? Optionally run `npm run seed` to create the demo users Alice, Bob and Charlie and print their ids, then use the `curl` examples in [API](#api).

### Troubleshooting

| Message | Fix |
| --- | --- |
| `Could not read package.json` | Run the commands inside the `chat-backend` folder. |
| `Invalid environment configuration … DATABASE_URL: Required` | The `.env` file is missing. Do Step 3. |
| `Cannot reach MySQL` | MySQL isn't running, or the host/port in `DATABASE_URL` is wrong. |
| `MySQL rejected the username/password` | Fix the user/password in `DATABASE_URL`. |
| `Firebase key not found at …` | Put `service-account.json` in the project root (Step 5). |
| `5 NOT_FOUND` from Firestore | The Firestore database hasn't been created in the Firebase console (Step 5.2). |
| `EADDRINUSE :5000` | Port 5000 is busy. Change `PORT` in `.env`. |
| Postman: `ECONNREFUSED` | The server isn't running. Run `npm start`. |

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
