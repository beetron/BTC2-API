import Message from "../models/message.model.js";
import ConversationReadState from "../models/conversationReadState.model.js";
import { HttpError } from "../utility/httpError.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";
import {
  loadConversationForMember,
  validateMessageInput,
  encodePosition,
  decodeCursor,
} from "./conversationService.js";
import { withReplyPreview, withReplyPreviews } from "./messageView.js";

// Edit and delete-for-everyone. Both are allowed for the sender only, with
// no time limit. A group owner has no extra rights over other members'
// messages. Everyone who can see the conversation sees the result.

// The caller's own message in this conversation, or the error to answer with
const loadOwnMessage = async ({ conversationId, messageId, userId, action }) => {
  const message = await Message.findOne({ _id: messageId, conversationId }).lean();
  if (!message) throw new HttpError(404, "Message not found in this conversation");
  // 400 rather than 403: btc2-web signs the user out on any 403
  if (message.senderId.toString() !== userId.toString()) {
    throw new HttpError(400, `You can only ${action} your own messages`);
  }
  return message;
};

/////////////////////////////////////////////
// Edit
/////////////////////////////////////////////

// Overwrites the text and sets editedAt; no history is kept. Returns
// { message, changed }. changed is false when the text was already the
// same, in which case nothing is written and nobody needs to be told.
export const editMessage = async ({ conversationId, messageId, userId, message }) => {
  // Same rules as sending: a non-empty string within the length limit
  validateMessageInput({ message });

  const conversation = await loadConversationForMember(conversationId, userId);
  const existing = await loadOwnMessage({ conversationId, messageId, userId, action: "edit" });
  if (existing.deletedAt) throw new HttpError(400, "Cannot edit a deleted message");

  if (existing.message === message) {
    return { message: await withReplyPreview(existing, conversation._id), changed: false };
  }

  // deletedAt: null in the filter, so an edit racing a delete cannot bring
  // text back into a tombstone
  const updated = await Message.findOneAndUpdate(
    { _id: existing._id, deletedAt: null },
    { $set: { message, editedAt: new Date() } },
    { returnDocument: "after" }
  ).lean();
  if (!updated) throw new HttpError(400, "Cannot edit a deleted message");

  return { message: await withReplyPreview(updated, conversation._id), changed: true };
};

/////////////////////////////////////////////
// Delete for everyone
/////////////////////////////////////////////

// True when `marker` is the same message as `message` or newer, using the
// same (createdAt, _id) order history is paged in
const isAtOrAfter = (marker, message) => {
  const a = marker.createdAt.getTime();
  const b = message.createdAt.getTime();
  return a > b || (a === b && marker._id.toString() >= message._id.toString());
};

// A deleted message no longer shows up for anyone, so it must stop counting
// as unread for members who had not read it yet. Only members who were
// counted when it was sent (active, not the sender, already joined) and
// who had neither read past it nor cleared history past it are lowered.
const removeFromUnreadCounts = async (conversation, message) => {
  const counted = conversation.members.filter(
    (m) =>
      !m.leftAt &&
      m.userId.toString() !== message.senderId.toString() &&
      (!m.joinedAt || m.joinedAt <= message.createdAt)
  );
  if (counted.length === 0) return;

  const states = await ConversationReadState.find({
    conversationId: conversation._id,
    userId: { $in: counted.map((m) => m.userId) },
    unreadCount: { $gt: 0 },
  })
    .select("lastReadMessageId clearedAt")
    .lean();
  if (states.length === 0) return;

  const markerIds = states.map((s) => s.lastReadMessageId).filter(Boolean);
  const markers = markerIds.length
    ? await Message.find({ _id: { $in: markerIds } }).select("createdAt").lean()
    : [];
  const markerById = new Map(markers.map((m) => [m._id.toString(), m]));

  const ops = states
    .filter((s) => {
      const marker = s.lastReadMessageId && markerById.get(s.lastReadMessageId.toString());
      const alreadyRead = marker && isAtOrAfter(marker, message);
      const clearedPast = s.clearedAt && s.clearedAt >= message.createdAt;
      return !alreadyRead && !clearedPast;
    })
    .map((s) => ({
      updateOne: {
        // unreadCount > 0 again here, so two deletes at once never go negative
        filter: { _id: s._id, unreadCount: { $gt: 0 } },
        update: { $inc: { unreadCount: -1 } },
      },
    }));

  if (ops.length > 0) {
    await ConversationReadState.bulkWrite(ops, { ordered: false });
  }
};

// Turns the message into a tombstone: text, images and the reply link are
// removed, deletedAt is set, the document itself stays. Deleting an
// already deleted message is not an error. Returns { message, changed }.
export const deleteMessageForEveryone = async ({ conversationId, messageId, userId }) => {
  const conversation = await loadConversationForMember(conversationId, userId);
  const existing = await loadOwnMessage({
    conversationId,
    messageId,
    userId,
    action: "delete",
  });
  if (existing.deletedAt) return { message: existing, changed: false };

  const updated = await Message.findOneAndUpdate(
    { _id: existing._id, deletedAt: null },
    { $set: { deletedAt: new Date(), message: null, imageFiles: [], replyToId: null } },
    { returnDocument: "after" }
  ).lean();

  // Another request deleted it a moment ago and did the cleanup below
  if (!updated) {
    return { message: await Message.findById(existing._id).lean(), changed: false };
  }

  await Promise.all([
    // Only unlinks files no other message still references
    handleImageFileCleanup(existing.imageFiles),
    removeFromUnreadCounts(conversation, existing),
  ]);

  return { message: updated, changed: true };
};

/////////////////////////////////////////////
// Changes feed
/////////////////////////////////////////////

// Every message created, edited or deleted after a point, oldest change
// first, tombstones included. Clients use it after reconnecting or coming
// back to the app, to catch edits and deletes of messages older than the
// newest page (which a plain refetch never covers).
//
// First call: ?since=<ISO date>. The response's nextCursor marks the last
// change returned; pass it as ?cursor= on the next call (more pages while
// hasMore is true, and later for the next sync). nextCursor is null when
// nothing changed; keep using the previous position then.
export const getMessageChanges = async (conversationId, userId, { since, cursor, limit } = {}) => {
  let after;
  if (!cursor && (since === undefined || since === "")) {
    throw new HttpError(400, "since or cursor is required");
  }
  if (cursor) {
    const { createdAt: updatedAt, id } = decodeCursor(cursor);
    after = { $or: [{ updatedAt: { $gt: updatedAt } }, { updatedAt, _id: { $gt: id } }] };
  } else {
    const sinceDate = typeof since === "string" ? new Date(since) : new Date(NaN);
    if (Number.isNaN(sinceDate.getTime())) throw new HttpError(400, "Invalid since");
    after = { updatedAt: { $gt: sinceDate } };
  }

  const [conversation, state] = await Promise.all([
    loadConversationForMember(conversationId, userId),
    ConversationReadState.findOne({ conversationId, userId }).select("clearedAt").lean(),
  ]);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 200);

  const query = { conversationId: conversation._id, ...after };
  // History the user cleared stays cleared here too
  if (state?.clearedAt) query.createdAt = { $gt: state.clearedAt };

  const rows = await Message.find(query)
    .sort({ updatedAt: 1, _id: 1 })
    .limit(safeLimit + 1)
    .lean();

  const hasMore = rows.length > safeLimit;
  const messages = hasMore ? rows.slice(0, safeLimit) : rows;
  const last = messages[messages.length - 1];

  return {
    messages: await withReplyPreviews(messages, conversation._id),
    nextCursor: last ? encodePosition(last.updatedAt, last._id) : null,
    hasMore,
  };
};
