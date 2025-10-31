import { Server } from "socket.io";
import express from "express";
import http from "http";

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

// Get all socket IDs for a receiver (handles multiple devices)
export const getReceiverSocketIds = (receiverId) => {
  return userSocketMap[receiverId] || [];
};

// Map to store userId and array of socketId pairs (supports multiple devices)
const userSocketMap = {};

io.on("connection", (socket) => {
  console.log("client has connected", socket.id);

  // Get userId from query on connection to socket
  const userId = socket.handshake.query.userId;

  if (userId && userId !== "undefined") {
    // Initialize array if not exists
    if (!userSocketMap[userId]) {
      userSocketMap[userId] = [];
    }
    // Add this socket to the user's sockets (supports mobile, web, tablet, etc.)
    userSocketMap[userId].push(socket.id);
    console.log(
      `User ${userId} connected. Total devices: ${userSocketMap[userId].length}`
    );
  } else {
    console.log("Invalid userId:", userId);
  }

  // Check for online users for future use
  // io.emit("getOnlineUsers", Object.keys(userSocketMap));

  socket.on("disconnect", () => {
    console.log("client has disconnected", socket.id);
    if (userId && userId !== "undefined") {
      // Remove only this specific socket
      userSocketMap[userId] = userSocketMap[userId].filter(
        (id) => id !== socket.id
      );
      console.log(
        `User ${userId} disconnected. Remaining devices: ${userSocketMap[userId].length}`
      );
      // Clean up empty entries
      if (userSocketMap[userId].length === 0) {
        delete userSocketMap[userId];
      }
    }
    // io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
});

export { app, server, io };
