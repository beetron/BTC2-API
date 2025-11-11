import mongoose from "mongoose";

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
      maxLength: 20,
      unique: true,
    },
    uniqueId: {
      type: String,
      minLength: 6,
      maxLength: 20,
      unique: true,
      default: function () {
        return this.username;
      },
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      minlength: 6,
      maxLength: 72,
    },
    nickname: {
      type: String,
      minLength: 1,
      maxLength: 20,
      default: function () {
        return this.username;
      },
    },
    profileImage: {
      type: String,
      default: "",
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
