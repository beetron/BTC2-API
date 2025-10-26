import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cookieParser from "cookie-parser";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./src/routes/auth.routes.js";
import messageRoutes from "./src/routes/messages.routes.js";
import userRoutes from "./src/routes/user.routes.js";
import connectToMongoDB from "./src/db/connectToMongoDB.js";
import { app, server } from "./src/socket/socket.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf-8")
);
const API_VERSION = packageJson.version;

const PORT = process.env.PORT;

// Middleware to parse JSON bodies
app.use(express.json());
app.use(cookieParser());

// Simple health check endpoint without versioning
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

app.get("/config", (req, res) => {
  res.json({
    apiVersion: API_VERSION,
  });
});

app.use(`/${API_VERSION}/auth`, authRoutes);
app.use(`/${API_VERSION}/messages`, messageRoutes);
app.use(`/${API_VERSION}/users`, userRoutes);

server.listen(PORT, () => {
  connectToMongoDB();
  console.log(`Server running on port ${PORT}`);
});
