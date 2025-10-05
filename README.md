# BTC2 API (v1.2.0)

[![Node.js](https://img.shields.io/badge/Node.js-24.x-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-4.x-47A248?style=flat-square&logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Firebase](https://img.shields.io/badge/Firebase-Cloud_Messaging-FFCA28?style=flat-square&logo=firebase&logoColor=black)](https://firebase.google.com/)
[![JWT](https://img.shields.io/badge/JWT-Auth-000000?style=flat-square&logo=json-web-tokens&logoColor=white)](https://jwt.io/)
[![Socket.io](https://img.shields.io/badge/Socket.io-v4-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io/)

[![Linux](https://img.shields.io/badge/Linux-Server-FCC624?style=flat-square&logo=linux&logoColor=black)](https://www.linux.org/)
[![GitHub Actions](https://img.shields.io/badge/GitHub_Actions-CI/CD-2088FF?style=flat-square&logo=github-actions&logoColor=white)](https://github.com/features/actions)
[![Docker](https://img.shields.io/badge/Docker-Containerized-2496ED?style=flat-square&logo=docker&logoColor=white)](https://www.docker.com/)

A secure WebSocket-enabled REST API for real-time messaging with push notifications support, featuring CI/CD pipeline integration.<br/>
CI/CD setup: Github secrets/actions -> Remote Linux server running docker<br/>
<br/>
This API was built for an invite only IOS Mobile Chat app. Signup requires an existing member's unique ID.

## Table of Contents

- [Features](#features)
- [Setup](#setup)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Environment Configuration](#environment-configuration)
  - [SSL Configuration](#ssl-configuration)
- [Architecture](#architecture)
  - [Database Models](#database-models)
  - [Authentication](#authentication)
  - [WebSocket Integration](#websocket-integration)
  - [Push Notifications](#push-notifications)
- [API Routes](#api-routes)
- [Deployment](#deployment)

## Features

#### Current Features

- Signup, Login, Logout
- Forgot username, Forgot password
- Update nickname/unique ID/profile image
- Change password, email
- Send message, get messages
- Check unread messages count
- Get friend list, send friend requests, approve/reject requests, get pending friend requests

#### Update Plans

- Group chat support
- File sharing via messages
- Block users
- Email registration
- Forgot password function

## Setup

### Prerequisites

- Node.js 24+
- MongoDB
- Firebase Admin Account for push notification
- SSL Certificate (for HTTPS)
- Docker (optional)

### Installation

1. Clone the repository:

```bash
git clone https://github.com/beetron/btc2_API
cd btc2_api
```

2. Install dependencies:

```bash
npm install
```

### Environment Configuration

```bash
API_VERSION=1.0.0
PORT=443
NODE_ENV=development
MONGO_DB_URI=mongodb://[your-mongodb-uri]
JWT_SECRET=[your-jwt-secret]

# Development SSL paths
DEV_SSL_KEY_PATH=[path-to-key.pem]
DEV_SSL_CERT_PATH=[path-to-cert.pem]

# Production SSL (Base64 encoded certificates)
SSL_KEY=[base64-encoded-key]
SSL_CERT=[base64-encoded-cert]

# Firebase account key setup in /src/firebase/firebaseAdmin.js
FIREBASE_KEY=[firebase-service-account-json]
```

#### Profile Image Store Folder

- Create folder to store user profile images

```bash
/src/users/profileImage
```

### SSL Configuration

- For development: Place your SSL key and certificate files in the root directory
- For production: Base64 encode your SSL certificates and add them to environment variables

## Architecture

### Database Models

<details open>
<summary><strong>User Model</strong></summary>

- Username/UniqueID system for user identification
- Friend system with request/accept flow
- FCM token management for push notifications
- Profile image support
</details>

<details open>
<summary><strong>Message Model</strong></summary>

- Stores individual messages between users, and per user
- Tracks sender and receiver
- Timestamp-based message history
</details>

<details open>
<summary><strong>UserConversation Model</strong></summary>

- Manages conversation state between two users
- Tracks unread message counts
- Supports message deletion with safety checks
</details>

### Authentication

- JWT-based authentication
- Protected routes using middleware
- Password hashing with bcrypt
</div>

### WebSocket Integration

#### Socket.IO implementation for real-time features:

- Connection management with user mapping
- Real-time message delivery

```bash
# /src/socket/socket.io
# socket.io uses path specified like so
# link would be https://domain.com/${API_VERSION}/socket.io

path: `/${API_VERSION}/socket.io`
```

### Push Notifications

#### Firebase Cloud Messaging (FCM) integration:

- Multiple device support
- Automatic token cleanup
- Badge count management for iOS

## API Routes

#### Authentication Routes

```bash
POST /{API_VERSION}/auth/signup - Create new account
POST /{API_VERSION}/auth/login  - Login user
POST /{API_VERSION}/auth/logout - Logout user
```

#### User Routes

```bash
GET  /{API_VERSION}/users/friendlist          - Get friend list
GET  /{API_VERSION}/users/friendrequests      - Get friend requests
PUT  /{API_VERSION}/users/addfriend/:uniqueId - Send friend request
PUT  /{API_VERSION}/users/acceptfriend/:uniqueId - Accept friend request
PUT  /{API_VERSION}/users/updateprofileimage  - Update profile picture
PUT  /{API_VERSION}/users/fcm/register        - Register FCM token
```

#### Message Routes

```bash
POST   /{API_VERSION}/messages/send/:id    - Send message to user
GET    /{API_VERSION}/messages/get/:id     - Get conversation history
DELETE /{API_VERSION}/messages/delete/:id  - Delete messages
```

## Deployment

This project includes Docker support for easy deployment (docker compose)

1. Build the Docker image:

```bash
docker build -t btc2api:1.0.0 .
```

2. Run with docker-compose:

```bash
docker-compose up -d
```

The included GitHub Actions workflow handles automated deployment to production servers.
