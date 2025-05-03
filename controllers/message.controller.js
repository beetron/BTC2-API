import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import UserConversation from "../models/userConversation.model.js";
import { getReceiverSocketId, io } from "../socket/socket.js";
import { notificationService } from "../services/notificationService.js";

/////////////////////////////////////////////
// Send message to user
/////////////////////////////////////////////
export const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    // Create new message
    const newMessage = await Message.create({
      senderId,
      receiverId,
      message,
    });

    // Update or create new UserConversation for sender
    let senderConversation = await UserConversation.findOne({
      senderId,
      receiverId,
    });

    if (!senderConversation) {
      senderConversation = await UserConversation.create({
        senderId,
        receiverId,
        messages: [newMessage._id],
        lastReadMessageId: newMessage._id, // Marks read for sender
      });
    } else {
      senderConversation.messages.push(newMessage._id);
      senderConversation.lastReadMessageId = newMessage._id;
      await senderConversation.save();
    }

    // Update or create UserConversation for receiver
    let receiverConversation = await UserConversation.findOne({
      senderId: receiverId,
      receiverId: senderId,
    });

    if (!receiverConversation) {
      receiverConversation = await UserConversation.create({
        senderId: receiverId,
        receiverId: senderId,
        messages: [newMessage._id],
        unreadCount: 1, // Unread for receiver
      });
    } else {
      receiverConversation.messages.push(newMessage._id);
      receiverConversation.unreadCount += 1;
      await receiverConversation.save();
    }

    // Always send socket notification if socket exists
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      console.log("Receiver socket connected, sending real-time signal");
      io.to(receiverSocketId).emit("newMessageSignal");
    } else {
      console.log("Receiver socket not connected");
    }

    // Always send FCM notification regardless of socket connection
    console.log("Sending FCM notification");
    const sender = await User.findById(senderId);
    // const senderName = sender ? sender.nickname || "User" : "User";

    await notificationService(receiverId, {
      // title: "BTC2: " + senderName,
      title: "BTC2 updates",
      body: message.length > 20 ? message.substring(0, 17) + "..." : message,
      payload: {
        messageId: newMessage._id.toString(),
        senderId: senderId.toString(),
        type: "chat_message",
      },
    });

    // Status 200 will be returnd regardless of receiver having FCM token or not
    return res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Get messages between user and friend
/////////////////////////////////////////////
export const getMessages = async (req, res) => {
  console.log("getMessages controller called: ", req.params);
  try {
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    let conversation = await UserConversation.findOne({
      senderId,
      receiverId,
    });

    if (!conversation) {
      return res.status(200).json([]);
    }

    // UserConversation.getMessages() will update lastReadMessageId and unreadCount
    const messages = await conversation.getMessages();
    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Delete user's messages between a user and friend
/////////////////////////////////////////////
export const deleteMessages = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const userId = req.user._id;

    // Gather message details
    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ error: "Message not found" });
    }

    // Find and update user's conversation
    const conversation = await UserConversation.findOne({
      senderId: userId,
      receiverId: userId.equals(message.senderId)
        ? message.receiverId
        : message.senderId,
    });

    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    await conversation.deleteMessagesUpTo(messageId);
    res.status(200).json({ message: "Messages deleted successfully" });
  } catch (error) {
    console.log("Error in deleteMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
