import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startTestApp,
  stopTestApp,
  clearDatabase,
  api,
  createUser,
  login,
  tokenFor,
  auth,
  User,
} from "./helpers/setup.js";

before(startTestApp);
after(stopTestApp);
beforeEach(clearDatabase);

describe("health", () => {
  test("GET /health and /config respond", async () => {
    await api().get("/health").expect(200, "OK");
    const res = await api().get("/config").expect(200);
    assert.match(res.body.apiVersion, /^\d+\.\d+\.\d+$/);
  });
});

describe("login", () => {
  test("valid credentials return tokens and the user, without the password", async () => {
    const { user, password } = await createUser({ username: "aliceuser" });
    const res = await api()
      .post("/auth/login")
      .send({ username: "aliceuser", password })
      .expect(200);

    assert.equal(res.body._id, user._id.toString());
    assert.ok(res.body.token);
    assert.ok(res.body.refreshToken);
    assert.equal(res.body.password, undefined);
  });

  test("username is case-insensitive", async () => {
    const { password } = await createUser({ username: "aliceuser" });
    await api().post("/auth/login").send({ username: "AliceUser", password }).expect(200);
  });

  test("wrong password and unknown user both get the same 400", async () => {
    await createUser({ username: "aliceuser" });
    const wrong = await api()
      .post("/auth/login")
      .send({ username: "aliceuser", password: "nope-nope" })
      .expect(400);
    const unknown = await api()
      .post("/auth/login")
      .send({ username: "nobodyhere", password: "nope-nope" })
      .expect(400);
    assert.deepEqual(wrong.body, unknown.body);
  });

  test("an object in place of the username is not treated as a query", async () => {
    await createUser({ username: "aliceuser" });
    const res = await api()
      .post("/auth/login")
      .send({ username: { $ne: null }, password: "password123" });
    assert.notEqual(res.status, 200);
  });
});

describe("protectRoute", () => {
  test("no token is 401", async () => {
    await api().get("/users/me").expect(401);
  });

  test("a tampered token is 401", async () => {
    const { user } = await createUser();
    const forged = tokenFor(user, {});
    const tampered = forged.slice(0, -2) + (forged.endsWith("A") ? "BB" : "AA");
    await api().get("/users/me").set(auth(tampered)).expect(401);
  });

  test("an expired token is 401", async () => {
    const { user } = await createUser();
    const expired = tokenFor(user, { expiresIn: -10 });
    await api().get("/users/me").set(auth(expired)).expect(401);
  });

  test("a valid token for a deleted user is 401", async () => {
    const { user } = await createUser();
    const token = tokenFor(user);
    await User().deleteOne({ _id: user._id });
    await api().get("/users/me").set(auth(token)).expect(401);
  });

  test("a valid token reaches the route", async () => {
    const { user } = await createUser({ username: "aliceuser" });
    const res = await api().get("/users/me").set(auth(tokenFor(user))).expect(200);
    assert.equal(res.body.username, "aliceuser");
    assert.equal(res.body.password, undefined);
  });
});

describe("refresh tokens", () => {
  test("refresh rotates the token: the new one works, the old one is single use", async () => {
    const { password } = await createUser({ username: "aliceuser" });
    const { refreshToken } = await login("aliceuser", password);

    const first = await api().post("/auth/refresh").send({ refreshToken }).expect(200);
    assert.ok(first.body.token);
    assert.notEqual(first.body.refreshToken, refreshToken);

    // Reusing the old refresh token fails
    await api().post("/auth/refresh").send({ refreshToken }).expect(401);

    // The rotated one works, and its access token is accepted
    const second = await api()
      .post("/auth/refresh")
      .send({ refreshToken: first.body.refreshToken })
      .expect(200);
    await api().get("/users/me").set(auth(second.body.token)).expect(200);
  });

  test("missing or unknown refresh token is rejected", async () => {
    await api().post("/auth/refresh").send({}).expect(400);
    await api().post("/auth/refresh").send({ refreshToken: "not-a-real-token" }).expect(401);
  });

  test("logout revokes the refresh token", async () => {
    const { password } = await createUser({ username: "aliceuser" });
    const { refreshToken } = await login("aliceuser", password);

    await api().post("/auth/logout").send({ refreshToken }).expect(200);
    await api().post("/auth/refresh").send({ refreshToken }).expect(401);
  });
});

describe("session revocation", () => {
  test("sessionsRevokedAt rejects older access and refresh tokens", async () => {
    const { user, password } = await createUser({ username: "aliceuser" });
    const { token, refreshToken } = await login("aliceuser", password);

    // Revocation is compared at whole-second resolution against JWT iat
    await new Promise((r) => setTimeout(r, 1100));
    await User().updateOne({ _id: user._id }, { sessionsRevokedAt: new Date() });

    await api().get("/users/me").set(auth(token)).expect(401);
    await api().post("/auth/refresh").send({ refreshToken }).expect(401);

    // Logging in again afterwards works
    await new Promise((r) => setTimeout(r, 1100));
    const fresh = await login("aliceuser", password);
    await api().get("/users/me").set(auth(fresh.token)).expect(200);
  });
});

describe("signup", () => {
  test("requires a valid friend uniqueId and makes the two users friends", async () => {
    const { user: inviter } = await createUser({ username: "inviteruser" });

    const res = await api()
      .post("/auth/signup")
      .send({
        username: "NewMember",
        password: "password123",
        email: "new@example.com",
        uniqueId: inviter.uniqueId,
      })
      .expect(201);

    assert.equal(res.body.username, "newmember");
    assert.ok(res.body.token);

    const newUser = await User().findById(res.body._id);
    const refreshedInviter = await User().findById(inviter._id);
    assert.ok(newUser.friendList.some((id) => id.equals(inviter._id)));
    assert.ok(refreshedInviter.friendList.some((id) => id.equals(newUser._id)));
  });

  test("an unknown friend uniqueId is rejected", async () => {
    await api()
      .post("/auth/signup")
      .send({
        username: "newmember",
        password: "password123",
        email: "new@example.com",
        uniqueId: "doesnotexist",
      })
      .expect(400);
  });

  test("a query object in place of the friend uniqueId cannot bypass the invite check", async () => {
    await createUser({ username: "someoneelse" });

    const res = await api()
      .post("/auth/signup")
      .send({
        username: "intruder1",
        password: "password123",
        email: "intruder@example.com",
        uniqueId: { $ne: "x" },
      });

    assert.equal(res.status, 400, "signup must not succeed without a real invite");
    assert.equal(await User().exists({ username: "intruder1" }), null);
  });

  test("username and email must be unused", async () => {
    const { user: inviter } = await createUser({ username: "inviteruser" });
    await api()
      .post("/auth/signup")
      .send({
        username: "inviteruser",
        password: "password123",
        email: "other@example.com",
        uniqueId: inviter.uniqueId,
      })
      .expect(400);
    await api()
      .post("/auth/signup")
      .send({
        username: "freshname1",
        password: "password123",
        email: inviter.email,
        uniqueId: inviter.uniqueId,
      })
      .expect(400);
  });
});

describe("account recovery", () => {
  test("forgotpassword cannot reset a password with a query object for the email", async () => {
    const { user: victim, password } = await createUser({ username: "victimuser" });
    const before = (await User().findById(victim._id)).password;

    await api()
      .post("/auth/forgotpassword")
      .send({ username: "victimuser", email: { $ne: null } })
      .expect(400);

    const after = (await User().findById(victim._id)).password;
    assert.equal(after, before, "password must not change");
    await login("victimuser", password);
  });

  test("forgotusername rejects a query object for the email", async () => {
    await createUser({ username: "victimuser" });
    await api().post("/auth/forgotusername").send({ email: { $gt: "" } }).expect(400);
  });

  test("nested operators anywhere in the body are rejected", async () => {
    const { user } = await createUser();
    await api()
      .put("/users/updateemail")
      .set(auth(tokenFor(user)))
      .send({ password: "password123", email: { nested: [{ $where: "1" }] } })
      .expect(400);
  });
});

describe("delete account", () => {
  test("a user cannot delete someone else's account", async () => {
    const { user: alice } = await createUser();
    const { user: bob } = await createUser();
    await api()
      .delete(`/auth/deleteAccount/${bob._id}`)
      .set(auth(tokenFor(alice)))
      .expect(403);
    assert.ok(await User().exists({ _id: bob._id }));
  });

  test("a user can delete their own account", async () => {
    const { user: alice } = await createUser();
    await api()
      .delete(`/auth/deleteAccount/${alice._id}`)
      .set(auth(tokenFor(alice)))
      .expect(200);
    assert.equal(await User().exists({ _id: alice._id }), null);
  });
});
