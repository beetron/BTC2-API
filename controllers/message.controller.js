import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import { getReceiverSocketId, io } from "../socket/socket.js";

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

    // Notify receiver of new message if online
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      console.log("Emitting newMessageSignal to receiver");
      io.to(receiverSocketId).emit("newMessageSignal");
    }

    res.status(201).json(newMessage);
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

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
