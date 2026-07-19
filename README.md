# 💬 BTC2 API

A secure WebSocket-enabled REST API for real-time messaging — direct and group chats, link previews, and push notifications.

## 🛠️ Tech Stack

<div align="center">

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white)
![Socket.IO](https://img.shields.io/badge/Socket.IO-010101?style=for-the-badge&logo=socket.io&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

</div>

## 📑 Table of Contents

- [✨ Features](#-features)
- [🚀 Setup](#-setup)
- [⚙️ Environment Configuration](#️-environment-configuration)
- [🏗️ Architecture](#️-architecture)
  - [🔑 Authentication & Tokens](#-authentication--tokens)
  - [💬 Conversations (direct + group chat)](#-conversations-direct--group-chat)
  - [🔗 Link Previews](#-link-previews)
  - [🔌 Socket.IO](#-socketio)
- [📡 API Reference](#-api-reference)
- [🐳 Deployment](#-deployment)

## ✨ Features

- Signup, login, logout with **rotating refresh tokens** (sliding 14-day session, no forced weekly re-login)
- Direct (1:1) **and group** conversations, unified under one conversation model
- Group roles (owner/admin/member), member add/remove, rename/avatar
- Cursor-paginated message history with per-user unread counts and per-user "clear history"
- Image uploads in messages (direct or group)
- **Link previews** — server-side Open Graph fetch + image proxy, SSRF-guarded and cached
- Friends: send/accept/reject/remove requests, block/unblock, report for moderation
- Update nickname/unique ID/profile image/email/password
- Forgot username, forgot password
- Push notifications via Firebase (sent when a recipient has no active socket connection)
- Real-time delivery via Socket.IO, with soft-enforced JWT handshake auth
- Delete account (cascades conversations, messages, and friend references)

## 🚀 Setup

### Prerequisites

- Node.js 20+
- MongoDB
- Firebase Admin Account for push notifications
- Docker (optional)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/beetron/btc2-api
   cd btc2-api
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure environment variables (see below), then start the server:
   ```bash
   npm run server   # nodemon, for development
   npm start        # node, for production
   ```

## ⚙️ Environment Configuration

Set the following environment variables in your deployment environment or a `.env` file:

```env
# MongoDB connection
MONGO_DB_URI=mongodb://username:password@example.com:27017/

# JWT secret used to sign access tokens
JWT_SECRET=key

# Server port (default: 3000)
PORT=3000

# CORS origins (comma-separated)
CORS_ORIGIN=https://yourapp.com,https://app.yourapp.com

# SMTP configuration for email sending
SMTP_HOST=mail.example.com
SMTP_USER=from@example.com
SMTP_PASS="password"
SMTP_FROM="BTC2-Notifications <from@example.com>"

# Admin email for user reports
ADMIN_EMAIL=admin@yourapp.com

# Prometheus metrics configuration
ENABLE_METRICS=false          # set to true to enable metrics collection
METRICS_PORT=9090             # port for Prometheus metrics endpoint (default: 9090)

# Socket.IO handshake auth -- rollout flag, meant to be temporary.
# false: a missing/invalid JWT is tolerated (soft enforcement, back-compat
#        with pre-JWT clients).
# true:  a missing/invalid/expired JWT rejects the handshake outright.
# Flip this once every live client (web + mobile) reliably sends
# `auth: { token }` on connect, then remove the flag and the fallback
# path in src/socket/socket.js entirely -- it's scaffolding for the
# migration, not a permanent runtime setting.
SOCKET_REQUIRE_AUTH=false

# Node environment
NODE_ENV=production   # for production
FIREBASE_KEY # for production - fcm key json
NODE_ENV=development  # for development
```

## 🏗️ Architecture

- API version is tracked in `package.json` and used for docker image versioning.
- Profile images are stored in `/src/uploads/images` via `multer` + `sharp`; message/conversation images share the same storage with automatic cleanup once no message references them.
- Push notifications (Firebase) are only sent to a recipient with no active socket connection — connected clients get the update over Socket.IO instead.
- User reports are emailed to administrators for moderation.
- Account deletion cascades: direct conversations are deleted outright; group conversations are left (the account just leaves, so remaining members keep their history).
- **Prometheus metrics** (optional) available on `METRICS_PORT` when `ENABLE_METRICS=true`
  - HTTP request metrics (duration, total count)
  - Custom API metrics (messages, friend requests, user registrations)
  - Socket.IO connection tracking
  - System metrics (CPU, memory, uptime)

### 🔑 Authentication & Tokens

Every login/signup issues **two tokens**:

| Token | Format | Lifetime | Purpose |
|---|---|---|---|
| Access token | JWT | 7 days | Sent as `Authorization: Bearer <token>` on every request and as `auth: { token }` on the Socket.IO handshake |
| Refresh token | Opaque random (384-bit) | 14 days, **sliding** | Exchanged via `POST /auth/refresh` for a new access + refresh pair |

- The refresh token is **rotated on every use** (one-time use, enforced atomically at the DB level): each call to `/auth/refresh` deletes the old one and issues a new one with a fresh 14-day expiry. A client that returns at least once every 14 days never has to re-enter credentials; one that goes quiet longer must log in again.
- Only a **hash** of the refresh token is stored (`RefreshToken` model), the same rationale as password hashing — a database leak alone can't be used to impersonate a session.
- `POST /auth/logout` revokes the refresh token server-side immediately, rather than only relying on the client discarding it.
- Access tokens are otherwise stateless (no server-side revocation) — this is the standard JWT tradeoff; a compromised access token is bounded by its 7-day expiry.

### 💬 Conversations (direct + group chat)

Direct (1:1) and group chats share a single `Conversation` model.

- **Direct** conversations are found-or-created on demand (`POST /conversations/direct`) — a `directKey` derived from the sorted pair of user IDs prevents duplicates.
- **Group** conversations have members with a role: `owner` (creator), `admin`, or `member`. Only an owner/admin can rename a group or remove another member; anyone can add their own friends and can remove themselves (leave).
- Adding someone to a group requires the *actor* to be friends with them — there's no requirement that all group members be mutual friends with each other (same model most chat apps use: whoever adds you vouches for you, not everyone already knows everyone).
- Message history is **cursor-paginated** (`GET /conversations/:id/messages`), newest page first.
- Each member has a per-conversation read state: `unreadCount` (reset on load) and an optional `clearedAt` (per-viewer "delete history" — for a direct conversation, once both members have cleared everything, the conversation and its messages are deleted outright; group history clearing never deletes the conversation for other members).
- The legacy `/messages/*` routes (`send/:id`, `get/:id`, `upload/:id`, `delete/:id`) still work and are backed by the same conversation model under the hood (they find-or-create the direct conversation for you) — kept for simple 1:1 messaging and older clients that haven't migrated to the `/conversations` endpoints.

### 🔗 Link Previews

`GET /link-preview?url=` fetches a URL's Open Graph metadata **server-side** and returns `{ title, description, image, siteName }` (empty fields if none found).

- Doing this server-side (rather than in the browser) avoids CORS entirely and keeps the *requester's* IP hidden from whatever site the link points to.
- **SSRF-guarded**: only `http`/`https` URLs are fetched; the resolved IP is checked against loopback/private/link-local/reserved ranges (including the `169.254.169.254` cloud metadata address) before connecting, and every redirect hop is re-validated rather than followed blindly.
- Capped response size and timeout; only `text/html` responses are parsed.
- Results are cached in Mongo (`LinkPreview` model) — 24h for a successful fetch, 1h for a failed one, so a broken link gets retried without hammering it every time it's rendered.
- `GET /link-preview/image?url=` proxies the preview's image through the backend too, for the same IP-hiding reason — the browser never contacts the linked site directly, even for the thumbnail.

### 🔌 Socket.IO

- Path: `/socket.io` (versioning handled at the infrastructure layer via Kubernetes/Nginx).
- Handshake auth: soft-enforced by default, controlled by `SOCKET_REQUIRE_AUTH` (see [Environment Configuration](#️-environment-configuration)). A valid `auth: { token }` always works regardless of the flag; the flag only controls what happens when it's missing/invalid.
- On connect, a socket is registered by `userId` (supports multiple devices per user) and joined to a room per active conversation, so a group broadcast is a single `io.to(conversationId).emit(...)` instead of a per-member socket lookup.
- Events emitted to clients:
  - `conversation:message` — `{ conversationId, messageId }`, new message in a direct or group conversation
  - `conversation:memberAdded` — `{ conversationId, memberIds }`
  - `conversation:memberRemoved` — `{ conversationId, userId }`
  - `conversation:updated` — `{ conversationId, name, avatar }`, group renamed/avatar changed
  - `newMessageSignal` — legacy signal, still emitted alongside the above for clients sending via `/messages/*`
- All communication is over HTTP/WS (no SSL/HTTPS at this layer — see [Deployment](#-deployment)).

## 📡 API Reference

### Authentication — `/auth`

| Method | Path | Description |
|---|---|---|
| POST | `/signup` | Create account, returns access + refresh tokens |
| POST | `/login` | Login, returns access + refresh tokens |
| POST | `/refresh` | Exchange a valid refresh token for a new access + refresh pair (rotates it) |
| POST | `/logout` | Revoke the given refresh token |
| POST | `/forgotusername` | Email the account's username |
| POST | `/forgotpassword` | Email a temporary password |
| DELETE | `/deleteAccount/:userId` | Delete account (auth required, self only) |

### User — `/users`

| Method | Path | Description |
|---|---|---|
| GET | `/me` | Get the authenticated user's own profile |
| GET | `/uploads/images/:filename` | Get a profile image |
| GET | `/friendlist` | List friends |
| GET | `/friendrequests` | List incoming friend requests |
| PUT | `/addfriend/:uniqueId` | Send a friend request |
| PUT | `/acceptfriend/:uniqueId` | Accept a friend request |
| PUT | `/rejectfriend/:uniqueId` | Reject a friend request |
| PUT | `/removefriend/:uniqueId` | Remove a friend |
| PUT | `/blockuser/:friendId` | Block a user |
| PUT | `/unblockuser/:friendId` | Unblock a user |
| GET | `/blockedusers` | List blocked users |
| POST | `/reportuser` | Report a user for moderation |
| PUT | `/changepassword` | Change password |
| PUT | `/updatenickname/:nickname` | Update nickname |
| PUT | `/updateuniqueid/:uniqueId` | Update unique ID |
| PUT | `/updateprofileimage/` | Update profile image |
| PUT | `/updateemail` | Update email |
| PUT | `/fcm/register` | Register an FCM push token |
| DELETE | `/fcm/token` | Remove an FCM push token |

### Conversations — `/conversations`

| Method | Path | Description |
|---|---|---|
| GET | `/` | List all conversations (direct + group) for the caller |
| GET | `/:id` | Full detail for one conversation, with member profiles |
| POST | `/direct` | Find-or-create the direct conversation with another user |
| POST | `/group` | Create a group conversation |
| GET | `/:id/messages` | Cursor-paginated message history |
| POST | `/:id/messages` | Send a text message |
| POST | `/:id/upload` | Upload image(s) into the conversation |
| PUT | `/:id/members` | Add member(s) to a group |
| DELETE | `/:id/members/:userId` | Remove a member (or leave, for self) |
| PUT | `/:id` | Rename a group / update its avatar |

### Legacy Messages — `/messages`

| Method | Path | Description |
|---|---|---|
| POST | `/send/:id` | Send a message to a user (direct conversation) |
| POST | `/upload/:id` | Upload image(s) to a user |
| GET | `/get/:id` | Get conversation history (capped, non-paginated) |
| GET | `/uploads/images/:filename` | Get a message image (shared by both `/messages` and `/conversations` uploads) |
| DELETE | `/delete/:id` | Clear history up to a message |

### Link Preview — `/link-preview`

| Method | Path | Description |
|---|---|---|
| GET | `/?url=` | Open Graph metadata for a URL |
| GET | `/image?url=` | Proxied preview image |

## 🐳 Deployment

- Docker and docker-compose supported with health checks and SSL configuration.
- Example:
  ```bash
  docker build -t btc2api:latest .
  docker-compose up -d
  ```
- Health check endpoint available at `/health`
- API version endpoint available at `/config`

---

**Note:**
- No SSL/HTTPS is used in the application; TLS/SSL is handled by nginx for production.
- CORS is configured via environment variables for security.
- All routes except health checks require authentication via JWT access tokens.
