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
- Send message, get messages
- Check unread messages count
- Get friend list, send/accept/reject/remove friend requests
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
   git clone https://github.com/beetron/btc2_API
   cd btc2_api
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

# SMTP configuration for email sending
SMTP_HOST=mail.example.com
SMTP_USER=from@example.com
SMTP_PASS="password"
SMTP_FROM="BTC2-Notifications <from@example.com>"

# Node environment
NODE_ENV=production   # for production
NODE_ENV=development  # for development
```

## 🏗️ Architecture

- API version is tracked in `package.json` and used for docker image versioning.
- Profile images are stored in `/src/users/profileImage` and handled via `multer` and `sharp`.
- Real-time messaging is handled via Socket.IO.
- Push notifications are sent via Firebase Cloud Messaging.

### 🔐 Authentication

- POST `/auth/signup` - Create new account
- POST `/auth/login` - Login user
- POST `/auth/logout` - Logout user
- GET `/auth/forgotusername` - Forgot username
- GET `/auth/forgotpassword` - Forgot password

### 👤 User

- GET `/users/profileImage/:filename` - Get profile image
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

### 💬 Messages

- POST `/messages/send/:id` - Send message to user
- GET `/messages/get/:id` - Get conversation history
- DELETE `/messages/delete/:id` - Delete messages

### 🔌 Socket.IO

- Path: `/socket.io` (Versioning handled at infrastructure layer via Kubernetes/Nginx)
- All communication is over HTTP (no SSL/HTTPS)

## 🐳 Deployment

- Docker and docker-compose supported.
- Example:
  ```bash
  docker build -t btc2api:latest .
  docker-compose up -d
  ```

```

---

**Note:**
- No SSL/HTTPS is used; TLS/SSL is handled by nginx for production.
```
