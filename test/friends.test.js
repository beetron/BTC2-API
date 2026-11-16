import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  startTestApp,
  stopTestApp,
  clearDatabase,
  api,
  User,
  createUser,
  tokenFor,
  auth,
  befriend,
} from "./helpers/setup.js";

before(startTestApp);
after(stopTestApp);
beforeEach(clearDatabase);

const setupUsers = async () => {
  const { user: alice } = await createUser({ username: "aliceuser", uniqueId: "aliceid" });
  const { user: bob } = await createUser({ username: "bobbyuser", uniqueId: "bobbyid" });
  const { user: mallory } = await createUser({ username: "malloryuser", uniqueId: "malloryid" });
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

const isFriend = async (user, other) =>
  (await User().findById(user._id)).friendList.some((id) => id.equals(other._id));

const request = (headers, uniqueId) =>
  api().put(`/users/addfriend/${uniqueId}`).set(headers);
const accept = (headers, uniqueId) =>
  api().put(`/users/acceptfriend/${uniqueId}`).set(headers);

describe("friend requests", () => {
  test("accepting a request that was never sent does not make anyone friends", async () => {
    const { alice, mallory, as } = await setupUsers();

    // Mallory knows Alice's ID and tries to skip the request
    const res = await accept(as.mallory, "aliceid");
    assert.equal(res.status, 400);
    assert.equal(await isFriend(alice, mallory), false);
    assert.equal(await isFriend(mallory, alice), false);
  });

  test("a real request can still be accepted", async () => {
    const { alice, bob, as } = await setupUsers();
    await request(as.bob, "aliceid").expect(200);
    await accept(as.alice, "bobbyid").expect(200);
    assert.equal(await isFriend(alice, bob), true);
    assert.equal(await isFriend(bob, alice), true);
    assert.equal((await User().findById(alice._id)).friendRequests.length, 0);
  });

  test("a pending request from someone blocked since cannot be accepted", async () => {
    const { alice, bob, as } = await setupUsers();
    await request(as.bob, "aliceid").expect(200);
    await User().updateOne({ _id: bob._id }, { $addToSet: { blockedUsers: alice._id } });

    await accept(as.alice, "bobbyid").expect(400);
    assert.equal(await isFriend(alice, bob), false);
    // The dead request is cleared out of Alice's list
    assert.equal((await User().findById(alice._id)).friendRequests.length, 0);
  });

  test("you can't send a request to someone you blocked", async () => {
    const { alice, bob, as } = await setupUsers();
    await User().updateOne({ _id: alice._id }, { $addToSet: { blockedUsers: bob._id } });
    const res = await request(as.alice, "bobbyid");
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "Unblock this user first");
  });
});

describe("removing a friend", () => {
  test("clears the chat's unread count and stops messages in it", async () => {
    const { alice, bob, as } = await setupUsers();
    await befriend(alice, bob);
    const { body } = await api()
      .post("/conversations/direct")
      .set(as.bob)
      .send({ userId: alice._id.toString() })
      .expect(200);
    const id = body.conversationId;
    for (const message of ["one", "two", "three"]) {
      await api().post(`/conversations/${id}/messages`).set(as.bob).send({ message }).expect(200);
    }

    await api().put(`/users/removefriend/bobbyid`).set(as.alice).expect(200);

    const ReadState = (await import("../src/models/conversationReadState.model.js")).default;
    const state = await ReadState.findOne({ conversationId: id, userId: alice._id }).lean();
    assert.equal(state.unreadCount, 0);

    // Bob still has the chat open: his next message is refused
    const res = await api()
      .post(`/conversations/${id}/messages`)
      .set(as.bob)
      .send({ message: "still there?" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "You can only message friends");
  });
});

describe("push tokens", () => {
  test("registering a token moves it off the account that used the device before", async () => {
    const { alice, bob, as } = await setupUsers();
    await api()
      .put("/users/fcm/register")
      .set(as.alice)
      .send({ token: "device-token-1", device: "ios", deviceId: "phone-1" })
      .expect(200);

    // Alice's logout never reached the server; Bob signs in on the same phone
    await api()
      .put("/users/fcm/register")
      .set(as.bob)
      .send({ token: "device-token-1", device: "ios", deviceId: "phone-1" })
      .expect(200);

    assert.equal((await User().findById(alice._id)).fcmTokens.length, 0);
    assert.deepEqual(
      (await User().findById(bob._id)).fcmTokens.map((t) => t.token),
      ["device-token-1"]
    );
  });

  test("a new token for the same device also replaces the old account's entry", async () => {
    const { alice, as } = await setupUsers();
    await api()
      .put("/users/fcm/register")
      .set(as.alice)
      .send({ token: "old-token", device: "ios", deviceId: "phone-1" })
      .expect(200);
    await api()
      .put("/users/fcm/register")
      .set(as.bob)
      .send({ token: "new-token", device: "ios", deviceId: "phone-1" })
      .expect(200);

    assert.equal((await User().findById(alice._id)).fcmTokens.length, 0);
  });
});
