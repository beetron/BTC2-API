import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import { getReceiverSocketId, io } from "../socket/socket.js";
import { notificationService } from "../services/notificationService.js";
import User from "../models/user.model.js";

/////////////////////////////////////////////
// Send message to user
/////////////////////////////////////////////
export const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    // Find conversation based on senderid, receiverid
    let conversation = await Conversation.findOne({
      participants: { $all: [senderId, receiverId] },
    });

    // Create coversation if none exist
    if (!conversation) {
      conversation = await Conversation.create({
        participants: [senderId, receiverId],
      });
    }

    const newMessage = new Message({
      senderId,
      receiverId,
      message,
      readBy: [senderId],
    });

    if (newMessage) {
      conversation.messages.push(newMessage._id);
    }

    // Save database
    await Promise.all([conversation.save(), newMessage.save()]);

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
    const senderName = sender ? sender.nickname || "User" : "User";

    await notificationService(receiverId, {
      title: "BTC2: " + senderName,
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
  try {
    const { id: friendId } = req.params;
    const userId = req.user._id;

    // Find conversation based on userId, friendId
    const conversation = await Conversation.findOne({
      participants: { $all: [userId, friendId] },
    }).populate("messages");

    // Check if conversation exists
    if (!conversation) {
      return res.status(200).json([]);
    }

    const messages = conversation.messages;

    // Filter unread messages
    const unreadMessage = messages.filter(
      (message) => !message.readBy.includes(userId)
    );

    // Update readBy field
    if (unreadMessage.length > 0) {
      const bulkUpdate = unreadMessage.map((message) => ({
        updateOne: {
          filter: { _id: message._id },
          update: { $addToSet: { readBy: userId } },
        },
      }));

      // Save database
      await Message.bulkWrite(bulkUpdate);
    }

    res.status(200).json(messages);
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
