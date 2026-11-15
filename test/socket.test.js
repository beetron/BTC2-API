import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  startTestApp,
  stopTestApp,
  clearDatabase,
  createUser,
  tokenFor,
} from "./helpers/setup.js";

before(startTestApp);
after(stopTestApp);
beforeEach(clearDatabase);

// Runs the real handshake middleware against a stand-in socket and returns
// { error, userId }: the error it rejected with (if any) and the identity it
// gave the socket
const handshake = async ({ token, query = {} } = {}) => {
  const { authenticateSocket } = await import("../src/socket/socket.js");
  const socket = {
    id: "test-socket",
    handshake: { auth: token === undefined ? {} : { token }, query },
    data: {},
  };
  const error = await new Promise((resolve) => authenticateSocket(socket, resolve));
  return { error, userId: socket.data.userId };
};

describe("socket handshake", () => {
  test("a valid token connects as that user", async () => {
    const { user } = await createUser();
    const { error, userId } = await handshake({ token: tokenFor(user) });
    assert.equal(error, undefined);
    assert.equal(userId, user._id.toString());
  });

  test("no token is rejected, even with a userId in the query", async () => {
    const { user } = await createUser();
    const { error, userId } = await handshake({ query: { userId: user._id.toString() } });
    assert.equal(error?.message, "Unauthorized");
    assert.equal(userId, undefined, "the query userId must never become the identity");
  });

  test("invalid, expired, wrongly signed and revoked tokens are rejected", async () => {
    const { user } = await createUser();
    const expired = tokenFor(user, { expiresIn: -10 });
    const jwt = (await import("jsonwebtoken")).default;
    const forged = jwt.sign({ userId: user._id.toString() }, "not-the-secret");

    for (const token of ["garbage", expired, forged]) {
      const { error } = await handshake({ token });
      assert.equal(error?.message, "Unauthorized");
    }

    // Signed out everywhere after the token was issued
    const issued = tokenFor(user);
    await mongoose
      .model("User")
      .updateOne({ _id: user._id }, { sessionsRevokedAt: new Date(Date.now() + 1000) });
    assert.equal((await handshake({ token: issued })).error?.message, "Unauthorized");
  });

  test("a token for a deleted account is rejected", async () => {
    const { user } = await createUser();
    const token = tokenFor(user);
    await mongoose.model("User").deleteOne({ _id: user._id });
    assert.equal((await handshake({ token })).error?.message, "Unauthorized");
  });
});
