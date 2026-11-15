import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import validateObjectId from "../middleware/validateObjectId.js";
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

// Checked after protectRoute, so an unauthenticated request still gets 401
const validId = validateObjectId("id");

router.get("/", protectRoute, listConversations);
router.post("/direct", protectRoute, createDirect);
router.post("/group", protectRoute, createGroup);
router.get("/:id", protectRoute, validId, getConversation);
router.get("/:id/messages", protectRoute, validId, getMessages);
router.post("/:id/messages", protectRoute, validId, postMessage);
router.post(
  "/:id/upload",
  protectRoute,
  validId,
  uploadImage,
  processImages,
  uploadConversationImages
);
router.put("/:id/members", protectRoute, validId, addMembers);
router.delete(
  "/:id/members/:userId",
  protectRoute,
  validateObjectId("id", "userId"),
  removeMember
);
router.put("/:id", protectRoute, validId, updateConversation);

export default router;
