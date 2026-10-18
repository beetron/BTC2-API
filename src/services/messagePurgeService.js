import mongoose from "mongoose";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import ConversationReadState from "../models/conversationReadState.model.js";
import UserConversation from "../models/userConversation.model.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";
import { io } from "../socket/socket.js";

// Messages deleted per round trip. Keeps memory and query size flat no
// matter how many messages the user has sent.
const BATCH_SIZE = 500;

const latest = (dates) =>
  dates.filter(Boolean).reduce((a, b) => (a > b ? a : b), null);

// Same event a new message sends, so both the iOS and web clients refetch
// the open thread and the conversation list without any client change.
export const notifyConversationsChanged = (conversationIds) => {
  conversationIds.forEach((id) => {
    const conversationId = id.toString();
    io.to(conversationId).emit("conversation:message", { conversationId });
  });
};

/////////////////////////////////////////////
// Delete every message a user has sent, in direct chats and groups.
// Messages from everyone else stay. Read markers and unread counts that
// pointed at or included the deleted messages are corrected, orphaned
// image files are removed, and open clients are told to refetch.
//
// Pass notify: false when the caller is about to delete some of these
// conversations anyway (account deletion) and will notify afterwards via
// notifyConversationsChanged, so clients never refetch a conversation
// that is gone a moment later.
/////////////////////////////////////////////
export const purgeMessagesSentBy = async (userId, { notify = true } = {}) => {
  const senderId = new mongoose.Types.ObjectId(userId.toString());

  const conversationIds = await Message.distinct("conversationId", {
    senderId,
    conversationId: { $ne: null },
  });

  // Snapshot read markers before deleting anything: a marker may point at
  // one of the messages about to go, and its timestamp is still needed to
  // work out what is unread afterwards.
  const readStates = conversationIds.length
    ? await ConversationReadState.find({
        conversationId: { $in: conversationIds },
      }).lean()
    : [];
  const markerIds = readStates.map((s) => s.lastReadMessageId).filter(Boolean);
  const markerMessages = markerIds.length
    ? await Message.find({ _id: { $in: markerIds } })
        .select("createdAt senderId")
        .lean()
    : [];
  const markerById = new Map(markerMessages.map((m) => [m._id.toString(), m]));

  let deletedCount = 0;
  const imageFiles = [];

  // Re-query each round instead of holding a cursor open over documents
  // that are being deleted underneath it.
  for (;;) {
    const batch = await Message.find({ senderId })
      .select("_id imageFiles conversationId")
      .limit(BATCH_SIZE)
      .lean();
    if (batch.length === 0) break;

    const ids = batch.map((m) => m._id);
    imageFiles.push(...batch.flatMap((m) => m.imageFiles || []));

    const result = await Message.deleteMany({ _id: { $in: ids } });
    deletedCount += result.deletedCount;

    // Pre-migration messages are also referenced from UserConversation
    const legacyIds = batch.filter((m) => !m.conversationId).map((m) => m._id);
    if (legacyIds.length > 0) {
      await UserConversation.updateMany(
        { messages: { $in: legacyIds } },
        { $pull: { messages: { $in: legacyIds } } }
      );
      await UserConversation.updateMany(
        { lastReadMessageId: { $in: legacyIds } },
        { $set: { lastReadMessageId: null } }
      );
    }
  }

  await repairReadStates(readStates, markerById, senderId, conversationIds);
  await handleImageFileCleanup(imageFiles);

  if (notify) notifyConversationsChanged(conversationIds);

  return { deletedCount, conversationIds };
};

const repairReadStates = async (readStates, markerById, senderId, conversationIds) => {
  if (readStates.length === 0) return;

  // Unread is only counted from when someone joined, matching how
  // postMessage only increments counters for members present at the time.
  const conversations = await Conversation.find({ _id: { $in: conversationIds } })
    .select("members")
    .lean();
  const joinedAt = new Map();
  conversations.forEach((c) =>
    c.members.forEach((m) =>
      joinedAt.set(`${c._id}:${m.userId}`, m.joinedAt || null)
    )
  );

  const ops = [];

  for (const state of readStates) {
    const marker = state.lastReadMessageId
      ? markerById.get(state.lastReadMessageId.toString())
      : null;
    const lastReadAt = marker?.createdAt || null;
    const update = {};

    // Marker pointed at a deleted message: move it back to the newest
    // message that survived at or before that point.
    if (marker && marker.senderId.equals(senderId)) {
      const replacement = await Message.findOne({
        conversationId: state.conversationId,
        createdAt: { $lte: lastReadAt },
      })
        .sort({ createdAt: -1, _id: -1 })
        .select("_id")
        .lean();
      update.lastReadMessageId = replacement?._id || null;
    }

    // Deleting messages can only lower an unread count, never raise it, so
    // the stored counter is kept whenever the recount comes out higher.
    if (state.unreadCount > 0) {
      const since = latest([
        lastReadAt,
        state.clearedAt,
        joinedAt.get(`${state.conversationId}:${state.userId}`),
      ]);
      const query = {
        conversationId: state.conversationId,
        senderId: { $ne: state.userId },
      };
      if (since) query.createdAt = { $gt: since };

      const recount = await Message.countDocuments(query);
      if (recount < state.unreadCount) update.unreadCount = recount;
    }

    if (Object.keys(update).length > 0) {
      ops.push({ updateOne: { filter: { _id: state._id }, update: { $set: update } } });
    }
  }

  if (ops.length > 0) {
    await ConversationReadState.bulkWrite(ops);
  }
};
