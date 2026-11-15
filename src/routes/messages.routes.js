import express from "express";
import { deleteMessages } from "../controllers/message.controller.js";
import protectRoute from "../middleware/protectRoute.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import validateObjectId from "../middleware/validateObjectId.js";
import { sendUploadedImage } from "../utility/sendUploadedImage.js";

// What is left of the original /messages API. Sending, uploading and
// reading history moved to /conversations; the old /send/:id, /upload/:id
// and /get/:id routes were removed in 2.0.0.

const router = express.Router();

// Runs before protectRoute on every route below
router.use(apiLimiter);

// Uploaded message images, for both direct and group conversations
router.get("/uploads/images/:filename", protectRoute, sendUploadedImage);

// Clear the caller's own history up to a message
router.delete("/delete/:id", protectRoute, validateObjectId("id"), deleteMessages);

export default router;
