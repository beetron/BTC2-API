import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import {
  login,
  logout,
  signup,
  forgotUsername,
  forgotPassword,
  deleteAccount,
} from "../controllers/auth.controller.js";

const router = express.Router();
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.post("/forgotusername", forgotUsername);
router.post("/forgotpassword", forgotPassword);
router.delete("/deleteAccount/:userId", protectRoute, deleteAccount);

export default router;
