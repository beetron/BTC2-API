import User from "../models/user.model.js";
import UserConversation from "../models/userConversation.model.js";
import fs from "fs-extra";
import path from "path";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import { sendEmail } from "../utility/sendEmail.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";
import Message from "../models/message.model.js";

// Used for getting the curent directory path regardless of environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

    // If the receiver has blocked the requesting user, silently return success to conceal blocking
    if (
      requestReceiver.blockedUsers &&
      requestReceiver.blockedUsers
        .map((id) => id.toString())
        .includes(user._id.toString())
    ) {
      console.log(
        `Blocked friend request: User ${user._id} attempted to add ${requestReceiver._id} but is blocked.`
      );
      return res.status(200).json({ message: "Friend request sent" });
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

    res.status(200).json({ message: "Friend request sent" });
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
    // Get user ID from request
    const userId = req.user._id;

    // Retrieve currentPassword and new password from request body
    const { currentPassword, password } = req.body;

    // Check if currentPassword is provided
    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required" });
    }

    // Check if new password is provided
    if (!password) {
      return res.status(400).json({ error: "New password is required" });
    }

    // Fetch user with password for verification
    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Verify currentPassword matches stored password
    const isPasswordValid = await bcrypt.compare(
      currentPassword,
      user.password
    );
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }

    // Check if new password is the same as the current password
    const isSamePassword = await bcrypt.compare(password, user.password);

    if (isSamePassword) {
      return res.status(400).json({
        error: "New password cannot be the same as the current password",
      });
    }

    // Hash new password
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

    return res.status(200).json({ message: "Unique ID updated" });
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
    const user = req.user;
    const file = req.file;

    if (file) {
      // Check and remove existing profile image if it exists
      if (user.profileImage) {
        const existingImagePath = path.join(
          __dirname,
          "../uploads/images",
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
// Block user
/////////////////////////////////////////////
export const blockUser = async (req, res) => {
  const userId = req.user._id;

  // UserId to block
  const { friendId } = req.params;

  try {
    // Error if missing parameters from request
    if (!friendId || !userId)
      return res.status(400).json({ error: "Missing parameters" });

    // Find both users in database
    const user = await User.findById(userId);
    const friendToBlock = await User.findById(friendId);

    // Error if user or friend not in database
    if (!user || !friendToBlock) {
      console.log(
        `Block requested but user ${userId} or target ${friendId} not found`
      );
      return res.status(404).json({ error: "User or Friend not found" });
    }

    // Prevent blocking yourself
    if (userId.toString() === friendId.toString()) {
      console.log(`User ${userId} attempted to block themselves`);
      return res.status(400).json({ error: "Cannot block yourself" });
    }

    // Check if already blocked & block user (use string comparisons to avoid ObjectId mismatch)
    const alreadyBlocked = user.blockedUsers
      .map((id) => id.toString())
      .includes(friendToBlock._id.toString());

    if (alreadyBlocked) {
      console.log(
        `Block requested but user ${friendId} is already blocked for ${userId}`
      );
      return res.status(400).json({ error: "User already blocked" });
    } else {
      // Atomic update to prevent duplicates and race conditions
      await User.findByIdAndUpdate(userId, {
        $addToSet: { blockedUsers: friendToBlock._id },
      });

      // Remove each other from friend lists (if friends)
      await User.findByIdAndUpdate(userId, {
        $pull: { friendList: friendToBlock._id },
      });
      await User.findByIdAndUpdate(friendToBlock._id, {
        $pull: { friendList: userId },
      });

      // Clear any pending friend requests between the users
      await User.findByIdAndUpdate(userId, {
        $pull: { friendRequests: friendToBlock._id },
      });
      await User.findByIdAndUpdate(friendToBlock._id, {
        $pull: { friendRequests: userId },
      });

      // Delete any user conversations and messages between the two users
      const conversationA = await UserConversation.findOne({
        senderId: userId,
        receiverId: friendToBlock._id,
      });
      const conversationB = await UserConversation.findOne({
        senderId: friendToBlock._id,
        receiverId: userId,
      });

      // Collect all message ids referenced in both conversations
      const allMessageIds = [
        ...(conversationA?.messages || []),
        ...(conversationB?.messages || []),
      ];

      if (allMessageIds.length > 0) {
        // Find messages and gather image files
        const messagesToDelete = await Message.find({
          _id: { $in: allMessageIds },
        });
        const allImageFiles = messagesToDelete.flatMap(
          (m) => m.imageFiles || []
        );

        // Delete Message documents that belong to this pair (safe because conversations are removed)
        await Message.deleteMany({ _id: { $in: allMessageIds } });

        // Cleanup unreferenced image files
        await handleImageFileCleanup(allImageFiles);
      }

      // Remove conversations for both sides
      if (conversationA) await conversationA.deleteOne();
      if (conversationB) await conversationB.deleteOne();

      console.log(
        `User ${userId} blocked ${friendId} - removed friendship, cleared friend requests and deleted conversations/messages`
      );

      return res.status(200).json({ message: "User blocked successfully" });
    }
  } catch (error) {
    console.log("Error in blockUser controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Report user
/////////////////////////////////////////////
export const reportUser = async (req, res) => {
  const reporterUsername = req.user.username;

  // Retrieve friendId and reason from request body
  const { reason, friendId } = req.body;

  try {
    // Validate required fields
    if (!friendId || !reason) {
      return res
        .status(400)
        .json({ error: "Friend ID and reason are required" });
    }

    // Find the reported user by ObjectId
    const reportedUser = await User.findById(friendId);
    if (!reportedUser) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check if user is reporting themselves
    if (req.user._id.equals(reportedUser._id)) {
      return res.status(400).json({ error: "You cannot report yourself" });
    }

    // Get current date and time
    const currentDateTime = new Date().toLocaleString();

    // Format email body with line breaks
    const emailBody = `${currentDateTime}\n${reporterUsername} has reported ${reportedUser.username} for:\n${reason}`;

    // Send email
    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `Reporting user ${reportedUser.username}`,
      text: emailBody,
    });
    console.log("Report email sent: ", emailBody);
    return res.status(200).json({ message: "User reported successfully" });
  } catch (error) {
    console.log("Error in reportUser controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Unblock user
/////////////////////////////////////////////
export const unblockUser = async (req, res) => {
  const userId = req.user._id;
  const { friendId } = req.params;

  try {
    if (!friendId || !userId)
      return res.status(400).json({ error: "Missing parameters" });

    const user = await User.findById(userId);
    const friendToUnblock = await User.findById(friendId);

    if (!user || !friendToUnblock) {
      return res.status(404).json({ error: "User or Friend not found" });
    }

    // Ensure that the friend is actually blocked
    const isBlocked = user.blockedUsers
      .map((id) => id.toString())
      .includes(friendToUnblock._id.toString());

    if (!isBlocked) {
      console.log(
        `Unblock requested but user ${friendId} is not blocked for ${userId}`
      );
      return res.status(400).json({ error: "User is not blocked" });
    }

    // Atomically remove from blockedUsers
    await User.findByIdAndUpdate(userId, {
      $pull: { blockedUsers: friendToUnblock._id },
    });

    console.log(`User ${userId} unblocked ${friendId}`);
    return res.status(200).json({ message: "User unblocked successfully" });
  } catch (error) {
    console.log("Error in unblockUser controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Get blocked users
/////////////////////////////////////////////
export const getBlockedUsers = async (req, res) => {
  try {
    const user = req.user;

    // `protectRoute` ensures user exists and is set on req.user; return empty if not
    if (!user) {
      console.log(`Blocked users requested but req.user missing`);
      return res.status(200).json([]);
    }

    // Get blocked user IDs from user's document using optional chaining
    const blockedIds = Array.isArray(user?.blockedUsers)
      ? user.blockedUsers
      : [];

    // Return empty array if there are none
    if (blockedIds.length === 0) {
      console.log(`User ${req.user._id} requested blocked users: none`);
      return res.status(200).json([]);
    }

    // Fetch basic info for each blocked user
    const blockedUsers = await User.find({ _id: { $in: blockedIds } }).select(
      "_id nickname profileImage"
    );

    console.log(
      `User ${req.user._id} requested blocked users: ${blockedUsers.length}`
    );
    return res.status(200).json(blockedUsers);
  } catch (error) {
    console.log("Error in getBlockedUsers controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Update email
/////////////////////////////////////////////
export const updateEmail = async (req, res) => {
  // Debugging log
  console.log("Update email requested", req.body.email);

  // Get user ID from request
  const userId = req.user._id;

  // Retrieve email and password from request body
  const { email, password } = req.body;

  try {
    // Check if password is provided
    if (!password) {
      return res.status(400).json({ error: "Password is required" });
    }

    // Fetch user with password for verification
    const user = await User.findById(userId);

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // Verify password matches current password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: "Password is incorrect" });
    }

    // Check if email is already taken
    const emailExists = await User.findOne({
      email,
      _id: { $ne: userId },
    });
    if (emailExists) {
      return res.status(400).json({ error: "Email already taken" });
    }

    user.email = email;
    await user.save();

    return res.status(200).json({ message: "Email updated" });
  } catch (error) {
    console.log("Error in updateEmail controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
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
      // Update existing token to update timestamp
      user.fcmTokens[tokenIndex] = {
        token,
        device: device || user.fcmTokens[tokenIndex].device,
      };
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
