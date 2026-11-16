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

// How long a rotated refresh token can still be exchanged. Covers a
// refresh whose response never reached the app (timeout, app suspended
// mid-request): the app still holds the old token and would otherwise be
// signed out on its next refresh.
export const REFRESH_TOKEN_GRACE_MS = 5 * 60 * 1000;

/////////////////////////////////////////////
// Validate + rotate a refresh token: a new one is issued with a fresh
// 14-day expiry, and the old one expires after REFRESH_TOKEN_GRACE_MS
// (the TTL index then deletes it). Returns null if the token is unknown,
// expired, or was rotated longer ago than the grace period (caller should
// require the user to log in again).
/////////////////////////////////////////////
export const rotateRefreshToken = async (token) => {
  const tokenHash = hashToken(token);
  const now = new Date();

  // Atomic: of two requests rotating the same unused token at once, only
  // one gets here; the other goes through the grace check below
  let existing = await RefreshToken.findOneAndUpdate(
    { tokenHash, rotatedAt: null, expiresAt: { $gt: now } },
    {
      $set: {
        rotatedAt: now,
        expiresAt: new Date(now.getTime() + REFRESH_TOKEN_GRACE_MS),
      },
    }
  );
  if (!existing) {
    // Already rotated: accepted again only inside the grace period
    existing = await RefreshToken.findOne({
      tokenHash,
      rotatedAt: { $gt: new Date(now.getTime() - REFRESH_TOKEN_GRACE_MS) },
      expiresAt: { $gt: now },
    });
  }
  if (!existing) return null;

  const refreshToken = await generateRefreshToken(existing.userId);
  return {
    userId: existing.userId,
    refreshToken,
    issuedAt: existing.createdAt,
  };
};

/////////////////////////////////////////////
// Revoke a single refresh token (logout)
/////////////////////////////////////////////
export const revokeRefreshToken = async (token) => {
  await RefreshToken.deleteOne({ tokenHash: hashToken(token) });
};

/////////////////////////////////////////////
// Revoke every refresh token a user holds (all devices)
/////////////////////////////////////////////
export const revokeAllRefreshTokens = async (userId) => {
  await RefreshToken.deleteMany({ userId });
};
