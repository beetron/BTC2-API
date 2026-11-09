import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import { apiLimiter } from "../middleware/rateLimit.js";
import {
  getLinkPreview,
  getLinkPreviewImage,
} from "../controllers/linkPreview.controller.js";

const router = express.Router();

// Runs before protectRoute on every route below
router.use(apiLimiter);

router.get("/", protectRoute, getLinkPreview);
router.get("/image", protectRoute, getLinkPreviewImage);

export default router;
