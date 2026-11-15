// Load .env before any other module is evaluated (ESM runs imports first,
// so a dotenv.config() call in this file's body would run too late for
// modules that read process.env at import time)
import "dotenv/config";

import http from "http";
import mongoose from "mongoose";
import connectToMongoDB from "./src/db/connectToMongoDB.js";
import { server, io, API_VERSION, ENABLE_METRICS } from "./src/app.js";

const PORT = process.env.PORT || 3000;
const METRICS_PORT = process.env.METRICS_PORT || 9090;

// Kubernetes sends SIGTERM, waits terminationGracePeriodSeconds (30 in
// btc-api-deployment.yaml), then kills the pod. Exit on our own before then
// even if a connection refuses to close.
const SHUTDOWN_TIMEOUT_MS = 20 * 1000;

console.log(`API Version: ${API_VERSION}`);

await connectToMongoDB();

let metricsServer = null;

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} `);

  // Start metrics server on separate port if enabled
  if (ENABLE_METRICS) {
    import("./src/metrics/metricsSetup.js").then(({ register }) => {
      // Use lightweight HTTP server for metrics (no need for Express)
      metricsServer = http.createServer(async (req, res) => {
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
    });
  }
});

// Graceful shutdown: stop accepting connections, let requests already in
// progress finish, disconnect sockets (clients reconnect to the new pod),
// then close MongoDB. Without this a rolling deploy cut off whatever the
// old pod was doing mid-request.
let shuttingDown = false;

const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);

  const forceExit = setTimeout(() => {
    console.log("Shutdown timed out, exiting");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceExit.unref();

  try {
    // io.close() disconnects every socket and also closes the HTTP server
    // it is attached to, which waits for in-flight requests to finish
    await new Promise((resolve) => io.close(() => resolve()));
    if (metricsServer) {
      await new Promise((resolve) => metricsServer.close(() => resolve()));
    }
    await mongoose.disconnect();
    console.log("Shutdown complete");
    process.exit(0);
  } catch (error) {
    console.error("Error during shutdown:", error.message);
    process.exit(1);
  }
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
