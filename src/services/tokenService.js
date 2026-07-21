import crypto from "crypto";
import RefreshToken from "../models/refreshToken.model.js";

// Sliding window: every successful rotation pushes expiry another 14 days
// out, so an active user (returns at least once per 14 days) never has to
// re-enter credentials, while a refresh token that's never used dies on
// schedule.
const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const hashToken = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");

/////////////////////////////////////////////
// Issue a new opaque refresh token for a user
/////////////////////////////////////////////
export const generateRefreshToken = async (userId) => {
  // 384 bits of entropy -- infeasible to brute force, so unlike a password
  // this doesn't need a slow hash, just something a DB leak can't reverse.
  const token = crypto.randomBytes(48).toString("hex");

  await RefreshToken.create({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });

  return token;
};

/////////////////////////////////////////////
// Validate + rotate a refresh token: the old one is deleted and a new one
// issued with a fresh 14-day expiry. Returns null if the token is unknown
// or expired (caller should require the user to log in again).
/////////////////////////////////////////////
export const rotateRefreshToken = async (token) => {
  // findOneAndDelete is atomic at the DB level -- a separate findOne +
  // deleteOne would let two truly concurrent requests (e.g. two browser
  // tabs refreshing at the same instant) both pass the "does this exist"
  // check before either delete lands, letting the same token mint two
  // children instead of one. That breaks one-time use.
  const existing = await RefreshToken.findOneAndDelete({
    tokenHash: hashToken(token),
  });
  if (!existing) return null;

  if (existing.expiresAt < new Date()) return null;

  const refreshToken = await generateRefreshToken(existing.userId);
  return { userId: existing.userId, refreshToken };
};

/////////////////////////////////////////////
// Revoke a single refresh token (logout)
/////////////////////////////////////////////
export const revokeRefreshToken = async (token) => {
  await RefreshToken.deleteOne({ tokenHash: hashToken(token) });
};
