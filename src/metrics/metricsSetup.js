import client from "prom-client";

// Create a Registry
const register = new client.Registry();

// Default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// Custom metrics
export const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.1, 0.5, 1, 2, 5],
  registers: [register],
});

export const httpRequestTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const messagesSent = new client.Counter({
  name: "messages_sent_total",
  help: "Total number of messages sent",
  registers: [register],
});

export const friendRequestsTotal = new client.Counter({
  name: "friend_requests_total",
  help: "Total number of friend requests",
  registers: [register],
});

export const usersRegistered = new client.Counter({
  name: "users_registered_total",
  help: "Total number of registered users",
  registers: [register],
});

export const socketConnections = new client.Gauge({
  name: "socket_io_connections",
  help: "Number of active Socket.IO connections",
  registers: [register],
});

export { register };
