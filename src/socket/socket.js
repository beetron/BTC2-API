import dotenv from "dotenv";
dotenv.config();

import { Server } from "socket.io";
import https from "https";
import express from "express";
import fs from "fs";
const app = express();

const appEnvironment = process.env.NODE_ENV;
let sslKey;
let sslCert;

// Production will be injecting environment variables
if (appEnvironment === "production") {
  sslKey = process.env.SSL_KEY;
  sslCert = process.env.SSL_CERT;
} else {
  // Development, physical file in root
  sslKey = fs.readFileSync(process.env.DEV_SSL_KEY_PATH);
  sslCert = fs.readFileSync(process.env.DEV_SSL_CERT_PATH);
}

const server = https.createServer(
  {
    key: sslKey,
    cert: sslCert,
  },
  app
);

const io = new Server(server, {
  path: `/${API_VERSION}/socket.io`,
});

// Use if you will access API via browser
//
// const io = new Server(server, {
//   cors: {
//     origin: [process.env.DEVELOPMENT_URL, process.env.PRODUCTION_URL],
//     methods: ["GET", "POST"],
//   },
// });

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

  // Check for online users for future use
  // io.emit("getOnlineUsers", Object.keys(userSocketMap));

  socket.on("disconnect", () => {
    console.log("client has disconnected", socket.id);
    if (userId && userId !== "undefined") {
      delete userSocketMap[userId];
    }
    // io.emit("getOnlineUsers", Object.keys(userSocketMap));
  });
});

export { app, server, io };
