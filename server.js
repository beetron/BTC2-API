// Load .env before any other module is evaluated (ESM runs imports first,
// so a dotenv.config() call in this file's body would run too late for
// modules that read process.env at import time)
import "dotenv/config";

import http from "http";
import connectToMongoDB from "./src/db/connectToMongoDB.js";
import { server, API_VERSION, ENABLE_METRICS } from "./src/app.js";

const PORT = process.env.PORT || 3000;
const METRICS_PORT = process.env.METRICS_PORT || 9090;

console.log(`API Version: ${API_VERSION}`);

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
