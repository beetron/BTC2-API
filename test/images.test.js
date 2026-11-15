import { test, describe, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import sharp from "sharp";
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
import { MAX_IMAGE_DIMENSION } from "../src/middleware/uploadImage.js";
import { expireOldImages, parseRetentionDays } from "../src/services/imageExpiry.js";

before(startTestApp);
after(stopTestApp);
beforeEach(clearDatabase);

// Removes every file a test added to the uploads folder
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
const stored = (filename) => fs.existsSync(`${uploadsDir}${filename}`);

const Message = () => mongoose.model("Message");

const setup = async () => {
  const { user: alice } = await createUser({ username: "aliceuser" });
  const { user: bob } = await createUser({ username: "bobbyuser" });
  await befriend(alice, bob);
  const as = { alice: auth(tokenFor(alice)), bob: auth(tokenFor(bob)) };
  const res = await api()
    .post("/conversations/direct")
    .set(as.alice)
    .send({ userId: bob._id.toString() })
    .expect(200);
  return { alice, bob, as, id: res.body.conversationId };
};

const upload = (headers, id, files, fields = {}) => {
  let req = api().post(`/conversations/${id}/upload`).set(headers);
  for (const [name, value] of Object.entries(fields)) req = req.field(name, value);
  for (const { buffer, filename, contentType } of files) {
    req = req.attach("messageImages", buffer, { filename, contentType });
  }
  return req;
};

const png = (width, height, { alpha = false } = {}) =>
  sharp({
    create: {
      width,
      height,
      channels: alpha ? 4 : 3,
      background: alpha ? { r: 255, g: 0, b: 0, alpha: 0 } : { r: 20, g: 120, b: 200 },
    },
  })
    .png()
    .toBuffer();

const history = async (headers, id) =>
  (await api().get(`/conversations/${id}/messages`).set(headers).expect(200)).body.messages;

// Moves a message back in time, as if it had been sent `days` ago
const age = (messageId, days) =>
  Message().collection.updateOne(
    { _id: new mongoose.Types.ObjectId(messageId) },
    { $set: { createdAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000) } }
  );

describe("upload compression", () => {
  test("a large image is stored as a JPEG no bigger than the maximum size", async () => {
    const { as, id } = await setup();
    const res = await upload(as.alice, id, [
      { buffer: await png(4000, 3000), filename: "big.png", contentType: "image/png" },
    ]).expect(200);

    const [filename] = res.body.message.imageFiles;
    assert.match(filename, /^[0-9a-f-]+\.jpg$/);
    const meta = await sharp(`${uploadsDir}${filename}`).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, MAX_IMAGE_DIMENSION);
    assert.equal(meta.height, 1920);
    // Only the compressed file is kept
    assert.equal(listUploads().size, uploadsBefore.size + 1);
  });

  test("a small image keeps its size, transparency becomes white", async () => {
    const { as, id } = await setup();
    const res = await upload(as.alice, id, [
      { buffer: await png(40, 30, { alpha: true }), filename: "s.png", contentType: "image/png" },
    ]).expect(200);

    const file = `${uploadsDir}${res.body.message.imageFiles[0]}`;
    const meta = await sharp(file).metadata();
    assert.equal(meta.width, 40);
    assert.equal(meta.hasAlpha, false);
    const { data } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 240 && data[1] > 240 && data[2] > 240);
  });

  test("a photo is turned upright and its metadata (GPS, camera) is dropped", async () => {
    const { as, id } = await setup();
    // 300x100 pixels, with EXIF saying "rotate 90 degrees to display"
    const photo = await sharp(await png(300, 100))
      .jpeg()
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Make: "TestCam" } })
      .toBuffer();
    assert.ok((await sharp(photo).metadata()).exif);

    const res = await upload(as.alice, id, [
      { buffer: photo, filename: "IMG_0001.JPG", contentType: "image/jpeg" },
    ]).expect(200);

    const meta = await sharp(`${uploadsDir}${res.body.message.imageFiles[0]}`).metadata();
    assert.equal(meta.width, 100);
    assert.equal(meta.height, 300);
    assert.equal(meta.exif, undefined);
    assert.equal(meta.orientation, undefined);
  });

  test("a file sharp cannot read is kept as uploaded", async () => {
    const { as, id } = await setup();
    const res = await upload(as.alice, id, [
      { buffer: Buffer.from("not really a heic"), filename: "x.heic", contentType: "image/heic" },
    ]).expect(200);
    const [filename] = res.body.message.imageFiles;
    assert.match(filename, /\.heic$/);
    assert.ok(stored(filename));
  });
});

describe("reply thumbnail", () => {
  test("a reply to a photo carries the first photo's filename", async () => {
    const { as, id } = await setup();
    const photos = await upload(as.alice, id, [
      { buffer: await png(50, 50), filename: "a.png", contentType: "image/png" },
      { buffer: await png(60, 60), filename: "b.png", contentType: "image/png" },
    ]).expect(200);
    const original = photos.body.message;

    const res = await api()
      .post(`/conversations/${id}/messages`)
      .set(as.bob)
      .send({ message: "nice", replyToId: original._id })
      .expect(200);
    assert.equal(res.body.message.replyTo.hasImages, true);
    assert.equal(res.body.message.replyTo.imageFile, original.imageFiles[0]);
    assert.equal(res.body.message.replyTo.imagesExpired, false);

    // The thumbnail file can be loaded by the other member
    await api().get(`/messages/uploads/images/${original.imageFiles[0]}`).set(as.bob).expect(200);
  });

  test("a deleted photo message leaves no thumbnail in quotes", async () => {
    const { as, id } = await setup();
    const photos = await upload(as.alice, id, [
      { buffer: await png(50, 50), filename: "a.png", contentType: "image/png" },
    ]).expect(200);
    const original = photos.body.message;
    await api()
      .post(`/conversations/${id}/messages`)
      .set(as.bob)
      .send({ message: "nice", replyToId: original._id })
      .expect(200);
    await api().delete(`/conversations/${id}/messages/${original._id}`).set(as.alice).expect(200);

    const [reply] = await history(as.bob, id);
    assert.equal(reply.replyTo.deleted, true);
    assert.equal(reply.replyTo.imageFile, null);
  });
});

describe("image expiry", () => {
  test("parseRetentionDays defaults to 30 and refuses values that are not whole days", () => {
    assert.equal(parseRetentionDays(undefined), 30);
    assert.equal(parseRetentionDays(""), 30);
    assert.equal(parseRetentionDays("7"), 7);
    for (const bad of ["0", "-1", "30d", "1.5", " 30"]) {
      assert.throws(() => parseRetentionDays(bad), /IMAGE_RETENTION_DAYS/);
    }
  });

  test("deletes only old photos, marks their messages, and keeps everything else", async () => {
    const { as, id } = await setup();
    const photo = async () =>
      (
        await upload(as.alice, id, [
          { buffer: await png(50, 50), filename: "a.png", contentType: "image/png" },
          { buffer: await png(50, 50), filename: "b.png", contentType: "image/png" },
        ]).expect(200)
      ).body.message;
    const oldPhoto = await photo();
    const newPhoto = await photo();
    const oldText = (
      await api().post(`/conversations/${id}/messages`).set(as.alice).send({ message: "hi" })
    ).body.message;
    await age(oldPhoto._id, 31);
    await age(oldText._id, 31);
    // A profile image lives in the same folder and must never be touched
    const profileImage = "00000000-0000-4000-8000-000000000001.jpg";
    fs.writeFileSync(`${uploadsDir}${profileImage}`, "profile");

    const quote = await api()
      .post(`/conversations/${id}/messages`)
      .set(as.bob)
      .send({ message: "old one", replyToId: oldPhoto._id })
      .expect(200);
    const since = new Date().toISOString();
    await new Promise((resolve) => setTimeout(resolve, 5));

    // Dry run: counts, deletes nothing
    const dry = await expireOldImages({ retentionDays: 30, dryRun: true });
    assert.equal(dry.messages, 1);
    assert.equal(dry.files, 2);
    assert.ok(oldPhoto.imageFiles.every(stored));
    assert.equal((await Message().findById(oldPhoto._id)).imagesExpiredAt, null);

    const totals = await expireOldImages({ retentionDays: 30 });
    assert.equal(totals.messages, 1);
    assert.equal(totals.files, 2);
    assert.ok(totals.bytes > 0);
    assert.ok(oldPhoto.imageFiles.every((f) => !stored(f)));
    assert.ok(newPhoto.imageFiles.every(stored));
    assert.ok(stored(profileImage));

    // History keeps the filenames, so clients know how many photos there were
    const messages = await history(as.bob, id);
    const expired = messages.find((m) => m._id === oldPhoto._id);
    assert.deepEqual(expired.imageFiles, oldPhoto.imageFiles);
    assert.ok(expired.imagesExpiredAt);
    assert.equal(messages.find((m) => m._id === newPhoto._id).imagesExpiredAt, null);
    assert.equal(messages.find((m) => m._id === oldText._id).imagesExpiredAt, null);

    // Quotes of it show the expired state instead of a thumbnail
    const reply = messages.find((m) => m._id === quote.body.message._id);
    assert.equal(reply.replyTo.hasImages, true);
    assert.equal(reply.replyTo.imageFile, null);
    assert.equal(reply.replyTo.imagesExpired, true);

    // The expiry reaches clients through the changes feed
    const changes = await api()
      .get(`/conversations/${id}/messages/changes`)
      .set(as.bob)
      .query({ since })
      .expect(200);
    assert.deepEqual(
      changes.body.messages.map((m) => m._id),
      [oldPhoto._id]
    );

    // The file itself is gone
    await api()
      .get(`/messages/uploads/images/${oldPhoto.imageFiles[0]}`)
      .set(as.bob)
      .expect(404);

    // Running again finds nothing left to do
    const again = await expireOldImages({ retentionDays: 30 });
    assert.equal(again.messages, 0);

    // Deleting an expired message for everyone still works
    await api().delete(`/conversations/${id}/messages/${oldPhoto._id}`).set(as.alice).expect(200);
  });

  test("a run stopped after deleting the files is finished by the next run", async () => {
    const { as, id } = await setup();
    const photo = (
      await upload(as.alice, id, [
        { buffer: await png(50, 50), filename: "a.png", contentType: "image/png" },
      ]).expect(200)
    ).body.message;
    await age(photo._id, 40);
    // Files deleted, but the message was never marked
    fs.rmSync(`${uploadsDir}${photo.imageFiles[0]}`);

    const totals = await expireOldImages({ retentionDays: 30 });
    assert.equal(totals.messages, 1);
    assert.equal(totals.files, 0);
    assert.equal(totals.missingFiles, 1);
    assert.ok((await Message().findById(photo._id)).imagesExpiredAt);
  });
});
