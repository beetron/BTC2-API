import express from "express";
import {
  sendMessage,
  getMessages,
  deleteMessages,
  uploadImages,
} from "../controllers/message.controller.js";
import protectRoute from "../middleware/protectRoute.js";
import { uploadImage, processImages } from "../middleware/uploadImage.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Get current directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Route for retrieving uploaded message images
router.get("/uploads/images/:filename", protectRoute, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(__dirname, "../uploads/images", filename);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  // Send the file
  res.sendFile(filePath);
});

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
