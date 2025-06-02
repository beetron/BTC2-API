import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import authRoutes from "./src/routes/auth.routes.js";
import messageRoutes from "./src/routes/messages.routes.js";
import userRoutes from "./src/routes/user.routes.js";
import connectToMongoDB from "./src/db/connectToMongoDB.js";
import { app, server } from "./src/socket/socket.js";

const PORT = process.env.PORT;
const API_VERSION = process.env.API_VERSION;

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

// Simple health check endpoint
app.get(`/${API_VERSION}/health`, (req, res) => {
  res.status(200).send("OK");
});

app.use(`/${API_VERSION}/auth`, authRoutes);
app.use(`/${API_VERSION}/messages`, messageRoutes);
app.use(`/${API_VERSION}/users`, userRoutes);

server.listen(PORT, () => {
  connectToMongoDB();
  console.log(`Server running on port ${PORT}`);
});
