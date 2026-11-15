import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import {
  findOrCreateDirectConversation,
  postMessage as postConversationMessage,
  getDirectConversationMessagesLegacy,
  clearHistoryUpTo,
} from "../services/conversationService.js";
import { getReceiverSocketIds, io } from "../socket/socket.js";
import { notifyOfflineRecipients } from "../services/messageDelivery.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";
import { sendError } from "../utility/httpError.js";

// Legacy direct-message endpoints. Current web and mobile builds use
// /conversations/:id/messages and /conversations/:id/upload instead; send,
// upload and get here are deprecated (see messages.routes.js).

// Old clients listen for this event instead of conversation:message.
// Push notifications go out after the response, only if the receiver has
// no socket connected.
const signalReceiver = (receiverId, notification) => {
  const receiverSocketIds = getReceiverSocketIds(receiverId);
  if (receiverSocketIds.length > 0) {
    receiverSocketIds.forEach((socketId) => {
      io.to(socketId).emit("newMessageSignal");
    });
    return;
  }
  notifyOfflineRecipients([{ userId: receiverId }], notification);
};

/////////////////////////////////////////////
// Send message to user
/////////////////////////////////////////////
export const sendMessage = async (req, res) => {
  try {
    const { message } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    const conversation = await findOrCreateDirectConversation(senderId, receiverId);
    // Validates message (non-empty string, length limit) before storing it
    const { message: newMessage } = await postConversationMessage({
      conversationId: conversation._id,
      senderId,
      message,
    });

    // Status 200 will be returned regardless of receiver having FCM token or not
    res.status(200).json({ success: true });

    signalReceiver(receiverId, {
      title: "BTC2 updates",
      body: message.length > 20 ? message.substring(0, 17) + "..." : message,
      payload: {
        messageId: newMessage._id.toString(),
        senderId: senderId.toString(),
        type: "chat_message",
      },
    });
  } catch (error) {
    sendError(res, error, "sendMessage controller");
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
    const conversation = await Conversation.findOne({ directKey }).select("_id").lean();

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
    sendError(res, error, "getMessages controller");
  }
};

/////////////////////////////////////////////
// Clear the caller's own view of a conversation up to a message. Still
// used by both clients; only affects the caller.
/////////////////////////////////////////////
export const deleteMessages = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId).select("conversationId").lean();
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
    sendError(res, error, "deleteMessages controller");
  }
};

/////////////////////////////////////////////
// Upload images to user
/////////////////////////////////////////////
export const uploadImages = async (req, res) => {
  const uploadedFiles = req.filenames || [];

  try {
    const { id: receiverId } = req.params;
    const senderId = req.user._id;

    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const conversation = await findOrCreateDirectConversation(senderId, receiverId);
    const { message: newMessage } = await postConversationMessage({
      conversationId: conversation._id,
      senderId,
      imageFiles: uploadedFiles,
    });

    res.status(200).json({ success: true });

    signalReceiver(receiverId, {
      title: "BTC2 updates",
      body: "Received " + uploadedFiles.length + " image(s)",
      payload: {
        messageId: newMessage._id.toString(),
        senderId: senderId.toString(),
        type: "chat_image",
      },
    });
  } catch (error) {
    // Files of a failed upload belong to no message
    await handleImageFileCleanup(uploadedFiles);
    sendError(res, error, "uploadImages controller");
  }
};
