import express from "express";
import cors from "cors";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import authRoutes from "./routes/auth.routes.js";
import messageRoutes from "./routes/messages.routes.js";
import userRoutes from "./routes/user.routes.js";
import conversationRoutes from "./routes/conversation.routes.js";
import linkPreviewRoutes from "./routes/linkPreview.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import { app, server, io } from "./socket/socket.js";
import { metricsMiddleware } from "./middleware/metricsMiddleware.js";
import rejectQueryOperators from "./middleware/rejectQueryOperators.js";

// Builds the Express app (middleware + routes) without connecting to the
// database or listening on a port, so tests can import it directly.
// server.js does the connecting and listening.

// Read version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf-8")
);
export const API_VERSION = packageJson.version;

export const ENABLE_METRICS = process.env.ENABLE_METRICS?.toLowerCase() === "true";

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
// Must run after express.json() so the parsed body is checked
app.use(rejectQueryOperators);

// No cookie parsing: both clients authenticate with an Authorization: Bearer
// header, which browsers never attach automatically, so requests can't be
// forged cross-site (CSRF). Don't add cookie-based auth without CSRF
// protection.

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

app.use(`/auth`, authRoutes);
app.use(`/messages`, messageRoutes);
app.use(`/users`, userRoutes);
app.use(`/conversations`, conversationRoutes);
app.use(`/link-preview`, linkPreviewRoutes);
app.use(`/admin`, adminRoutes);

export { app, server, io };
