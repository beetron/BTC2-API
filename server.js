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
import conversationRoutes from "./src/routes/conversation.routes.js";
import linkPreviewRoutes from "./src/routes/linkPreview.routes.js";
import adminRoutes from "./src/routes/admin.routes.js";
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

// How many reverse proxies sit in front of the API (Kubernetes ingress = 1).
// Rate limits key on the client IP that Express derives from this, so it
// must match the real deployment: too low and every user shares the
// ingress's IP, too high and clients can spoof X-Forwarded-For.
// Accepts a hop count, true/false, or an Express trust-proxy subnet list.
const parseTrustProxy = (value) => {
  if (value === undefined || value.trim() === "") return 1;
  if (value === "true") return true;
  if (value === "false") return false;
  const hops = Number(value);
  return Number.isInteger(hops) ? hops : value;
};
app.set("trust proxy", parseTrustProxy(process.env.TRUST_PROXY));

if (!process.env.ADMIN_USER_ID) {
  console.log("ADMIN_USER_ID is not set, admin endpoints are disabled");
}

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
app.use(`/conversations`, conversationRoutes);
app.use(`/link-preview`, linkPreviewRoutes);
app.use(`/admin`, adminRoutes);

await connectToMongoDB();

server.listen(PORT, () => {
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
