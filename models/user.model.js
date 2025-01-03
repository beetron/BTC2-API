import mongoose from "mongoose";

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
    profilePhoto: {
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
  },
  { timestamps: true }
);

const User = mongoose.model("User", userSchema);

export default User;
