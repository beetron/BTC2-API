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

describe("mark read", () => {
  const markRead = (headers, conversationId, messageId) =>
    api().post(`/conversations/${conversationId}/read`).set(headers).send({ messageId });

  test("a message that arrives while the chat is open can be marked read", async () => {
    const { alice, bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    await send(as.alice, id, { message: "hi" }).expect(200);
    await readMessages(as.bob, id).expect(200);

    // Arrives while Bob has the chat open: the changes feed alone does not
    // mark it read
    const live = await send(as.alice, id, { message: "you there?" }).expect(200);
    assert.equal(await unreadFor(as.bob, id), 1);

    const res = await markRead(as.bob, id, live.body.messageId).expect(200);
    assert.equal(res.body.lastReadMessageId, live.body.messageId);
    assert.equal(res.body.unreadCount, 0);
    assert.equal(res.body.totalUnread, 0);
    assert.equal(await unreadFor(as.bob, id), 0);

    // The chat list reads the same state
    const friends = await api().get("/users/friendlist").set(as.bob).expect(200);
    assert.equal(friends.body.find((f) => f._id === alice._id.toString()).unreadCount, 0);
  });

  test("messages after the marked one stay unread; totalUnread covers every chat", async () => {
    const { bob, carol, as } = await setupUsers();
    const direct = await openDirect(as.alice, bob._id);
    const group = await openGroup(as.alice, [bob._id, carol._id]);
    const first = await send(as.alice, direct, { message: "one" }).expect(200);
    await send(as.alice, direct, { message: "two" }).expect(200);
    await send(as.alice, direct, { message: "three" }).expect(200);
    await send(as.alice, group, { message: "group hi" }).expect(200);

    const res = await markRead(as.bob, direct, first.body.messageId).expect(200);
    assert.equal(res.body.unreadCount, 2);
    assert.equal(res.body.totalUnread, 3);
    assert.equal(await unreadFor(as.bob, direct), 2);
  });

  test("the marker never moves backwards", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const older = await send(as.alice, id, { message: "older" }).expect(200);
    const newer = await send(as.alice, id, { message: "newer" }).expect(200);

    await markRead(as.bob, id, newer.body.messageId).expect(200);
    // A late request for an earlier message must not mark "newer" unread
    const res = await markRead(as.bob, id, older.body.messageId).expect(200);
    assert.equal(res.body.lastReadMessageId, newer.body.messageId);
    assert.equal(res.body.unreadCount, 0);
    assert.equal(await unreadFor(as.bob, id), 0);
  });

  test("own and deleted messages after the marker are not counted", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const seen = await send(as.alice, id, { message: "seen" }).expect(200);
    const gone = await send(as.alice, id, { message: "oops" }).expect(200);
    await api()
      .delete(`/conversations/${id}/messages/${gone.body.messageId}`)
      .set(as.alice)
      .expect(200);
    await send(as.bob, id, { message: "my reply" }).expect(200);

    // Bob's own reply moved his marker past "seen" already
    const res = await markRead(as.bob, id, seen.body.messageId).expect(200);
    assert.equal(res.body.unreadCount, 0);
  });

  test("rejects bad ids, other chats' messages and non-members", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const other = await openDirect(as.alice, carol._id);
    const sent = await send(as.alice, id, { message: "hi" }).expect(200);
    const elsewhere = await send(as.alice, other, { message: "hey" }).expect(200);

    await markRead(as.bob, id, "nope").expect(400);
    await markRead(as.bob, id, undefined).expect(400);
    await markRead(as.bob, id, elsewhere.body.messageId).expect(404);
    await markRead(as.mallory, id, sent.body.messageId).expect(400);
    await api()
      .post(`/conversations/${id}/read`)
      .send({ messageId: sent.body.messageId })
      .expect(401);
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

describe("/messages endpoints", () => {
  test("the old send, upload and get routes are gone and store nothing", async () => {
    const { alice, bob, as } = await setupUsers();

    await api()
      .post(`/messages/send/${bob._id}`)
      .set(as.alice)
      .send({ message: "old client" })
      .expect(404);
    await api()
      .post(`/messages/upload/${bob._id}`)
      .set(as.alice)
      .attach("messageImages", Buffer.from("not really a png"), {
        filename: "photo.png",
        contentType: "image/png",
      })
      .expect(404);
    await api().get(`/messages/get/${alice._id}`).set(as.bob).expect(404);

    // No conversation, message or file was created along the way
    const list = await api().get("/conversations").set(as.alice).expect(200);
    assert.equal(list.body.length, 0);
    assert.deepEqual(newUploads(), []);
  });

  test("clearing history still works and checks its id", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await send(as.alice, id, { message: "hi" }).expect(200);

    await api().delete(`/messages/delete/${sent.body.messageId}`).set(as.alice).expect(200);
    assert.equal((await readMessages(as.alice, id).expect(200)).body.messages.length, 0);

    await api().delete("/messages/delete/abc").set(as.alice).expect(400);
  });
});
