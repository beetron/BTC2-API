import express from "express";
import protectRoute from "../middleware/protectRoute.js";
import {
  loginIpLimiter,
  loginAccountLimiter,
  signupLimiter,
  recoveryLimiter,
  refreshLimiter,
} from "../middleware/rateLimit.js";
import {
  login,
  logout,
  signup,
  refreshTokens,
  forgotUsername,
  forgotPassword,
  deleteAccount,
} from "../controllers/auth.controller.js";

const router = express.Router();
router.post("/signup", signupLimiter, signup);
router.post("/login", loginIpLimiter, loginAccountLimiter, login);
router.post("/logout", logout);
router.post("/refresh", refreshLimiter, refreshTokens);
router.post("/forgotusername", recoveryLimiter, forgotUsername);
router.post("/forgotpassword", recoveryLimiter, forgotPassword);
router.delete("/deleteAccount/:userId", protectRoute, deleteAccount);

export default router;
