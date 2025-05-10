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

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

app.use("/auth", authRoutes);
app.use("/messages", messageRoutes);
app.use("/users", userRoutes);

server.listen(PORT, () => {
  connectToMongoDB();
  console.log(`Server running on port ${PORT}`);
});
