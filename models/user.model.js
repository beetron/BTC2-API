import mongoose from "mongoose";
import { API_URL } from "../constants/api.js";

// Separate schema for FCM tokens to keep track of timestamps individually
const fcmTokenSchema = new mongoose.Schema(
  {
    token: String,
    device: String,
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      minlength: 6,
      unique: true,
    },
    uniqueId: {
      type: String,
      minLength: 6,
      maxLength: 18,
      unique: true,
      default: function () {
        return this.username;
      },
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
    },
    nickname: {
      type: String,
      default: function () {
        return this.username;
      },
    },
    profileImage: {
      type: String,
      default: "",
      get: function (photo) {
        return photo ? `${API_URL}/users/profileImage/${photo}` : null;
      },
    },
    friendRequests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    friendList: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: [],
      },
    ],
    fcmTokens: [fcmTokenSchema],
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
