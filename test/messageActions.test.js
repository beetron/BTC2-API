import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
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

const uploadsDir = fileURLToPath(new URL("../src/uploads/images/", import.meta.url));
const listUploads = () =>
  fs.existsSync(uploadsDir) ? new Set(fs.readdirSync(uploadsDir)) : new Set();
let uploadsBefore;
beforeEach(() => {
  uploadsBefore = listUploads();
});
afterEach(() => {
  for (const name of listUploads()) {
    if (!uploadsBefore.has(name)) fs.rmSync(`${uploadsDir}${name}`, { force: true });
  }
});

// Captures every socket event the API emits during a test instead of
// sending it, so tests can check what clients are told
let emitted;
let restoreIo;
beforeEach(async () => {
  const { io } = await import("../src/socket/socket.js");
  const originalTo = io.to;
  emitted = [];
  io.to = (room) => ({
    except: () => ({
      emit: (event, payload) => emitted.push({ room, event, payload }),
    }),
    emit: (event, payload) => emitted.push({ room, event, payload }),
  });
  restoreIo = () => {
    io.to = originalTo;
  };
});
afterEach(() => restoreIo());

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

const sendOk = async (headers, conversationId, body) =>
  (await send(headers, conversationId, body).expect(200)).body.message;

const edit = (headers, conversationId, messageId, body) =>
  api()
    .patch(`/conversations/${conversationId}/messages/${messageId}`)
    .set(headers)
    .send(body);

const remove = (headers, conversationId, messageId) =>
  api().delete(`/conversations/${conversationId}/messages/${messageId}`).set(headers);

const history = async (headers, conversationId, query = {}) =>
  (
    await api()
      .get(`/conversations/${conversationId}/messages`)
      .set(headers)
      .query(query)
      .expect(200)
  ).body.messages;

const unreadFor = async (headers, conversationId) => {
  const res = await api().get("/conversations").set(headers).expect(200);
  return res.body.find((c) => c.conversationId === conversationId)?.unreadCount;
};

const eventsFor = (action) =>
  emitted.filter((e) => e.event === "conversation:message" && e.payload.action === action);

describe("quote reply", () => {
  test("a reply carries a preview of the quoted message, in the response and in history", async () => {
    const { alice, bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const original = await sendOk(as.alice, id, { message: "lunch at noon?" });

    const reply = await sendOk(as.bob, id, { message: "yes!", replyToId: original._id });
    assert.equal(reply.replyToId, original._id);
    assert.deepEqual(reply.replyTo, {
      _id: original._id,
      senderId: alice._id.toString(),
      message: "lunch at noon?",
      hasImages: false,
      imageFile: null,
      imagesExpired: false,
      deleted: false,
      unavailable: false,
    });

    const [newest, older] = await history(as.alice, id);
    assert.equal(newest._id, reply._id);
    assert.equal(newest.replyTo.message, "lunch at noon?");
    // A message that is not a reply has no replyTo at all
    assert.equal(older.replyTo, undefined);
  });

  test("the preview is cut to 200 characters", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const original = await sendOk(as.alice, id, { message: "a".repeat(500) });

    const reply = await sendOk(as.bob, id, { message: "tl;dr", replyToId: original._id });
    assert.equal(reply.replyTo.message.length, 200);
  });

  test("the preview follows edits and deletes of the original", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const original = await sendOk(as.alice, id, { message: "typo" });
    const reply = await sendOk(as.bob, id, { message: "what?", replyToId: original._id });

    await edit(as.alice, id, original._id, { message: "fixed" }).expect(200);
    let found = (await history(as.bob, id)).find((m) => m._id === reply._id);
    assert.equal(found.replyTo.message, "fixed");

    await remove(as.alice, id, original._id).expect(200);
    found = (await history(as.bob, id)).find((m) => m._id === reply._id);
    assert.equal(found.replyTo.deleted, true);
    assert.equal(found.replyTo.message, null);
  });

  test("a quoted message that no longer exists shows as unavailable", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const original = await sendOk(as.alice, id, { message: "soon gone" });
    await sendOk(as.bob, id, { message: "ok", replyToId: original._id });

    // As after an admin purge of everything alice sent
    await mongoose.model("Message").deleteOne({ _id: original._id });

    const [reply] = await history(as.bob, id);
    assert.equal(reply.replyTo.unavailable, true);
    assert.equal(reply.replyTo.message, null);
  });

  test("a reply can only quote a live message of the same conversation", async () => {
    const { bob, carol, as } = await setupUsers();
    const direct = await openDirect(as.alice, bob._id);
    const group = await openGroup(as.alice, [bob._id, carol._id]);
    const elsewhere = await sendOk(as.alice, group, { message: "group secret" });

    const crossed = await send(as.bob, direct, { message: "hm", replyToId: elsewhere._id });
    assert.equal(crossed.status, 400);
    assert.equal(crossed.body.error, "Cannot reply to that message");

    await send(as.bob, direct, { message: "hm", replyToId: "0123456789abcdef01234567" }).expect(400);
    await send(as.bob, direct, { message: "hm", replyToId: "nope" }).expect(400);

    const gone = await sendOk(as.alice, direct, { message: "oops" });
    await remove(as.alice, direct, gone._id).expect(200);
    const toDeleted = await send(as.bob, direct, { message: "hm", replyToId: gone._id });
    assert.equal(toDeleted.status, 400);
    assert.equal(toDeleted.body.error, "Cannot reply to a deleted message");

    // Nothing was stored by the rejected replies
    assert.equal((await history(as.bob, direct)).length, 0);
  });

  test("an image upload can be a reply", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const original = await sendOk(as.alice, id, { message: "send a photo" });

    const res = await api()
      .post(`/conversations/${id}/upload`)
      .set(as.bob)
      .field("replyToId", original._id)
      .attach("messageImages", Buffer.from("not really a png"), {
        filename: "photo.png",
        contentType: "image/png",
      })
      .expect(200);
    assert.equal(res.body.message.replyTo.message, "send a photo");
  });
});

describe("edit", () => {
  test("the sender can edit; everyone sees the new text and editedAt", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openGroup(as.alice, [bob._id, carol._id]);
    const sent = await sendOk(as.alice, id, { message: "helo" });
    assert.equal(sent.editedAt, null);

    const res = await edit(as.alice, id, sent._id, { message: "hello" }).expect(200);
    assert.equal(res.body.message.message, "hello");
    assert.ok(res.body.message.editedAt);

    for (const viewer of [as.bob, as.carol]) {
      const [msg] = await history(viewer, id);
      assert.equal(msg.message, "hello");
      assert.ok(msg.editedAt);
    }

    const events = eventsFor("edited");
    assert.equal(events.length, 1);
    assert.equal(events[0].room, id);
    assert.equal(events[0].payload.messageId.toString(), sent._id);
  });

  test("an unchanged edit writes nothing and tells nobody", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await sendOk(as.alice, id, { message: "same" });

    const res = await edit(as.alice, id, sent._id, { message: "same" }).expect(200);
    assert.equal(res.body.message.editedAt, null);
    assert.equal(eventsFor("edited").length, 0);
  });

  test("only the sender can edit, even in a group the caller owns", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openGroup(as.alice, [bob._id, carol._id]);
    const bobs = await sendOk(as.bob, id, { message: "bob's words" });

    const byOwner = await edit(as.alice, id, bobs._id, { message: "alice's words" });
    assert.equal(byOwner.status, 400);
    assert.equal(byOwner.body.error, "You can only edit your own messages");

    await edit(as.mallory, id, bobs._id, { message: "x" }).expect(400);

    const [msg] = await history(as.bob, id);
    assert.equal(msg.message, "bob's words");
  });

  test("edits follow the same text rules as sending", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await sendOk(as.alice, id, { message: "ok" });

    for (const body of [{}, { message: "" }, { message: "  " }, { message: 5 }, { message: "x".repeat(10001) }]) {
      await edit(as.alice, id, sent._id, body).expect(400);
    }
  });

  test("a deleted message cannot be edited", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await sendOk(as.alice, id, { message: "ok" });
    await remove(as.alice, id, sent._id).expect(200);

    const res = await edit(as.alice, id, sent._id, { message: "back?" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Cannot edit a deleted message");
  });

  test("a message id from another conversation is 404", async () => {
    const { bob, carol, as } = await setupUsers();
    const direct = await openDirect(as.alice, bob._id);
    const group = await openGroup(as.alice, [bob._id, carol._id]);
    const sent = await sendOk(as.alice, group, { message: "in the group" });

    await edit(as.alice, direct, sent._id, { message: "moved?" }).expect(404);
    await remove(as.alice, direct, sent._id).expect(404);
    await edit(as.alice, direct, "bad-id", { message: "x" }).expect(400);
  });
});

describe("delete for everyone", () => {
  test("the message disappears for older clients and becomes a tombstone for newer ones", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const kept = await sendOk(as.alice, id, { message: "keep" });
    const sent = await sendOk(as.alice, id, { message: "regret" });

    const res = await remove(as.alice, id, sent._id).expect(200);
    assert.equal(res.body.message.message, null);
    assert.ok(res.body.message.deletedAt);

    // Default history (what current clients request): gone
    const plain = await history(as.bob, id);
    assert.deepEqual(plain.map((m) => m._id), [kept._id]);

    // includeDeleted: a tombstone in its place, with no content
    const withDeleted = await history(as.bob, id, { includeDeleted: "1" });
    assert.equal(withDeleted.length, 2);
    const tombstone = withDeleted.find((m) => m._id === sent._id);
    assert.equal(tombstone.message, null);
    assert.deepEqual(tombstone.imageFiles, []);
    assert.ok(tombstone.deletedAt);

    const events = eventsFor("deleted");
    assert.equal(events.length, 1);
    assert.equal(events[0].payload.messageId.toString(), sent._id);
  });

  test("only the sender can delete, a group owner cannot delete others' messages", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openGroup(as.alice, [bob._id, carol._id]);
    const bobs = await sendOk(as.bob, id, { message: "mine" });

    const byOwner = await remove(as.alice, id, bobs._id);
    assert.equal(byOwner.status, 400);
    assert.equal(byOwner.body.error, "You can only delete your own messages");
    await remove(as.carol, id, bobs._id).expect(400);
    await remove(as.mallory, id, bobs._id).expect(400);

    assert.equal((await history(as.carol, id)).length, 1);
  });

  test("deleting twice is fine and only announced once", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await sendOk(as.alice, id, { message: "x" });

    await remove(as.alice, id, sent._id).expect(200);
    await remove(as.alice, id, sent._id).expect(200);
    assert.equal(eventsFor("deleted").length, 1);
  });

  test("an unread deleted message stops counting as unread", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openGroup(as.alice, [bob._id, carol._id]);
    await sendOk(as.alice, id, { message: "one" });
    const two = await sendOk(as.alice, id, { message: "two" });

    // Carol reads both, bob reads nothing
    await history(as.carol, id);
    assert.equal(await unreadFor(as.bob, id), 2);
    assert.equal(await unreadFor(as.carol, id), 0);

    await remove(as.alice, id, two._id).expect(200);
    assert.equal(await unreadFor(as.bob, id), 1);
    assert.equal(await unreadFor(as.carol, id), 0);
  });

  test("a message read before newer ones arrived is not subtracted", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const one = await sendOk(as.alice, id, { message: "one" });
    await history(as.bob, id);
    await sendOk(as.alice, id, { message: "two" });
    assert.equal(await unreadFor(as.bob, id), 1);

    // "one" was already read: deleting it leaves "two" unread
    await remove(as.alice, id, one._id).expect(200);
    assert.equal(await unreadFor(as.bob, id), 1);
  });

  test("the deleted message's images are removed from disk", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const res = await api()
      .post(`/conversations/${id}/upload`)
      .set(as.alice)
      .attach("messageImages", Buffer.from("not really a png"), {
        filename: "photo.png",
        contentType: "image/png",
      })
      .expect(200);
    const [filename] = res.body.message.imageFiles;
    assert.ok(fs.existsSync(`${uploadsDir}${filename}`));

    await remove(as.alice, id, res.body.messageId).expect(200);
    assert.equal(fs.existsSync(`${uploadsDir}${filename}`), false);
  });

  test("clearing history still deletes the chat when the newest message was deleted", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const visible = await sendOk(as.alice, id, { message: "visible" });
    const gone = await sendOk(as.alice, id, { message: "gone" });
    await remove(as.alice, id, gone._id).expect(200);

    await api().delete(`/messages/delete/${visible._id}`).set(as.alice).expect(200);
    await api().delete(`/messages/delete/${visible._id}`).set(as.bob).expect(200);

    const list = await api().get("/conversations").set(as.alice).expect(200);
    assert.equal(list.body.length, 0);
  });
});

describe("changes feed", () => {
  test("returns messages created, edited or deleted since a time, oldest change first", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const a = await sendOk(as.alice, id, { message: "a" });
    const b = await sendOk(as.alice, id, { message: "b" });
    const since = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));

    await edit(as.alice, id, a._id, { message: "a2" }).expect(200);
    await remove(as.alice, id, b._id).expect(200);
    const c = await sendOk(as.bob, id, { message: "c" });

    const res = await api()
      .get(`/conversations/${id}/messages/changes`)
      .set(as.bob)
      .query({ since })
      .expect(200);
    assert.deepEqual(res.body.messages.map((m) => m._id), [a._id, b._id, c._id]);
    assert.equal(res.body.messages[0].message, "a2");
    assert.ok(res.body.messages[1].deletedAt);
    assert.equal(res.body.hasMore, false);
    assert.ok(res.body.nextCursor);

    // Nothing new since the cursor
    const again = await api()
      .get(`/conversations/${id}/messages/changes`)
      .set(as.bob)
      .query({ cursor: res.body.nextCursor })
      .expect(200);
    assert.deepEqual(again.body.messages, []);
    assert.equal(again.body.nextCursor, null);
  });

  test("pages with the cursor without skipping or repeating", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = [];
    for (const message of ["1", "2", "3", "4", "5"]) {
      sent.push((await sendOk(as.alice, id, { message }))._id);
    }

    const seen = [];
    let query = { since: new Date(0).toISOString(), limit: 2 };
    for (;;) {
      const res = await api()
        .get(`/conversations/${id}/messages/changes`)
        .set(as.bob)
        .query(query)
        .expect(200);
      seen.push(...res.body.messages.map((m) => m._id));
      if (!res.body.hasMore) break;
      query = { cursor: res.body.nextCursor, limit: 2 };
    }
    assert.deepEqual(seen, sent);
  });

  test("respects cleared history, membership and bad input", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const old = await sendOk(as.alice, id, { message: "old" });
    await api().delete(`/messages/delete/${old._id}`).set(as.bob).expect(200);
    await edit(as.alice, id, old._id, { message: "old, edited" }).expect(200);

    const res = await api()
      .get(`/conversations/${id}/messages/changes`)
      .set(as.bob)
      .query({ since: new Date(0).toISOString() })
      .expect(200);
    assert.equal(res.body.messages.length, 0, "bob cleared it, an edit must not bring it back");

    const base = `/conversations/${id}/messages/changes`;
    await api().get(base).set(as.mallory).query({ since: new Date(0).toISOString() }).expect(400);
    await api().get(base).set(as.bob).expect(400);
    await api().get(base).set(as.bob).query({ since: "yesterday-ish" }).expect(400);
    await api().get(base).set(as.bob).query({ cursor: "junk" }).expect(400);
  });
});

describe("push notifications", () => {
  // Nobody has a socket connected in tests, so every recipient counts as
  // offline and would get a push for a new message
  let pushes;
  let delivery;
  beforeEach(async () => {
    delivery = await import("../src/services/messageDelivery.js");
    pushes = [];
    delivery.setPushSenderForTests(async (userId, notification) => {
      pushes.push({ userId: userId.toString(), type: notification.payload?.type });
    });
  });
  afterEach(() => delivery.setPushSenderForTests(null));

  // Pushes go out after the response, so let them run before counting
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  test("a new message pushes, editing and deleting it never do", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openGroup(as.alice, [bob._id, carol._id]);

    const sent = await sendOk(as.alice, id, { message: "hello" });
    await settle();
    assert.deepEqual(
      pushes.map((p) => p.userId).sort(),
      [bob._id.toString(), carol._id.toString()].sort()
    );
    assert.ok(pushes.every((p) => p.type === "chat_message"));

    pushes.length = 0;
    await edit(as.alice, id, sent._id, { message: "hello again" }).expect(200);
    await remove(as.alice, id, sent._id).expect(200);
    await settle();
    assert.deepEqual(pushes, [], "edit or delete sent a push notification");
  });

  test("editing or deleting an image message never pushes", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const res = await api()
      .post(`/conversations/${id}/upload`)
      .set(as.alice)
      .attach("messageImages", Buffer.from("not really a png"), {
        filename: "photo.png",
        contentType: "image/png",
      })
      .expect(200);
    await settle();
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0].type, "chat_image");

    pushes.length = 0;
    await edit(as.alice, id, res.body.messageId, { message: "caption" }).expect(200);
    await remove(as.alice, id, res.body.messageId).expect(200);
    await settle();
    assert.deepEqual(pushes, []);
  });

  test("a retried send does not push twice", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const body = { message: "once", clientMessageId: "push-once" };

    await sendOk(as.alice, id, body);
    await sendOk(as.alice, id, body);
    await settle();
    assert.equal(pushes.length, 1);
  });
});

describe("events and features", () => {
  test("new messages announce action: created", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await sendOk(as.alice, id, { message: "hi", clientMessageId: "c-1" });

    const [event] = eventsFor("created");
    assert.equal(event.payload.conversationId, id);
    assert.equal(event.payload.messageId.toString(), sent._id);
    assert.equal(event.payload.clientMessageId, "c-1");
  });

  test("creating a group tells its members, and a removed member hears it too", async () => {
    const { bob, carol, as } = await setupUsers();
    const id = await openGroup(as.alice, [bob._id, carol._id]);

    const added = emitted.find((e) => e.event === "conversation:memberAdded");
    assert.equal(added.room, id);
    assert.equal(added.payload.memberIds.length, 3);

    await api().delete(`/conversations/${id}/members/${carol._id}`).set(as.alice).expect(200);
    const removed = emitted.find((e) => e.event === "conversation:memberRemoved");
    assert.equal(removed.payload.userId, carol._id.toString());
  });

  test("clearing a chat from both sides announces conversation:deleted", async () => {
    const { bob, as } = await setupUsers();
    const id = await openDirect(as.alice, bob._id);
    const sent = await sendOk(as.alice, id, { message: "bye" });
    await api().delete(`/messages/delete/${sent._id}`).set(as.alice).expect(200);
    assert.equal(emitted.some((e) => e.event === "conversation:deleted"), false);
    await api().delete(`/messages/delete/${sent._id}`).set(as.bob).expect(200);
    const deleted = emitted.find((e) => e.event === "conversation:deleted");
    assert.equal(deleted.payload.conversationId, id);
  });

  test("/config lists the new features", async () => {
    const res = await api().get("/config").expect(200);
    for (const feature of ["reply", "edit", "delete", "messageChanges", "clientMessageId", "markRead"]) {
      assert.ok(res.body.features.includes(feature), feature);
    }
    assert.ok(res.body.apiVersion);
  });
});
