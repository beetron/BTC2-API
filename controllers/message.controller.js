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

    // Update messages to online users
    const receiverSocketId = getReceiverSocketId(receiverId);
    if (receiverSocketId) {
      io.to(receiverSocketId).emit("newMessage", newMessage);
    }

    // Send push via OneSignal if user's not online
    if (!receiverSocketId) {
      console.log("Sending push to: " + receiverId);

      const pushRes = await fetch(
        "https://api.onesignal.com/notifications?c=push",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: process.env.ONESIGNAL_API_KEY,
          },
          body: JSON.stringify({
            app_id: process.env.ONESIGNAL_APP_ID,
            target_channel: "push",
            include_aliases: {
              external_id: [receiverId],
            },
            contents: { en: "Update on prices" },
          }),
        }
      );
      const pushResParsed = await pushRes.json();
      console.log("Push notification response: ", pushResParsed);
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
