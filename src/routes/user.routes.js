import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import {
  uploadProfileImage,
  resizeImage,
} from "../middleware/uploadProfileImage.js";
import {
  getFriendList,
  getFriendRequests,
  addFriendRequest,
  acceptFriendRequest,
  rejectFriendRequest,
  removeFriend,
  updateNickname,
  updateUniqueId,
  updateProfileImage,
  updateEmail,
  registerFcmToken,
  deleteFcmToken,
  changePassword,
  reportUser,
} from "../controllers/user.controller.js";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Get current directory path
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Route for physically stored profile images
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

router.get("/friendlist", protectRoute, getFriendList);
router.get("/friendrequests", protectRoute, getFriendRequests);
router.put("/addfriend/:uniqueId", protectRoute, addFriendRequest);
router.put("/acceptfriend/:uniqueId", protectRoute, acceptFriendRequest);
router.put("/rejectfriend/:uniqueId", protectRoute, rejectFriendRequest);
router.put("/removefriend/:uniqueId", protectRoute, removeFriend);
router.put("/changepassword", protectRoute, changePassword);
router.put("/updatenickname/:nickname", protectRoute, updateNickname);
router.put("/updateuniqueid/:uniqueId", protectRoute, updateUniqueId);
router.put(
  "/updateprofileimage/",
  protectRoute,
  uploadProfileImage,
  resizeImage,
  updateProfileImage
);
router.put("/updateemail", protectRoute, updateEmail);
router.put("/fcm/register", protectRoute, registerFcmToken);
router.delete("/fcm/token", protectRoute, deleteFcmToken);
router.post("/reportuser", protectRoute, reportUser);

export default router;
