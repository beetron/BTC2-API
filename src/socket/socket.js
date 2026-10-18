import { Server } from "socket.io";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { dateNow } from "../utility/dateNow.js";
import Conversation from "../models/conversation.model.js";
import User from "../models/user.model.js";
import { isAccessTokenRevoked } from "../utility/sessionRevocation.js";

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
  path: `/socket.io`,
  cors: {
    origin: process.env.CORS_ORIGIN?.split(",") || [],
    credentials: true,
    methods: ["GET", "POST"],
  },
});

// Soft-enforced handshake auth. Prefers a verified JWT (sent as
// `auth: { token }` by the socket.io client) and falls back to the legacy
// unauthenticated `userId` query param while older client builds are still
// in the field. Set SOCKET_REQUIRE_AUTH=true once every client sends a
// token, to reject unauthenticated/invalid handshakes outright.
const REQUIRE_SOCKET_AUTH =
  process.env.SOCKET_REQUIRE_AUTH?.toLowerCase() === "true";

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;

  if (token) {
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      decoded = null;
      console.log(`Socket auth failed for ${socket.id}: ${error.message}`);
      if (REQUIRE_SOCKET_AUTH) {
        return next(new Error("Unauthorized"));
      }
      // Fall through to the legacy path below during the rollout window.
    }

    if (decoded) {
      // A correctly signed token for a deleted or signed-out account is
      // rejected outright, flag or not: it is a known-bad session, not an
      // old client. "Unauthorized" is the message clients refresh on.
      try {
        const user = await User.findById(decoded.userId).select(
          "_id sessionsRevokedAt"
        );
        if (!user || isAccessTokenRevoked(user, decoded)) {
          return next(new Error("Unauthorized"));
        }
      } catch (error) {
        console.log(`Socket user lookup failed for ${socket.id}: ${error.message}`);
        return next(new Error("Unauthorized"));
      }

      socket.data.userId = decoded.userId;
      socket.data.authenticated = true;
      return next();
    }
  } else if (REQUIRE_SOCKET_AUTH) {
    return next(new Error("Unauthorized"));
  }

  const legacyUserId = socket.handshake.query.userId;
  socket.data.userId = legacyUserId;
  socket.data.authenticated = false;
  if (legacyUserId && legacyUserId !== "undefined") {
    console.log(
      `Socket ${socket.id} connected without a verified token (legacy client) - userId ${legacyUserId}`
    );
  }
  next();
});

// Get all socket IDs for a receiver (handles multiple devices)
export const getReceiverSocketIds = (receiverId) => {
  return userSocketMap[receiverId] || [];
};

// Map to store userId and array of socketId pairs (supports multiple devices)
const userSocketMap = {};

// Every socket also joins a per-user room, so all of one user's devices can
// be reached (or dropped) in one call without walking userSocketMap.
const userRoom = (userId) => `user:${userId}`;

// Force-close every socket a user has open, e.g. after an admin edit or
// account deletion. The client sees a server-side disconnect.
export const disconnectUserSockets = (userId) => {
  io.in(userRoom(userId.toString())).disconnectSockets(true);
};

io.on("connection", async (socket) => {
  const connectTime = dateNow();
  console.log(`${connectTime}: client socket Connected : ${socket.id}`);

  const userId = socket.data.userId;

  // Registered before any await below, so a socket that is dropped while
  // its conversation rooms are still loading is still removed from the map.
  socket.on("disconnect", () => {
    const disconnectTime = dateNow();
    console.log(`${disconnectTime}: client socket Disconnected:: ${socket.id}`);
    if (userId && userId !== "undefined") {
      // Remove only this specific socket
      userSocketMap[userId] = (userSocketMap[userId] || []).filter(
        (id) => id !== socket.id
      );
      console.log(
        `${disconnectTime}: User ${userId} Devices: ${userSocketMap[userId].length}`
      );
      // Clean up empty entries
      if (userSocketMap[userId].length === 0) {
        delete userSocketMap[userId];
      }
    }
    // io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });

  if (userId && userId !== "undefined") {
    // Initialize array if not exists
    if (!userSocketMap[userId]) {
      userSocketMap[userId] = [];
    }
    // Add this socket to the user's sockets
    userSocketMap[userId].push(socket.id);
    socket.join(userRoom(userId));
    console.log(
      `${connectTime}: User ${userId} Devices: ${userSocketMap[userId].length}`
    );

    // Join a room per conversation so group broadcasts are a single
    // io.to(conversationId).emit() instead of per-member socket lookups.
    try {
      const conversations = await Conversation.find({ "members.userId": userId });
      conversations.forEach((c) => {
        if (c.isActiveMember(userId)) {
          socket.join(c._id.toString());
        }
      });
    } catch (error) {
      console.log(`Error joining conversation rooms for ${userId}:`, error.message);
    }
  } else {
    console.log("Invalid userId:", userId);
  }

  // Check for online users for future use
  // io.emit("getOnlineUsers", Object.keys(userSocketMap));
});

export { app, server, io };
