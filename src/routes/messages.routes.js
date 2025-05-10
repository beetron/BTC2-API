import express from "express";
import {
  sendMessage,
  getMessages,
  deleteMessages,
} from "../controllers/message.controller.js";
import protectRoute from "../middleware/protectRoute.js";

const router = express.Router();

router.post("/send/:id", protectRoute, sendMessage);
router.get("/get/:id", protectRoute, getMessages);
router.delete("/delete/:id", protectRoute, deleteMessages);

export default router;
