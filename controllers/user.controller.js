import User from "../models/user.model.js";
import Conversation from "../models/conversation.model.js";

// Get user friend list
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
    }).select("nickname profilePhoto");

    // Check for unread message status with each friend
    const friendListWithUnreadStatus = await Promise.all(
      friendListData.map(async (friend) => {
        const conversation = await Conversation.findOne({
          participants: { $all: [user._id, friend._id] },
        }).populate("messages");

        let unreadMessages = false;

        // Get last updated timestamp for each conversation
        const updatedAt = conversation ? conversation.updatedAt : null;

        if (conversation) {
          unreadMessages = conversation.messages.some(
            (message) => !message.readBy.includes(user._id)
          );
        }

        return {
          ...friend.toObject(),
          unreadMessages,
          updatedAt,
        };
      })
    );
    res.status(200).json(friendListWithUnreadStatus);
  } catch (error) {
    console.log("Error in getFriendList controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Block user
// export const blockUser = async (req, res) => {};

// Get pending user friend requests
export const getFriendRequests = async (req, res) => {
  try {
    const user = req.user;

    // Get friend requests
    const friendRequests = user.friendRequests;

    // Get user data based off of objectId friendRequests
    const friendRequestsIds = await User.find({
      _id: { $in: friendRequests },
    }).select("_id uniqueId nickname profilePhoto");

    res.status(200).json(friendRequestsIds);
  } catch (error) {
    console.log("Error in getFriendRequests controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Add friend request
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

// Accept friend request
export const acceptFriendRequest = async (req, res) => {
  // Get user data
  const user = req.user;

  // Retrieve uniqueId from request params
  const { uniqueId } = req.params;

  try {
    // Find user sending the friend request
    const requestSender = await User.findOne({ uniqueId }).select(
      "_id friendList"
    );

    // Check if requester exists
    if (!requestSender) {
      return res.status(400).json({ error: "User not found" });
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
    user.save();

    // Update and save requestSender's friend list
    requestSender.friendList.push(user._id);
    requestSender.save();

    return res.status(200).json({ message: "Friend request accepted" });
  } catch (error) {
    console.log("Error in acceptFriendRequest controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Reject friend request
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
      return res.status(400).json({ error: "User not found" });
    }

    // Remove requestSender from user's friendRequests
    user.friendRequests.pull(requestSender._id);

    // Save user database
    user.save();

    return res.status(200).json({ message: "Denied friend request" });
  } catch (error) {
    console.log("Error in denyFriendRequest controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Remove friend
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
      return res.status(400).json({ error: "User not found" });
    }

    // Check if friend is not in friend list
    if (!user.friendList.includes(friendToRemove._id)) {
      return res.status(400).json({ error: "User not in friend list" });
    }

    // Update user's friend list
    user.friendList.pull(friendToRemove._id);

    // Update friendToRemove's friend list
    friendToRemove.friendList.pull(user._id);

    // Save user database
    user.save();

    // Save friendToRemove database
    friendToRemove.save();

    return res.status(200).json({ message: "Friend removed" });
  } catch (error) {
    console.log("Error in removeFriend controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

// Update nickname
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

// Update uniqueId
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
