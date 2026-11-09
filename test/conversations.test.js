import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startTestApp,
  stopTestApp,
  clearDatabase,
  api,
  createUser,
  tokenFor,
  auth,
  befriend,
} from "./helpers/setup.js";

before(startTestApp);
after(stopTestApp);
beforeEach(clearDatabase);

// Three users: alice and bob are friends, mallory is a stranger to both
const setupUsers = async () => {
  const { user: alice } = await createUser({ username: "aliceuser" });
  const { user: bob } = await createUser({ username: "bobbyuser" });
  const { user: mallory } = await createUser({ username: "malloryuser" });
  await befriend(alice, bob);
  return {
    alice,
    bob,
    mallory,
    as: {
      alice: auth(tokenFor(alice)),
      bob: auth(tokenFor(bob)),
      mallory: auth(tokenFor(mallory)),
    },
  };
};

const openDirect = (headers, otherUserId) =>
  api().post("/conversations/direct").set(headers).send({ userId: otherUserId.toString() });

describe("direct conversations", () => {
  test("friends can open a conversation and exchange messages", async () => {
    const { bob, alice, as } = await setupUsers();

    const opened = await openDirect(as.alice, bob._id).expect(200);
    const conversationId = opened.body.conversationId;
    assert.ok(conversationId);

    // Opening again returns the same conversation (idempotent)
    const again = await openDirect(as.bob, alice._id).expect(200);
    assert.equal(again.body.conversationId, conversationId);

    await api()
      .post(`/conversations/${conversationId}/messages`)
      .set(as.alice)
      .send({ message: "hi bob" })
      .expect(200);

    const res = await api()
      .get(`/conversations/${conversationId}/messages`)
      .set(as.bob)
      .expect(200);
    assert.equal(res.body.messages.length, 1);
    assert.equal(res.body.messages[0].message, "hi bob");
  });

  test("a non-member cannot read, post to, or view a conversation", async () => {
    const { bob, as } = await setupUsers();
    const { body } = await openDirect(as.alice, bob._id).expect(200);
    const id = body.conversationId;

    await api()
      .post(`/conversations/${id}/messages`)
      .set(as.alice)
      .send({ message: "private" })
      .expect(200);

    const read = await api().get(`/conversations/${id}/messages`).set(as.mallory);
    assert.equal(read.status, 400);
    assert.equal(read.body.messages, undefined, "no messages may leak");

    await api()
      .post(`/conversations/${id}/messages`)
      .set(as.mallory)
      .send({ message: "intrusion" })
      .expect(400);

    await api().get(`/conversations/${id}`).set(as.mallory).expect(400);
  });

  test("conversation list only contains the caller's conversations", async () => {
    const { bob, as } = await setupUsers();
    await openDirect(as.alice, bob._id).expect(200);

    const malloryList = await api().get("/conversations").set(as.mallory).expect(200);
    assert.equal(malloryList.body.length, 0);
  });

  test("a blocked user cannot reopen a direct conversation with the blocker", async () => {
    const { alice, bob, as } = await setupUsers();
    await openDirect(as.alice, bob._id).expect(200);

    // Alice blocks Bob: their direct conversation is deleted
    await api().put(`/users/blockuser/${bob._id}`).set(as.alice).expect(200);

    // Bob must not be able to recreate it and message Alice again
    const reopened = await openDirect(as.bob, alice._id);
    assert.notEqual(reopened.status, 200, "blocked user reopened the conversation");

    // Nor through the legacy send endpoint
    const legacy = await api()
      .post(`/messages/send/${alice._id}`)
      .set(as.bob)
      .send({ message: "still here" });
    assert.notEqual(legacy.status, 200, "blocked user sent a message via legacy endpoint");
  });

  test("the blocker cannot reopen the conversation either", async () => {
    const { bob, as } = await setupUsers();
    await api().put(`/users/blockuser/${bob._id}`).set(as.alice).expect(200);
    const res = await openDirect(as.alice, bob._id);
    assert.notEqual(res.status, 200);
  });
});

describe("group conversations", () => {
  test("a group can only be created with the creator's friends", async () => {
    const { bob, mallory, as } = await setupUsers();

    await api()
      .post("/conversations/group")
      .set(as.alice)
      .send({ name: "Pals", memberIds: [bob._id.toString()] })
      .expect(201);

    await api()
      .post("/conversations/group")
      .set(as.alice)
      .send({ name: "Bad", memberIds: [mallory._id.toString()] })
      .expect(400);
  });

  test("only the owner can remove another member", async () => {
    const { alice, bob, as } = await setupUsers();
    const { user: carol } = await createUser({ username: "caroluser" });
    await befriend(alice, carol);

    const group = await api()
      .post("/conversations/group")
      .set(as.alice)
      .send({ name: "Pals", memberIds: [bob._id.toString(), carol._id.toString()] })
      .expect(201);
    const id = group.body._id;

    // Bob (not owner) cannot remove Carol
    await api().delete(`/conversations/${id}/members/${carol._id}`).set(as.bob).expect(400);

    // Alice (owner) can
    await api().delete(`/conversations/${id}/members/${carol._id}`).set(as.alice).expect(200);

    // Carol can no longer read the group
    await api()
      .get(`/conversations/${id}/messages`)
      .set(auth(tokenFor(carol)))
      .expect(400);
  });

  test("a non-member cannot add members or rename the group", async () => {
    const { bob, mallory, as } = await setupUsers();
    const group = await api()
      .post("/conversations/group")
      .set(as.alice)
      .send({ name: "Pals", memberIds: [bob._id.toString()] })
      .expect(201);
    const id = group.body._id;

    await api()
      .put(`/conversations/${id}/members`)
      .set(as.mallory)
      .send({ memberIds: [mallory._id.toString()] })
      .expect(400);
    await api().put(`/conversations/${id}`).set(as.mallory).send({ name: "Owned" }).expect(400);
  });
});

describe("uploaded images", () => {
  test("path traversal is rejected", async () => {
    const { as } = await setupUsers();
    for (const path of [
      "/messages/uploads/images/..%2F..%2F..%2F.env",
      "/users/uploads/images/..%2F..%2Ffirebase%2FserviceAccountKey.json",
      "/users/uploads/images/.env",
    ]) {
      const res = await api().get(path).set(as.alice);
      assert.equal(res.status, 400, path);
    }
  });

  test("images require authentication", async () => {
    await api().get("/messages/uploads/images/abc.jpg").expect(401);
  });

  test("a missing image is 404", async () => {
    const { as } = await setupUsers();
    await api()
      .get("/messages/uploads/images/00000000-0000-0000-0000-000000000000.jpg")
      .set(as.alice)
      .expect(404);
  });
});

describe("rate limiting", () => {
  test("authenticated routes report a per-user rate limit", async () => {
    const { as } = await setupUsers();
    const res = await api().get("/users/me").set(as.alice).expect(200);
    assert.match(res.headers.ratelimit ?? "", /1200/);
  });
});
