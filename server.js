import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
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

const PORT = process.env.PORT || 3000;

// Configure CORS
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(",") || [],
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// Middleware to parse JSON bodies
app.use(cors(corsOptions));
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

console.log(`API Version: ${API_VERSION}`);

app.use(`/auth`, authRoutes);
app.use(`/messages`, messageRoutes);
app.use(`/users`, userRoutes);

server.listen(PORT, () => {
  connectToMongoDB();
  console.log(`Server running on port ${PORT} `);
});
