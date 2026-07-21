import * as conversationService from "../services/conversationService.js";
import { getReceiverSocketIds, io } from "../socket/socket.js";
import { notificationService } from "../services/notificationService.js";

/////////////////////////////////////////////
// List all conversations (direct + group) for the caller
/////////////////////////////////////////////
export const listConversations = async (req, res) => {
  try {
    const conversations = await conversationService.listConversations(req.user._id);
    res.status(200).json(conversations);
  } catch (error) {
    console.log("Error in listConversations controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
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
    console.log("Error in getConversation controller: ", error.message);
    res.status(400).json({ error: error.message });
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
    console.log("Error in createDirect controller: ", error.message);
    res.status(400).json({ error: error.message });
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
    console.log("Error in createGroup controller: ", error.message);
    res.status(400).json({ error: error.message });
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
    console.log("Error in getMessages (conversation) controller: ", error.message);
    res.status(400).json({ error: error.message });
  }
};

/////////////////////////////////////////////
// Send a message into a direct or group conversation
/////////////////////////////////////////////
export const postMessage = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const { message } = req.body;
    const senderId = req.user._id;

    const { message: newMessage, recipients } = await conversationService.postMessage({
      conversationId,
      senderId,
      message,
    });

    const senderSocketIds = getReceiverSocketIds(senderId.toString());
    io.to(conversationId)
      .except(senderSocketIds)
      .emit("conversation:message", {
        conversationId,
        messageId: newMessage._id,
      });

    const offlineRecipients = recipients.filter(
      (m) => getReceiverSocketIds(m.userId.toString()).length === 0
    );

    if (offlineRecipients.length > 0) {
      await Promise.all(
        offlineRecipients.map((m) =>
          notificationService(m.userId, {
            title: "BTC2 updates",
            body: message && message.length > 20 ? message.substring(0, 17) + "..." : message,
            payload: {
              messageId: newMessage._id.toString(),
              senderId: senderId.toString(),
              conversationId: conversationId.toString(),
              type: "chat_message",
            },
          })
        )
      );
    }

    res.status(200).json({ success: true, messageId: newMessage._id });
  } catch (error) {
    console.log("Error in postMessage (conversation) controller: ", error.message);
    res.status(400).json({ error: error.message });
  }
};

/////////////////////////////////////////////
// Upload images into a direct or group conversation
/////////////////////////////////////////////
export const uploadConversationImages = async (req, res) => {
  try {
    const { id: conversationId } = req.params;
    const senderId = req.user._id;

    if (!req.filenames || req.filenames.length === 0) {
      return res.status(400).json({ error: "No images uploaded" });
    }

    const { message: newMessage, recipients } = await conversationService.postMessage({
      conversationId,
      senderId,
      imageFiles: req.filenames,
    });

    const senderSocketIds = getReceiverSocketIds(senderId.toString());
    io.to(conversationId)
      .except(senderSocketIds)
      .emit("conversation:message", {
        conversationId,
        messageId: newMessage._id,
      });

    const offlineRecipients = recipients.filter(
      (m) => getReceiverSocketIds(m.userId.toString()).length === 0
    );

    if (offlineRecipients.length > 0) {
      await Promise.all(
        offlineRecipients.map((m) =>
          notificationService(m.userId, {
            title: "BTC2 updates",
            body: "Received " + req.filenames.length + " image(s)",
            payload: {
              messageId: newMessage._id.toString(),
              senderId: senderId.toString(),
              conversationId: conversationId.toString(),
              type: "chat_image",
            },
          })
        )
      );
    }

    res.status(200).json({ success: true, messageId: newMessage._id });
  } catch (error) {
    console.log("Error in uploadConversationImages controller: ", error.message);
    res.status(400).json({ error: error.message });
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
    console.log("Error in addMembers controller: ", error.message);
    res.status(400).json({ error: error.message });
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
    console.log("Error in removeMember controller: ", error.message);
    res.status(400).json({ error: error.message });
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
    console.log("Error in updateConversation controller: ", error.message);
    res.status(400).json({ error: error.message });
  }
};
