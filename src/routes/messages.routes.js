import express from "express";
import {
  sendMessage,
  getMessages,
  deleteMessages,
  uploadImages,
} from "../controllers/message.controller.js";
import protectRoute from "../middleware/protectRoute.js";
import { uploadImage, processImages } from "../middleware/uploadImage.js";
import { sendUploadedImage } from "../utility/sendUploadedImage.js";

const router = express.Router();

// Route for retrieving uploaded message images
router.get("/uploads/images/:filename", protectRoute, sendUploadedImage);

router.post("/send/:id", protectRoute, sendMessage);
router.post(
  "/upload/:id",
  protectRoute,
  uploadImage,
  processImages,
  uploadImages
);
router.get("/get/:id", protectRoute, getMessages);
router.delete("/delete/:id", protectRoute, deleteMessages);

export default router;
