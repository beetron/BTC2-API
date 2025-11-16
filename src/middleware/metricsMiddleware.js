import {
  httpRequestDuration,
  httpRequestTotal,
} from "../metrics/metricsSetup.js";

export const metricsMiddleware = (req, res, next) => {
  // Skip metrics collection for /metrics endpoint itself
  if (req.path === "/metrics") {
    return next();
  }

  const start = Date.now();

  // Capture response finish to record metrics
  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000; // Convert to seconds

    const route = req.route?.path || req.path;
    const method = req.method;
    const statusCode = String(res.statusCode); // Ensure status code is a string

    // Record metrics
    httpRequestDuration.labels(method, route, statusCode).observe(duration);

    httpRequestTotal.labels(method, route, statusCode).inc();
  });

  next();
};
