import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import { uploadImage, processImages } from "../middleware/uploadImage.js";
import {
  listConversations,
  getConversation,
  createDirect,
  createGroup,
  getMessages,
  postMessage,
  uploadConversationImages,
  addMembers,
  removeMember,
  updateConversation,
} from "../controllers/conversation.controller.js";

const router = express.Router();

// Runs before protectRoute on every route below
router.use(apiLimiter);

router.get("/", protectRoute, listConversations);
router.post("/direct", protectRoute, createDirect);
router.post("/group", protectRoute, createGroup);
router.get("/:id", protectRoute, getConversation);
router.get("/:id/messages", protectRoute, getMessages);
router.post("/:id/messages", protectRoute, postMessage);
router.post(
  "/:id/upload",
  protectRoute,
  uploadImage,
  processImages,
  uploadConversationImages
);
router.put("/:id/members", protectRoute, addMembers);
router.delete("/:id/members/:userId", protectRoute, removeMember);
router.put("/:id", protectRoute, updateConversation);

export default router;
