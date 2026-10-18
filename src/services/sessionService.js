import User from "../models/user.model.js";
import { revokeAllRefreshTokens } from "./tokenService.js";
import { disconnectUserSockets } from "../socket/socket.js";

/////////////////////////////////////////////
// End every session a user has, on every device: access tokens issued
// before now stop working (protectRoute and the socket handshake both
// check sessionsRevokedAt), refresh tokens are deleted so clients can't
// mint new ones, and open sockets are dropped.
//
// Clients already handle this: their next request 401s, the refresh
// attempt fails, and they fall back to the login screen.
/////////////////////////////////////////////
export const endAllSessions = async (userId) => {
  await revokeAllRefreshTokens(userId);
  disconnectUserSockets(userId);
};

export const revokeUserSessions = async (userId) => {
  await User.updateOne(
    { _id: userId },
    { $set: { sessionsRevokedAt: new Date() } }
  );
  await endAllSessions(userId);
};
