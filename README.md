# BTC2 API

A secure WebSocket-enabled REST API for real-time messaging with push notifications support, featuring CI/CD pipeline integration.<br/>
CI/CD setup: Github secrets/actions -> Remote Linux server running docker<br/>
<br/>
This API was built for an invite only IOS Mobile Chat app. Signup requires an existing member's unique ID.

## Table of Contents

- [Update Plans](#update-plans)
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
- [License](#license)

## Update Plans

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

# Firebase Admin SDK
FIREBASE_KEY=[firebase-service-account-json]
```

### SSL Configuration

- For development: Place your SSL key and certificate files in the root directory
- For production: Base64 encode your SSL certificates and add them to environment variables

## Architecture

### Database Models

<div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 10px;">
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
</div>

### Authentication

<div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 10px;">

- JWT-based authentication
- Protected routes using middleware
- Password hashing with bcrypt
</div>

### WebSocket Integration

<div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 10px;">

#### Socket.IO implementation for real-time features:

- Connection management with user mapping
- Real-time message delivery

```bash
# /src/socket/socket.io
# socket.io uses path specified like so
# link would be https://domain.com/${API_VERSION}/socket.io

path: `/${API_VERSION}/socket.io`
```

</div>

### Push Notifications

<div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 10px;">

#### Firebase Cloud Messaging (FCM) integration:

- Multiple device support
- Automatic token cleanup
- Badge count management for iOS

```bash
# Setup your serviceAccountKey.json here
/src/firebase/firebaseAdmin.js
```

</div>

### API Routes

<div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 10px;">

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

</div>

### Deployment

<div style="border: 1px solid #ddd; border-radius: 8px; padding: 10px; margin-bottom: 10px;">

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

</div>

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
