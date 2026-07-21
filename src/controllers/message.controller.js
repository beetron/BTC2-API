import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import {
  findOrCreateDirectConversation,
  postMessage as postConversationMessage,
  getDirectConversationMessagesLegacy,
  clearHistoryUpTo,
} from "../services/conversationService.js";
import { getReceiverSocketIds, io } from "../socket/socket.js";
import { notificationService } from "../services/notificationService.js";
import fs from 'fs';
import path from 'path';

/////////////////////////////////////////////
// Send message to user
/////////////////////////////////////////////
export const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    const conversation = await findOrCreateDirectConversation(senderId, receiverId);
    const { message: newMessage } = await postConversationMessage({
      conversationId: conversation._id,
      senderId,
      message,
    });

    // Send socket notification to all connected devices of receiver
    const receiverSocketIds = getReceiverSocketIds(receiverId);
    if (receiverSocketIds.length > 0) {
      console.log(
        `Receiver has ${receiverSocketIds.length} device(s) connected, sending real-time signal`
      );
      receiverSocketIds.forEach((socketId) => {
        io.to(socketId).emit("newMessageSignal");
      });
    } else {
      console.log("Receiver socket not connected");
      // Send FCM notification only if receiver is not connected via socket
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
    }

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
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    const directKey = Conversation.buildDirectKey(senderId, receiverId);
    const conversation = await Conversation.findOne({ directKey });

    if (!conversation) {
      return res.status(200).json([]);
    }

    // Marks read and caps at the 200 most recent messages, same as before.
    const messages = await getDirectConversationMessagesLegacy(
      conversation._id,
      senderId
    );
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

    const message = await Message.findById(messageId);
    if (!message || !message.conversationId) {
      return res.status(404).json({ error: "Message not found" });
    }

    await clearHistoryUpTo({
      conversationId: message.conversationId,
      userId,
      messageId,
    });

    res.status(200).json({ message: "Messages deleted successfully" });
  } catch (error) {
    console.log("Error in deleteMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Upload images to user
/////////////////////////////////////////////
export const uploadImages = async (req, res) => {
  try {
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    // Check if images were uploaded
    if (!req.filenames || req.filenames.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    // Use only filenames (no path prefix)
    const imageFiles = req.filenames;

    const conversation = await findOrCreateDirectConversation(senderId, receiverId);
    const { message: newMessage } = await postConversationMessage({
      conversationId: conversation._id,
      senderId,
      imageFiles,
    });

    // Send socket notification to all connected devices of receiver
    const receiverSocketIds = getReceiverSocketIds(receiverId);
    if (receiverSocketIds.length > 0) {
      console.log(
        `Receiver has ${receiverSocketIds.length} device(s) connected, sending real-time signal`
      );
      receiverSocketIds.forEach((socketId) => {
        io.to(socketId).emit("newMessageSignal");
      });
    } else {
      console.log("Receiver socket not connected");
      // Send FCM notification only if receiver is not connected via socket
      console.log("Sending FCM notification for image upload");
      await notificationService(receiverId, {
        title: "BTC2 updates",
        body: "Received " + req.filenames.length + " image(s)",
        payload: {
          messageId: newMessage._id.toString(),
          senderId: senderId.toString(),
          type: "chat_image",
        },
      });
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.log("Error in uploadImages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
