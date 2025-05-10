import User from "../models/user.model.js";
import UserConversation from "../models/userConversation.model.js";
import fs from "fs-extra";
import path from "path";
import bcrypt from "bcryptjs";

/////////////////////////////////////////////
// Get user friend list
/////////////////////////////////////////////
export const getFriendList = async (req, res) => {
  try {
    const user = req.user;
    // Get friend list
    const friendList = user.friendList;

    // Return empty array if friendList is empty
    if (!friendList) {
      return res.status(200).json([]);
    }

    // Get user data based off of objectIdFriendList
    const friendListData = await User.find({
      _id: { $in: friendList },
    }).select("nickname profileImage uniqueId");

    // Check for unread message status with each friend
    const friendListWithUnreadStatus = await Promise.all(
      friendListData.map(async (friend) => {
        // Find conversation where user is the sender and friend is receiver
        const conversation = await UserConversation.findOne({
          senderId: user._id,
          receiverId: friend._id,
        });

        return {
          ...friend.toObject(),
          unreadCount: conversation ? conversation.unreadCount : 0,
          updatedAt: conversation ? conversation.updatedAt : null,
        };
      })
    );

    // Sort by most recent conversation and unread messages first
    const sortedFriendList = friendListWithUnreadStatus.sort((a, b) => {
      // First sort by unread count (higher first)
      if (b.unreadCount !== a.unreadCount) {
        return b.unreadCount - a.unreadCount;
      }
      // Then sort by updatedAt (most recent first)
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return new Date(b.updatedAt) - new Date(a.updatedAt);
    });

    res.status(200).json(sortedFriendList);
  } catch (error) {
    console.log("Error in getFriendList controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Block user
// export const blockUser = async (req, res) => {};

/////////////////////////////////////////////
// Get pending user friend requests
/////////////////////////////////////////////
export const getFriendRequests = async (req, res) => {
  try {
    const user = req.user;

    // Get friend requests
    const friendRequests = user.friendRequests;

    // Get user data based off of objectId friendRequests
    const friendRequestsIds = await User.find({
      _id: { $in: friendRequests },
    }).select("_id uniqueId nickname profileImage");

    res.status(200).json(friendRequestsIds);
  } catch (error) {
    console.log("Error in getFriendRequests controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Add friend request
/////////////////////////////////////////////
export const addFriendRequest = async (req, res) => {
  try {
    const user = req.user;

    // Retrieve uniqueId from request params
    const { uniqueId } = req.params;

    // Find user being friend requested
    const requestReceiver = await User.findOne({ uniqueId }).select(
      "-password"
    );

    // Check if the uniqueId to add exists
    if (!requestReceiver) {
      console.log({ error: "User not found" });
      return res.status(400).json({ error: "User not found" });
    }

    // Check if user is not adding itself
    if (requestReceiver._id.equals(user._id)) {
      console.log({ error: "Cannot add yourself" });
      return res.status(400).json({ error: "Cannot add yourself" });
    }

    // Check if user is already pending add request
    if (requestReceiver.friendRequests.includes(user._id)) {
      console.log({ error: "Friend request already sent" });
      return res.status(400).json({ error: "Friend request already sent" });
    }

    // Check if user is already a friend
    if (requestReceiver.friendList.includes(user._id)) {
      console.log({ error: "Already friends" });
      return res.status(400).json({ error: "Already friends" });
    }

    requestReceiver.friendRequests.push(user._id);
    await requestReceiver.save();

    res.status(201).json({ message: "Friend request sent" });
  } catch (error) {
    console.log("Error in addFriendRequeset controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Accept friend request
/////////////////////////////////////////////
export const acceptFriendRequest = async (req, res) => {
  // Get user data
  const user = req.user;

  // Retrieve uniqueId from request params
  const { uniqueId } = req.params;

  try {
    // Find user sending the friend request
    const requestSender = await User.findOne({ uniqueId }).select(
      "_id friendList friendRequests"
    );

    console.log("Request sender: ", requestSender);

    // Check if requester exists
    if (!requestSender) {
      return res
        .status(400)
        .json({ error: "User not found, or no longer a user" });
    }

    // Check if requester is already a friend
    if (user.friendList.includes(requestSender._id)) {
      return res.status(400).json({ error: "Already friends" });
    }

    // Update user's friend list
    user.friendList.push(requestSender._id);

    // Remove requestSender from user's friendRequests
    user.friendRequests.pull(requestSender._id);

    // Save user database
    await user.save();

    // Remove user from pending friend requests of requestSender if exists
    if (requestSender.friendRequests.includes(user._id)) {
      requestSender.friendRequests.pull(user._id);
    }

    // Update and save requestSender's friend list
    requestSender.friendList.push(user._id);
    await requestSender.save();

    return res.status(200).json({ message: "Friend request accepted" });
  } catch (error) {
    console.log("Error in acceptFriendRequest controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Reject friend request
/////////////////////////////////////////////
export const rejectFriendRequest = async (req, res) => {
  // Get user data
  const user = req.user;

  // Retrieve uniqueId from request params
  const { uniqueId } = req.params;

  try {
    // Find user sending the friend request
    const requestSender = await User.findOne({ uniqueId }).select(
      "_id friendRequests"
    );

    // Check if requester exists
    if (!requestSender) {
      return res
        .status(400)
        .json({ error: "User not found, or no longer a user" });
    }

    // Remove requestSender from user's friendRequests
    user.friendRequests.pull(requestSender._id);

    // Save user database
    await user.save();

    return res.status(200).json({ message: "Denied friend request" });
  } catch (error) {
    console.log("Error in denyFriendRequest controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Remove friend
/////////////////////////////////////////////
export const removeFriend = async (req, res) => {
  // Get user data
  const user = req.user;

  // Retrieve uniqueId from request params
  const { uniqueId } = req.params;

  try {
    // Find user to remove
    const friendToRemove = await User.findOne({ uniqueId }).select(
      "_id friendList"
    );

    // Check if friend exists
    if (!friendToRemove) {
      return res
        .status(400)
        .json({ error: "User not found, or no longer a user" });
    }

    // Check if friend is not in user's friend list
    if (!user.friendList.includes(friendToRemove._id)) {
      return res.status(400).json({ error: "User not in friend list" });
    }

    // Update user's friend list
    user.friendList.pull(friendToRemove._id);

    // Update friendToRemove's friend list
    friendToRemove.friendList.pull(user._id);

    // Save user database
    await user.save();

    // Save friendToRemove database
    await friendToRemove.save();

    return res.status(200).json({ message: "Friend removed" });
  } catch (error) {
    console.log("Error in removeFriend controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Change password
/////////////////////////////////////////////
export const changePassword = async (req, res) => {
  try {
    // Get user data
    const userId = req.user;

    // Retrieve password from request body
    const { password } = req.body;

    if (!userId) {
      return res
        .status(400)
        .json({ error: "User not found, or session expired" });
    }
    const user = await User.findById(userId);

    // Check if password is the same as the current password
    const isSamePassword = await bcrypt.compare(password, user.password);

    if (isSamePassword) {
      return res.status(400).json({
        error: "New password cannot be the same as the current password",
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Update user's password in database
    user.password = hashedPassword;
    await user.save();

    return res.status(200).json({ message: "Password updated" });
  } catch (error) {
    console.log("Error in changePassword controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Update nickname
/////////////////////////////////////////////
export const updateNickname = async (req, res) => {
  // Get user data
  const user = req.user;

  // Retrieve nickname from request params
  const { nickname } = req.params;

  try {
    user.nickname = nickname;
    await user.save();

    return res.status(200).json({ message: "Nickname updated" });
  } catch (error) {
    console.log("Error in updateNickname controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Update uniqueId
/////////////////////////////////////////////
export const updateUniqueId = async (req, res) => {
  // Get user data
  const user = req.user;

  // Retrieve uniqueId from request params
  const { uniqueId } = req.params;

  try {
    // Check if uniqueId is already taken
    const uniqueIdExists = await User.findOne({
      uniqueId,
      _id: { $ne: user._id },
    });
    if (uniqueIdExists) {
      return res.status(400).json({ error: "UniqueId already taken" });
    }

    user.uniqueId = uniqueId;
    await user.save();

    return res.status(200).json({ message: "UniqueId updated" });
  } catch (error) {
    console.log("Error in updateUniqueId controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Update profile image
/////////////////////////////////////////////
export const updateProfileImage = async (req, res) => {
  try {
    // Get user data
    const user = req.user;
    // New profile image data from request body
    const file = req.file;

    if (file) {
      // Check and remove existing profile image if it exists
      if (user.profileImage) {
        const existingImagePath = path.join(
          "users/profileImage",
          user.profileImage
        );
        try {
          await fs.remove(existingImagePath);
        } catch (error) {
          console.log("Error removing existing profile image: ", error);
        }
      }

      // Update user's profile image link in database
      user.profileImage = file.filename;
      await user.save();

      return res.status(200).json({
        message: "Profile image updated",
        profileImage: file.filename,
      });
    }
  } catch (error) {
    console.log("Error in updateProfileImage controller: ", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Register or update FCM token
/////////////////////////////////////////////
export const registerFcmToken = async (req, res) => {
  const { token, device } = req.body;

  console.log("user.controller, registerFcmToken called: ", device);

  try {
    if (!token) {
      return res.status(400).json({ error: "FCM token is missing" });
    }

    const user = await User.findById(req.user._id);

    // Check if token already exists
    const tokenIndex = user.fcmTokens.findIndex((t) => t.token === token);

    if (tokenIndex !== -1) {
      // Update existing token with new device info
      user.fcmTokens[tokenIndex].device =
        device || user.fcmTokens[tokenIndex].device;

      // Force modification to trigger updatedAt timestamp change
      // user.markModified("fcmTokens");
      user.markModified(`fcmTokens.${tokenIndex}`);
    } else {
      // Add new token
      user.fcmTokens.push({ token, device: device || "unknown" });
    }

    await user.save();

    return res.status(200).json({
      message: tokenIndex !== -1 ? "FCM token updated" : "FCM token registered",
    });
  } catch (error) {
    console.log("Error in registering FCM token: ", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Delete FCM token
/////////////////////////////////////////////
export const deleteFcmToken = async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is missing" });
    }

    const user = await User.findById(req.user._id);

    user.fcmTokens = user.fcmTokens.filter((t) => t.token !== token);
    await user.save();
    return res.status(200).json({ message: "FCM token deleted" });
  } catch (error) {
    console.log("Error deleteing FCM token: ", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
};
