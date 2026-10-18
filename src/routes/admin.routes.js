import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import requireAdmin from "../middleware/requireAdmin.js";
import { adminLimiter } from "../middleware/rateLimit.js";
import {
  listUsers,
  getUser,
  updateUser,
  deleteUserMessages,
  deleteUser,
} from "../controllers/admin.controller.js";

const router = express.Router();

// Rate limit first so unauthenticated probing is throttled too
router.use(adminLimiter, protectRoute, requireAdmin);

router.get("/users", listUsers);
router.get("/users/:id", getUser);
router.patch("/users/:id", updateUser);
router.delete("/users/:id/messages", deleteUserMessages);
router.delete("/users/:id", deleteUser);

export default router;
