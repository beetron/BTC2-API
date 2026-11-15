import Message from "../models/message.model.js";

// How much of the quoted message a reply preview carries. Enough for the
// one or two lines a client shows above the reply.
export const REPLY_PREVIEW_LENGTH = 200;

// Same shape in every case, so clients can rely on every field existing:
// - normal:      the quoted text (cut to REPLY_PREVIEW_LENGTH) and whether it had images
// - deleted:     the original was deleted for everyone
// - unavailable: the original no longer exists at all (history cleared on
//                both sides, or removed by an admin)
const replyPreview = (replyToId, quoted) => {
  if (!quoted) {
    return {
      _id: replyToId,
      senderId: null,
      message: null,
      hasImages: false,
      deleted: false,
      unavailable: true,
    };
  }
  if (quoted.deletedAt) {
    return {
      _id: replyToId,
      senderId: quoted.senderId,
      message: null,
      hasImages: false,
      deleted: true,
      unavailable: false,
    };
  }
  const text = quoted.message || "";
  return {
    _id: replyToId,
    senderId: quoted.senderId,
    message: text.length > REPLY_PREVIEW_LENGTH ? text.slice(0, REPLY_PREVIEW_LENGTH) : text,
    hasImages: (quoted.imageFiles?.length ?? 0) > 0,
    deleted: false,
    unavailable: false,
  };
};

// Adds a `replyTo` preview to every message that quotes another one, with
// a single query for the whole page. The preview is read live, so editing
// or deleting the original changes every quote of it. Messages that are
// not replies are returned unchanged (no replyTo field).
export const withReplyPreviews = async (messages, conversationId) => {
  const plain = messages.map((m) => (typeof m.toObject === "function" ? m.toObject() : m));
  const quotedIds = [
    ...new Set(plain.filter((m) => m.replyToId).map((m) => m.replyToId.toString())),
  ];
  if (quotedIds.length === 0) return plain;

  // conversationId in the filter: a quote can never surface a message from
  // another conversation, even if a bad replyToId were ever stored
  const quoted = await Message.find({ _id: { $in: quotedIds }, conversationId })
    .select("senderId message imageFiles deletedAt")
    .lean();
  const quotedById = new Map(quoted.map((q) => [q._id.toString(), q]));

  return plain.map((m) =>
    m.replyToId
      ? { ...m, replyTo: replyPreview(m.replyToId, quotedById.get(m.replyToId.toString())) }
      : m
  );
};

export const withReplyPreview = async (message, conversationId) =>
  (await withReplyPreviews([message], conversationId))[0];
