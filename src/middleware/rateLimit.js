import { rateLimit } from "express-rate-limit";

// Counters live in process memory, which is correct for a single API pod.
// If the API is ever scaled to several replicas, give each limiter a shared
// store (e.g. rate-limit-redis) so the limits apply across pods.
//
// Limits are per client IP, which relies on `trust proxy` being set to the
// number of proxies in front of the API (see TRUST_PROXY in server.js).
// They are deliberately generous: mobile carriers put many phones behind
// one IP, and a limit that trips for real friends is worse than none.

const MINUTE = 60 * 1000;

const limiter = (options) =>
  rateLimit({
    standardHeaders: "draft-8",
    legacyHeaders: false,
    // Same { error } shape every other endpoint uses, so both clients show
    // the message without any change.
    message: { error: "Too many requests, please try again later" },
    ...options,
  });

// Failed logins only, per IP: stops one source cycling through accounts
export const loginIpLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 30,
  skipSuccessfulRequests: true,
});

// Failed logins only, per username: stops a distributed guess at one
// account without locking out everyone else behind the same carrier IP
export const loginAccountLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 10,
  skipSuccessfulRequests: true,
  keyGenerator: (req) =>
    `login:${String(req.body?.username || "").trim().toLowerCase()}`,
});

export const signupLimiter = limiter({
  windowMs: 60 * MINUTE,
  limit: 10,
});

// forgotusername / forgotpassword send email (and forgotpassword resets the
// password), so these are the tightest
export const recoveryLimiter = limiter({
  windowMs: 60 * MINUTE,
  limit: 5,
});

// Refresh tokens can't be guessed, this only caps a misbehaving client
export const refreshLimiter = limiter({
  windowMs: 15 * MINUTE,
  limit: 100,
});

export const adminLimiter = limiter({
  windowMs: MINUTE,
  limit: 60,
});
