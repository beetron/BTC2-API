import express from "express";
import {
  sendMessage,
  getMessages,
  deleteMessages,
  uploadImages,
} from "../controllers/message.controller.js";
import protectRoute from "../middleware/protectRoute.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import validateObjectId from "../middleware/validateObjectId.js";
import deprecated from "../middleware/deprecated.js";
import { uploadImage, processImages } from "../middleware/uploadImage.js";
import { sendUploadedImage } from "../utility/sendUploadedImage.js";

const router = express.Router();

// Runs before protectRoute on every route below
router.use(apiLimiter);

// Route for retrieving uploaded message images (in use by both clients)
router.get("/uploads/images/:filename", protectRoute, sendUploadedImage);

// Deprecated: replaced by /conversations/:id/messages and
// /conversations/:id/upload. No current client calls these.
router.post("/send/:id", protectRoute, deprecated, validateObjectId("id"), sendMessage);
router.post(
  "/upload/:id",
  protectRoute,
  deprecated,
  validateObjectId("id"),
  uploadImage,
  processImages,
  uploadImages
);
router.get("/get/:id", protectRoute, deprecated, validateObjectId("id"), getMessages);

// Clear the caller's history up to a message (in use by both clients)
router.delete("/delete/:id", protectRoute, validateObjectId("id"), deleteMessages);

export default router;
