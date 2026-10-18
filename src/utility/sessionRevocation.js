// JWT iat is whole seconds, so compare at that resolution. A token minted
// in the same second as (but after) a revocation is rejected too, which only
// means a user signing back in within one second has to try again.
export const isAccessTokenRevoked = (user, decoded) => {
  if (!user?.sessionsRevokedAt) return false;
  if (typeof decoded?.iat !== "number") return true;
  return decoded.iat * 1000 < user.sessionsRevokedAt.getTime();
};

// Refresh tokens carry their own createdAt, so this one is exact.
export const isRefreshTokenRevoked = (user, issuedAt) => {
  if (!user?.sessionsRevokedAt) return false;
  return issuedAt < user.sessionsRevokedAt;
};
