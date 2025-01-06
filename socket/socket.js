import dotenv from "dotenv";
dotenv.config();

import { Server } from "socket.io";
import http from "http";
import express from "express";

const app = express();

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [process.env.DEVELOPMENT_URL, process.env.PRODUCTION_URL],
    methods: ["GET", "POST"],
  },
});

export const getReceiverSocketId = (receiverId) => {
  return userSocketMap[receiverId];
};

// Map to store userId and socketId pair
const userSocketMap = {};

io.on("connection", (socket) => {
  console.log("client has connected", socket.id);

  // Get userId from query on connection to socket
  const userId = socket.handshake.query.userId;

  if (userId && userId !== "undefined") {
    userSocketMap[userId] = socket.id;
  } else {
    console.log("Invalid userId:", userId);
  }

  // if (userId != "undefined") {
  //   userSocketMap[userId] = socket.id;
  // }

  io.emit("getOnlineUsers", Object.keys(userSocketMap));

  socket.on("disconnect", () => {
    console.log("client has disconnected", socket.id);
    if (userId && userId !== "undefined") {
      delete userSocketMap[userId];
    }
    io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
});

export { app, server, io };
