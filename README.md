# 💬 BTC2 API

A secure WebSocket-enabled REST API for real-time messaging with push notifications support.

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

- [✨ Features](#features)
- [🚀 Setup](#setup)
- [⚙️ Environment Configuration](#environment-configuration)
- [🏗️ Architecture](#architecture)
  - [🔐 Authentication](#authentication)
  - [👤 User](#user)
  - [💬 Messages](#messages)
  - [🔌 Socket.IO](#socketio)
- [🐳 Deployment](#deployment)

## ✨ Features

- Signup, Login, Logout
- Forgot username, Forgot password
- Update nickname/unique ID/profile image
- Change password, email
- Send message, get messages, upload images in messages
- Check unread messages count
- Get friend list, send/accept/reject/remove friend requests
- Report users for moderation
- Delete account
- Push notifications via Firebase
- Real-time messaging via Socket.IO

## 🚀 Setup

### Prerequisites

- Node.js 24+
- MongoDB
- Firebase Admin Account for push notification
- Docker (optional)

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/beetron/btc2-api
   cd btc2-api
   ```

````
2. Install dependencies:
   ```bash
npm install
````

## ⚙️ Environment Configuration

Set the following environment variables in your deployment environment or a `.env` file:

```env
# MongoDB connection
MONGO_DB_URI=mongodb://username:password@example.com:27017/

# JWT secret for authentication
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

# Node environment
NODE_ENV=production   # for production
FIREBASE_KEY # for production - fcm key json
NODE_ENV=development  # for development
```

## 🏗️ Architecture

- API version is tracked in `package.json` and used for docker image versioning.
- Profile images are stored in `/src/uploads/images` and handled via `multer` and `sharp`.
- Message images are stored in `/src/uploads/images` with automatic cleanup.
- Real-time messaging is handled via Socket.IO with multi-device support.
- Push notifications are sent via Firebase Cloud Messaging.
- User reports are emailed to administrators for moderation.
- Account deletion includes cleanup of all associated messages and conversations.
- **Prometheus metrics** (optional) available on port 9090 when `ENABLE_METRICS=true`
  - HTTP request metrics (duration, total count)
  - Custom API metrics (messages, friend requests, user registrations)
  - Socket.IO connection tracking
  - System metrics (CPU, memory, uptime)

### 🔐 Authentication

- POST `/auth/signup` - Create new account
- POST `/auth/login` - Login user
- POST `/auth/logout` - Logout user
- POST `/auth/forgotusername` - Forgot username
- POST `/auth/forgotpassword` - Forgot password
- DELETE `/auth/deleteAccount/:userId` - Delete account (requires authentication)

### 👤 User

- GET `/users/uploads/images/:filename` - Get profile image
- GET `/users/friendlist` - Get friend list
- GET `/users/friendrequests` - Get friend requests
- PUT `/users/addfriend/:uniqueId` - Send friend request
- PUT `/users/acceptfriend/:uniqueId` - Accept friend request
- PUT `/users/rejectfriend/:uniqueId` - Reject friend request
- PUT `/users/removefriend/:uniqueId` - Remove friend
- PUT `/users/changepassword` - Change password
- PUT `/users/updatenickname/:nickname` - Update nickname
- PUT `/users/updateuniqueid/:uniqueId` - Update unique ID
- PUT `/users/updateprofileimage/` - Update profile image
- PUT `/users/updateemail` - Update email
- PUT `/users/fcm/register` - Register FCM token
- DELETE `/users/fcm/token` - Delete FCM token
- POST `/users/reportuser` - Report user for moderation

### 💬 Messages

- POST `/messages/send/:id` - Send message to user
- POST `/messages/upload/:id` - Upload images in messages
- GET `/messages/get/:id` - Get conversation history
- GET `/messages/uploads/images/:filename` - Get message image
- DELETE `/messages/delete/:id` - Delete messages

### 🔌 Socket.IO

- Path: `/socket.io` (Versioning handled at infrastructure layer via Kubernetes/Nginx)
- All communication is over HTTP (no SSL/HTTPS)

## 🐳 Deployment

- Docker and docker-compose supported with health checks and SSL configuration.
- Example:
  ```bash
  docker build -t btc2api:latest .
  docker-compose up -d
  ```
- Health check endpoint available at `/health`
- API version endpoint available at `/config`

```

---

**Note:**
- No SSL/HTTPS is used in the application; TLS/SSL is handled by nginx for production.
- CORS is configured via environment variables for security.
- All routes except health checks require authentication via JWT tokens.
```
