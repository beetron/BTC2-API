// Daily image expiry, run by a Kubernetes CronJob with the API's own image:
//
//   node scripts/expireImages.js
//
// Environment:
//   MONGO_DB_URI          same database as the API
//   IMAGE_RETENTION_DAYS  photos older than this are deleted (default 30)
//   DRY_RUN=1             only report what would be deleted
//
// Must run with /app as the working directory and the images volume mounted
// at /app/src/uploads/images, like the API pod.
import "dotenv/config";
import mongoose from "mongoose";
import { expireOldImages, parseRetentionDays } from "../src/services/imageExpiry.js";

const dryRun = ["1", "true"].includes((process.env.DRY_RUN || "").toLowerCase());

try {
  const retentionDays = parseRetentionDays(process.env.IMAGE_RETENTION_DAYS);
  await mongoose.connect(process.env.MONGO_DB_URI);

  const totals = await expireOldImages({ retentionDays, dryRun });
  const mb = (totals.bytes / 1024 / 1024).toFixed(1);
  console.log(
    `${dryRun ? "[dry run] Would expire" : "Expired"} images of ${totals.messages} message(s) ` +
      `sent before ${totals.cutoff.toISOString()} (${retentionDays} days): ` +
      `${totals.files} file(s), ${mb} MB` +
      (totals.missingFiles ? `, ${totals.missingFiles} already missing` : "")
  );
} catch (error) {
  console.error("Image expiry failed:", error);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
