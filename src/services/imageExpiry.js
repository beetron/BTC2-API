import fs from "fs";
import path from "path";
import Message from "../models/message.model.js";
import { uploadsDir } from "../utility/imageCleanup.js";

export const DEFAULT_RETENTION_DAYS = 30;

// How many messages to handle per query
const BATCH_SIZE = 200;

// Reads IMAGE_RETENTION_DAYS. Anything but a whole number of days >= 1 is
// refused: a typo such as "0" or "30d" must never expire every photo at once.
export const parseRetentionDays = (value) => {
  if (value === undefined || value === "") return DEFAULT_RETENTION_DAYS;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`IMAGE_RETENTION_DAYS must be a whole number of days >= 1, got "${value}"`);
  }
  return Number(value);
};

// Deletes the image files of every message older than retentionDays and
// marks those messages with imagesExpiredAt. Only files listed on messages
// are touched, never the uploads folder as a whole, so profile images
// (stored in the same folder) are safe.
//
// Files are deleted before the message is marked. If the job stops halfway,
// the next run finds the same messages again and finishes them; a file that
// is already gone counts as done. Marking a message also moves its
// updatedAt, so clients pick up the change through /messages/changes.
//
// dryRun: only counts what would be deleted.
export const expireOldImages = async ({
  retentionDays,
  dryRun = false,
  now = new Date(),
} = {}) => {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const filter = {
    createdAt: { $lt: cutoff },
    imagesExpiredAt: null,
    deletedAt: null,
    "imageFiles.0": { $exists: true },
  };

  const totals = { cutoff, dryRun, messages: 0, files: 0, missingFiles: 0, bytes: 0 };
  let lastId = null;

  for (;;) {
    const batch = await Message.find(lastId ? { ...filter, _id: { $gt: lastId } } : filter)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .select("imageFiles")
      .lean();
    if (batch.length === 0) break;
    lastId = batch[batch.length - 1]._id;

    for (const message of batch) {
      for (const imageFile of message.imageFiles) {
        // basename() keeps a malformed DB value from pointing outside the
        // uploads folder
        const filePath = path.join(uploadsDir, path.basename(imageFile));
        try {
          const { size } = await fs.promises.stat(filePath);
          if (!dryRun) await fs.promises.unlink(filePath);
          totals.files += 1;
          totals.bytes += size;
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
          totals.missingFiles += 1;
        }
      }

      if (!dryRun) {
        await Message.updateOne(
          { _id: message._id, imagesExpiredAt: null },
          { $set: { imagesExpiredAt: now } }
        );
      }
      totals.messages += 1;
    }
  }

  return totals;
};
