import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { fileURLToPath } from "url";
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

// Same directory the upload middleware writes to
const uploadsDir = fileURLToPath(new URL("../src/uploads/images/", import.meta.url));
const listUploads = () =>
  fs.existsSync(uploadsDir) ? new Set(fs.readdirSync(uploadsDir)) : new Set();

// Removes any upload a test left behind, so tests never pile files up in
// the real uploads directory
let uploadsBefore;
beforeEach(() => {
  uploadsBefore = listUploads();
});
afterEach(() => {
  for (const name of listUploads()) {
    if (!uploadsBefore.has(name)) fs.rmSync(`${uploadsDir}${name}`, { force: true });
  }
});
const newUploads = () => [...listUploads()].filter((name) => !uploadsBefore.has(name));

// Four users: alice is friends with bob and carol, mallory is a stranger
const setupUsers = async () => {
  const { user: alice } = await createUser({ username: "aliceuser" });
  const { user: bob } = await createUser({ username: "bobbyuser" });
  const { user: carol } = await createUser({ username: "caroluser" });
  const { user: mallory } = await createUser({ username: "malloryuser" });
  await befriend(alice, bob);
  await befriend(alice, carol);
  return {
    alice,
    bob,
    carol,
    mallory,
    as: {
      alice: auth(tokenFor(alice)),
      bob: auth(tokenFor(bob)),
      carol: auth(tokenFor(carol)),
      mallory: auth(tokenFor(mallory)),
    },
  };
};

const openDirect = async (headers, otherUserId) => {
  const res = await api()
    .post("/conversations/direct")
    .set(headers)
    .send({ userId: otherUserId.toString() })
    .expect(200);
  return res.body.conversationId;
};

const openGroup = async (headers, memberIds) => {
  const res = await api()
    .post("/conversations/group")
    .set(headers)
    .send({ name: "Pals", memberIds: memberIds.map(String) })
    .expect(201);
  return res.body._id;
};

const send = (headers, conversationId, body) =>
  api().post(`/conversations/${conversationId}/messages`).set(headers).send(body);

const readMessages = (headers, conversationId, query = {}) =>
  api().get(`/conversations/${conversationId}/messages`).set(headers).query(query);

const unreadFor = async (headers, conversationId) => {
  const res = await api().get("/conversations").set(headers).expect(200);
  return res.body.find((c) => c.conversationId === conversationId)?.unreadCount;
};

const uploadImage = (headers, conversationId, fields = {}) => {
  const req = api().post(`/conversations/${conversationId}/upload`).set(headers);
  for (const [key, value] of Object.entries(fields)) req.field(key, value);
  return req.attach("messageImages", Buffer.from("not really a png"), {
    filename: "photo.png",
    contentType: "image/png",
  });
};

describe("sending messages", () => {
  test("the response carries the stored message", async () => {
    const { alice, bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    const res = await send(as.alice, id, { message: "hi bob" }).expect(200);

    assert.equal(res.body.success, true);
    assert.equal(res.body.message.message, "hi bob");
    assert.equal(res.body.message._id, res.body.messageId);
    assert.equal(res.body.message.senderId, alice._id.toString());
    assert.equal(res.body.message.conversationId, id);
    assert.ok(res.body.message.createdAt);

    // It is the same message the other side reads
    const read = await readMessages(as.bob, id).expect(200);
    assert.equal(read.body.messages[0]._id, res.body.messageId);
  });

  test("invalid message bodies are rejected and nothing is stored", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    for (const body of [
      {},
      { message: "" },
      { message: "   \n " },
      { message: 42 },
      { message: ["hi"] },
      { message: "x".repeat(10001) },
    ]) {
      const res = await send(as.alice, id, body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 40));
      assert.ok(res.body.error);
    }

    const read = await readMessages(as.bob, id).expect(200);
    assert.equal(read.body.messages.length, 0);

    // Exactly at the limit is fine
    await send(as.alice, id, { message: "x".repeat(10000) }).expect(200);
  });

  test("malformed ids and cursors are a clear 400, unknown conversations 404", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    const badId = await readMessages(as.alice, "not-an-id");
    assert.equal(badId.status, 400);
    assert.equal(badId.body.error, "Invalid id");

    await readMessages(as.alice, "0123456789abcdef01234567").expect(404);
    await send(as.alice, "0123456789abcdef01234567", { message: "hi" }).expect(404);

    const badCursor = await readMessages(as.alice, id, { cursor: "garbage" });
    assert.equal(badCursor.status, 400);
    assert.equal(badCursor.body.error, "Invalid cursor");

    await api()
      .delete(`/conversations/${id}/members/nope`)
      .set(as.alice)
      .expect(400);
    await api()
      .post("/conversations/direct")
      .set(as.alice)
      .send({ userId: { not: "an id" } })
      .expect(400);

    // Unauthenticated requests are still 401, not 400
    await api().get("/conversations/not-an-id/messages").expect(401);
  });

  test("errors never expose internal details", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const res = await send(as.mallory, id, { message: "intrusion" }).expect(400);
    assert.equal(res.body.error, "Not a member of this conversation");
    assert.deepEqual(Object.keys(res.body), ["error"]);
  });
});

describe("clientMessageId", () => {
  test("a retry with the same clientMessageId returns the stored message", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const body = { message: "only once", clientMessageId: "3f2b9c1e-7a4d-4e8b-9c0d-1a2b3c4d5e6f" };

    const first = await send(as.alice, id, body).expect(200);
    const retry = await send(as.alice, id, body).expect(200);

    assert.equal(retry.body.messageId, first.body.messageId);
    assert.equal(retry.body.message.clientMessageId, body.clientMessageId);

    const read = await readMessages(as.bob, id).expect(200);
    assert.equal(read.body.messages.length, 1);
  });

  test("a retry does not count as another unread message", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const body = { message: "only once", clientMessageId: "retry-1" };

    await send(as.alice, id, body).expect(200);
    await send(as.alice, id, body).expect(200);

    assert.equal(await unreadFor(as.bob, id), 1);
  });

  test("two senders can use the same clientMessageId", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    await send(as.alice, id, { message: "from alice", clientMessageId: "same" }).expect(200);
    await send(as.bob, id, { message: "from bob", clientMessageId: "same" }).expect(200);

    const read = await readMessages(as.alice, id).expect(200);
    assert.equal(read.body.messages.length, 2);
  });

  test("reusing a clientMessageId in another conversation is a conflict", async () => {
    const { bob, carol, as } = await setupUsers();
    const direct = await openDirect(as.alice, bob._id);
    const group = await openGroup(as.alice, [bob._id, carol._id]);

    await send(as.alice, direct, { message: "hi", clientMessageId: "used-once" }).expect(200);
    await send(as.alice, group, { message: "hi", clientMessageId: "used-once" }).expect(409);
  });

  test("a malformed clientMessageId is rejected", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    for (const clientMessageId of ["has space", "x".repeat(65), 123, { a: 1 }]) {
      await send(as.alice, id, { message: "hi", clientMessageId }).expect(400);
    }
    // An empty value means "none given"
    await send(as.alice, id, { message: "hi", clientMessageId: "" }).expect(200);
  });
});

describe("read state", () => {
  test("group unread counts go up per recipient and reset on read", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openGroup(as.alice, [bob._id, carol._id]);

    await send(as.alice, id, { message: "one" }).expect(200);
    await send(as.alice, id, { message: "two" }).expect(200);

    assert.equal(await unreadFor(as.alice, id), 0);
    assert.equal(await unreadFor(as.bob, id), 2);
    assert.equal(await unreadFor(as.carol, id), 2);

    await readMessages(as.bob, id).expect(200);
    assert.equal(await unreadFor(as.bob, id), 0);
    assert.equal(await unreadFor(as.carol, id), 2);

    // Replying resets the sender's own count
    await send(as.carol, id, { message: "three" }).expect(200);
    assert.equal(await unreadFor(as.carol, id), 0);
    assert.equal(await unreadFor(as.bob, id), 1);
    assert.equal(await unreadFor(as.alice, id), 1);
  });

  test("messages sent at the same moment are all counted", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    await Promise.all(
      Array.from({ length: 5 }, (_, i) => send(as.alice, id, { message: `m${i}` }).expect(200))
    );

    assert.equal(await unreadFor(as.bob, id), 5);
  });

  test("pagination returns every message exactly once", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    for (const message of ["a", "b", "c"]) {
      await send(as.alice, id, { message }).expect(200);
    }

    const first = await readMessages(as.bob, id, { limit: 2 }).expect(200);
    assert.deepEqual(first.body.messages.map((m) => m.message), ["c", "b"]);
    assert.ok(first.body.nextCursor);

    const second = await readMessages(as.bob, id, {
      limit: 2,
      cursor: first.body.nextCursor,
    }).expect(200);
    assert.deepEqual(second.body.messages.map((m) => m.message), ["a"]);
    assert.equal(second.body.nextCursor, null);
  });

  test("clearing history hides it for one side; both sides clearing deletes the chat", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await send(as.alice, id, { message: "bye" }).expect(200);

    await api().delete(`/messages/delete/${sent.body.messageId}`).set(as.alice).expect(200);
    assert.equal((await readMessages(as.alice, id).expect(200)).body.messages.length, 0);
    assert.equal((await readMessages(as.bob, id).expect(200)).body.messages.length, 1);

    await api().delete(`/messages/delete/${sent.body.messageId}`).set(as.bob).expect(200);
    const list = await api().get("/conversations").set(as.alice).expect(200);
    assert.equal(list.body.length, 0);
  });
});

describe("image uploads", () => {
  test("an upload is stored and returned like a text message", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    const res = await uploadImage(as.alice, id).expect(200);
    assert.equal(res.body.message.imageFiles.length, 1);
    assert.deepEqual(newUploads(), res.body.message.imageFiles);
  });

  test("a rejected upload leaves no file behind", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    await uploadImage(as.mallory, id).expect(400);
    assert.deepEqual(newUploads(), []);
  });

  test("a retried upload keeps only the first copy of the image", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);

    const first = await uploadImage(as.alice, id, { clientMessageId: "photo-1" }).expect(200);
    const retry = await uploadImage(as.alice, id, { clientMessageId: "photo-1" }).expect(200);

    assert.equal(retry.body.messageId, first.body.messageId);
    assert.deepEqual(newUploads(), first.body.message.imageFiles);
  });
});

describe("legacy /messages endpoints", () => {
  test("send, upload and get are marked deprecated", async () => {
    const { alice, bob, as } = await setupUsers();

    const sent = await api()
      .post(`/messages/send/${bob._id}`)
      .set(as.alice)
      .send({ message: "old client" })
      .expect(200);
    assert.match(sent.headers.deprecation ?? "", /^@\d+$/);
    assert.deepEqual(sent.body, { success: true });

    const uploaded = await api()
      .post(`/messages/upload/${bob._id}`)
      .set(as.alice)
      .attach("messageImages", Buffer.from("not really a png"), {
        filename: "photo.png",
        contentType: "image/png",
      })
      .expect(200);
    assert.match(uploaded.headers.deprecation ?? "", /^@\d+$/);

    const read = await api().get(`/messages/get/${alice._id}`).set(as.bob).expect(200);
    assert.match(read.headers.deprecation ?? "", /^@\d+$/);
    assert.equal(read.body.length, 2);

    // Clearing history is still in use and not deprecated
    const cleared = await api().delete(`/messages/delete/${read.body[0]._id}`).set(as.bob).expect(200);
    assert.equal(cleared.headers.deprecation, undefined);
  });

  test("sending without a message is a 400 and stores nothing", async () => {
    const { alice, bob, as } = await setupUsers();

    await api().post(`/messages/send/${bob._id}`).set(as.alice).send({}).expect(400);

    const read = await api().get(`/messages/get/${alice._id}`).set(as.bob).expect(200);
    assert.equal(read.body.length, 0);
  });

  test("a malformed user id is a 400", async () => {
    const { as } = await setupUsers();
    await api().post("/messages/send/abc").set(as.alice).send({ message: "hi" }).expect(400);
    await api().delete("/messages/delete/abc").set(as.alice).expect(400);
  });
});
