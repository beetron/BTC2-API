import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import {
  uploadProfileImage,
  resizeImage,
} from "../middleware/uploadProfileImage.js";
import {
  getCurrentUser,
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
  unblockUser,
  getBlockedUsers,
  blockUser,
} from "../controllers/user.controller.js";
import { sendUploadedImage } from "../utility/sendUploadedImage.js";

const router = express.Router();

// Route for physically stored profile images
router.get("/uploads/images/:filename", protectRoute, sendUploadedImage);

router.get("/me", protectRoute, getCurrentUser);
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
router.put("/blockuser/:friendId", protectRoute, blockUser);
router.put("/unblockuser/:friendId", protectRoute, unblockUser);
router.get("/blockedusers", protectRoute, getBlockedUsers);

export default router;
