import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { readFileSync } from "fs";
import http from "http";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./src/routes/auth.routes.js";
import messageRoutes from "./src/routes/messages.routes.js";
import userRoutes from "./src/routes/user.routes.js";
import connectToMongoDB from "./src/db/connectToMongoDB.js";
import { app, server } from "./src/socket/socket.js";
import { metricsMiddleware } from "./src/middleware/metricsMiddleware.js";

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "package.json"), "utf-8")
);
const API_VERSION = packageJson.version;

const PORT = process.env.PORT || 3000;
const ENABLE_METRICS = process.env.ENABLE_METRICS?.toLowerCase() === "true";
const METRICS_PORT = process.env.METRICS_PORT || 9090;

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

// Conditionally enable metrics middleware
if (ENABLE_METRICS) {
  app.use(metricsMiddleware);
}

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

  // Start metrics server on separate port if enabled
  if (ENABLE_METRICS) {
    import("./src/metrics/metricsSetup.js").then(({ register }) => {
      // Use lightweight HTTP server for metrics (no need for Express)
      const metricsServer = http.createServer(async (req, res) => {
        // Only handle /metrics endpoint
        if (req.url === "/metrics" && req.method === "GET") {
          try {
            res.setHeader("Content-Type", register.contentType);
            const metrics = await register.metrics();
            res.writeHead(200);
            res.end(metrics);
          } catch (error) {
            console.error("Error collecting metrics:", error.message);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to collect metrics" }));
          }
        } else {
          // 404 for all other routes
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not Found" }));
        }
      });

      metricsServer.listen(METRICS_PORT, () => {
        console.log(`Metrics server running on port ${METRICS_PORT}`);
      });

      // Graceful shutdown
      process.on("SIGTERM", () => {
        metricsServer.close(() => {
          console.log("Metrics server closed");
          process.exit(0);
        });
      });
    });
  }
});
