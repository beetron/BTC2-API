import express from "express";
import {
  login,
  logout,
  signup,
  forgotUsername,
  forgotPassword,
} from "../controllers/auth.controller.js";

const router = express.Router();
router.post("/signup", signup);
router.post("/login", login);
router.post("/logout", logout);
router.get("/forgotusername", forgotUsername);
router.get("/forgotpassword", forgotPassword);

export default router;
