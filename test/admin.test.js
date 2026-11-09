import { test, describe, before, after, beforeEach, afterEach } from "node:test";
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
afterEach(() => {
  delete process.env.ADMIN_USER_ID;
});

const setupAdmin = async () => {
  const { user: admin } = await createUser({ username: "adminuser" });
  const { user: member } = await createUser({ username: "memberuser" });
  process.env.ADMIN_USER_ID = admin._id.toString();
  return { admin, member, asAdmin: auth(tokenFor(admin)), asMember: auth(tokenFor(member)) };
};

describe("admin access", () => {
  test("a regular user gets 404, not 403, so the admin API is not advertised", async () => {
    const { asMember } = await setupAdmin();
    await api().get("/admin/users").set(asMember).expect(404);
    await api()
      .post("/admin/users")
      .set(asMember)
      .send({ username: "sneakyuser", password: "password123" })
      .expect(404);
    assert.equal(await User().exists({ username: "sneakyuser" }), null);
  });

  test("no token is 401", async () => {
    await setupAdmin();
    await api().get("/admin/users").expect(401);
  });

  test("with ADMIN_USER_ID unset, admin endpoints are off for everyone", async () => {
    const { asAdmin } = await setupAdmin();
    delete process.env.ADMIN_USER_ID;
    await api().get("/admin/users").set(asAdmin).expect(404);
  });

  test("the admin can list users", async () => {
    const { asAdmin } = await setupAdmin();
    const res = await api().get("/admin/users").set(asAdmin).expect(200);
    assert.ok(JSON.stringify(res.body).includes("memberuser"));
    assert.ok(!JSON.stringify(res.body).includes("password"), "no password hashes in the listing");
  });
});

describe("admin create user", () => {
  test("creates a user who can log in and is friends with the admin", async () => {
    const { admin, asAdmin } = await setupAdmin();

    const res = await api()
      .post("/admin/users")
      .set(asAdmin)
      .send({ username: "NewPerson", password: "password123" })
      .expect(201);
    assert.equal(res.body.user.username, "newperson");

    const created = await User().findOne({ username: "newperson" });
    const refreshedAdmin = await User().findById(admin._id);
    assert.ok(created.friendList.some((id) => id.equals(admin._id)));
    assert.ok(refreshedAdmin.friendList.some((id) => id.equals(created._id)));

    await login("newperson", "password123");
  });

  test("validates input and rejects taken usernames", async () => {
    const { asAdmin } = await setupAdmin();
    await api()
      .post("/admin/users")
      .set(asAdmin)
      .send({ username: "short", password: "password123" })
      .expect(400);
    await api()
      .post("/admin/users")
      .set(asAdmin)
      .send({ username: "validname", password: "123" })
      .expect(400);
    await api()
      .post("/admin/users")
      .set(asAdmin)
      .send({ username: "memberuser", password: "password123" })
      .expect(409);
  });
});
