import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import {
  getLinkPreview,
  getLinkPreviewImage,
} from "../controllers/linkPreview.controller.js";

const router = express.Router();

router.get("/", protectRoute, getLinkPreview);
router.get("/image", protectRoute, getLinkPreviewImage);

export default router;
