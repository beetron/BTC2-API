import * as conversationService from "../services/conversationService.js";
import { getReceiverSocketIds, io } from "../socket/socket.js";
import {
  broadcastNewMessage,
  notifyOfflineRecipients,
} from "../services/messageDelivery.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";
import { sendError } from "../utility/httpError.js";
import { isObjectIdString } from "../middleware/validateObjectId.js";

/////////////////////////////////////////////
// List all conversations (direct + group) for the caller
/////////////////////////////////////////////
export const listConversations = async (req, res) => {
  try {
    const conversations = await conversationService.listConversations(req.user._id);
    res.status(200).json(conversations);
  } catch (error) {
    sendError(res, error, "listConversations controller");
  }
};

/////////////////////////////////////////////
// Full detail (with member profiles) for one conversation
/////////////////////////////////////////////
export const getConversation = async (req, res) => {
  try {
    const detail = await conversationService.getConversationDetail(
      req.params.id,
      req.user._id
    );
    res.status(200).json(detail);
  } catch (error) {
    sendError(res, error, "getConversation controller");
  }
};

/////////////////////////////////////////////
// Find-or-create the direct conversation with another user
/////////////////////////////////////////////
export const createDirect = async (req, res) => {
  try {
    const { userId: otherUserId } = req.body;
    if (!otherUserId) {
      return res.status(400).json({ error: "userId is required" });
    }
    if (!isObjectIdString(otherUserId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    const conversation = await conversationService.findOrCreateDirectConversation(
      req.user._id,
      otherUserId
    );

    const conversationId = conversation._id.toString();
    conversation.members.forEach((m) => {
      getReceiverSocketIds(m.userId.toString()).forEach((socketId) => {
        io.sockets.sockets.get(socketId)?.join(conversationId);
      });
    });

    const detail = await conversationService.getConversationDetail(
      conversationId,
      req.user._id
    );
    res.status(200).json(detail);
  } catch (error) {
    sendError(res, error, "createDirect controller");
  }
};

/////////////////////////////////////////////
// Create a group conversation
/////////////////////////////////////////////
export const createGroup = async (req, res) => {
  try {
    const { name, memberIds } = req.body;
    if (!name || !Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: "name and memberIds are required" });
    }

    const conversation = await conversationService.createGroup({
      creatorId: req.user._id,
      name,
      memberIds,
    });

    const conversationId = conversation._id.toString();
    conversation.members.forEach((m) => {
      getReceiverSocketIds(m.userId.toString()).forEach((socketId) => {
        io.sockets.sockets.get(socketId)?.join(conversationId);
      });
    });

    res.status(201).json(conversation);
  } catch (error) {
    sendError(res, error, "createGroup controller");
  }
};

/////////////////////////////////////////////
// Cursor-paginated message history for a conversation
/////////////////////////////////////////////
export const getMessages = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { cursor, limit } = req.query;

    const result = await conversationService.getConversationMessages(
      conversationId,
      req.user._id,
      { cursor, limit }
    );

    res.status(200).json(result);
  } catch (error) {
    sendError(res, error, "getMessages (conversation) controller");
  }
};

// Same response for a new message and for a retried one, so a client can
// treat any 200 as "this message is stored" and render it straight from
// the response instead of refetching. `message` is the stored message,
// with the server's _id and createdAt.
const sentMessageResponse = (message) => ({
  success: true,
  messageId: message._id,
  message,
});

/////////////////////////////////////////////
// Send a message into a direct or group conversation
/////////////////////////////////////////////
export const postMessage = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { message, clientMessageId } = req.body;
    const senderId = req.user._id;

    const {
      message: newMessage,
      recipients,
      duplicate,
    } = await conversationService.postMessage({
      conversationId,
      senderId,
      message,
      clientMessageId,
    });

    res.status(200).json(sentMessageResponse(newMessage));

    // A retry of a message that is already stored was already announced
    if (duplicate) return;

    broadcastNewMessage(req, conversationId, newMessage);
    notifyOfflineRecipients(recipients, {
      title: "BTC2 updates",
      body: message.length > 20 ? message.substring(0, 17) + "..." : message,
      payload: {
        messageId: newMessage._id.toString(),
        senderId: senderId.toString(),
        conversationId: conversationId.toString(),
        type: "chat_message",
      },
    });
  } catch (error) {
    sendError(res, error, "postMessage (conversation) controller");
  }
};

/////////////////////////////////////////////
// Upload images into a direct or group conversation
/////////////////////////////////////////////
export const uploadConversationImages = async (req, res) => {
  // Multer has already written the files to disk by the time this runs
  const uploadedFiles = req.filenames || [];

  try {
    const { id: conversationId } = req.params;
    const senderId = req.user._id;

    if (uploadedFiles.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const {
      message: newMessage,
      recipients,
      duplicate,
    } = await conversationService.postMessage({
      conversationId,
      senderId,
      imageFiles: uploadedFiles,
      clientMessageId: req.body?.clientMessageId,
    });

    if (duplicate) {
      // The retry's copies of the images belong to no message; the stored
      // message still points at the files from the first attempt
      await handleImageFileCleanup(uploadedFiles);
      return res.status(200).json(sentMessageResponse(newMessage));
    }

    res.status(200).json(sentMessageResponse(newMessage));

    broadcastNewMessage(req, conversationId, newMessage);
    notifyOfflineRecipients(recipients, {
      title: "BTC2 updates",
      body: "Received " + uploadedFiles.length + " image(s)",
      payload: {
        messageId: newMessage._id.toString(),
        senderId: senderId.toString(),
        conversationId: conversationId.toString(),
        type: "chat_image",
      },
    });
  } catch (error) {
    // Nothing references the files of a failed upload (not a member, bad
    // input...), so remove them instead of leaving them on disk forever
    await handleImageFileCleanup(uploadedFiles);
    sendError(res, error, "uploadConversationImages controller");
  }
};

/////////////////////////////////////////////
// Add member(s) to a group
/////////////////////////////////////////////
export const addMembers = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { memberIds } = req.body;
    if (!Array.isArray(memberIds) || memberIds.length === 0) {
      return res.status(400).json({ error: "memberIds is required" });
    }

    const conversation = await conversationService.addMembers({
      conversationId,
      actorId: req.user._id,
      memberIds,
    });

    memberIds.forEach((userId) => {
      getReceiverSocketIds(userId.toString()).forEach((socketId) => {
        io.sockets.sockets.get(socketId)?.join(conversationId);
      });
    });
    io.to(conversationId).emit("conversation:memberAdded", { conversationId, memberIds });

    res.status(200).json(conversation);
  } catch (error) {
    sendError(res, error, "addMembers controller");
  }
};

/////////////////////////////////////////////
// Remove a member (or self-leave)
/////////////////////////////////////////////
export const removeMember = async (req, res) => {
  try {
    const { id: conversationId, userId: targetUserId } = req.params;

    const { conversation, conversationDeleted } = await conversationService.removeMember({
      conversationId,
      actorId: req.user._id,
      targetUserId,
    });

    getReceiverSocketIds(targetUserId).forEach((socketId) => {
      io.sockets.sockets.get(socketId)?.leave(conversationId);
    });
    // conversationDeleted only ever happens when targetUserId was the last
    // active member -- their own sockets just left the room above, so
    // there's nobody else left in it to notify.
    io.to(conversationId).emit("conversation:memberRemoved", {
      conversationId,
      userId: targetUserId,
    });

    res.status(200).json({ ...conversation.toObject(), conversationDeleted });
  } catch (error) {
    sendError(res, error, "removeMember controller");
  }
};

/////////////////////////////////////////////
// Rename a group / update its avatar
/////////////////////////////////////////////
export const updateConversation = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { name, avatar } = req.body;

    const conversation = await conversationService.renameGroup({
      conversationId,
      actorId: req.user._id,
      name,
      avatar,
    });

    io.to(conversationId).emit("conversation:updated", { conversationId, name, avatar });

    res.status(200).json(conversation);
  } catch (error) {
    sendError(res, error, "updateConversation controller");
  }
};
