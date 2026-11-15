import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Populated for direct messages only; null for group messages, where
    // recipients are derived from Conversation.members instead.
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      default: null,
    },
    message: {
      type: String,
    },
    imageFiles: {
      type: [String],
      default: [],
    },
    // Optional id the sending client generates for each message (e.g. a
    // UUID). A retry after a lost response sends the same id again, and
    // the API returns the message it already stored instead of creating a
    // duplicate. Unique per sender.
    clientMessageId: {
      type: String,
      default: undefined,
    },
    // The message this one quotes (quote reply). Always a message in the
    // same conversation. Resolved into a `replyTo` preview at read time, so
    // an edit or delete of the original shows up in every quote of it.
    replyToId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    // Set when the sender edits the text (edits overwrite, no history)
    editedAt: {
      type: Date,
      default: null,
    },
    // Delete for everyone: the document stays as a tombstone (message
    // null, no images, no reply) so read markers and quotes pointing at it
    // stay valid. Hidden from history unless a client asks for tombstones.
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
// GET /conversations/:id/messages/changes: everything created, edited or
// deleted in a conversation after a point in time
messageSchema.index({ conversationId: 1, updatedAt: 1, _id: 1 });
// Only messages that carry a clientMessageId are indexed, so messages
// without one (older clients) never collide with each other.
messageSchema.index(
  { senderId: 1, clientMessageId: 1 },
  { unique: true, partialFilterExpression: { clientMessageId: { $type: "string" } } }
);
// Lets admin purges find every message a user sent without a collection scan
messageSchema.index({ senderId: 1 });

const Message = mongoose.model("Message", messageSchema);
export default Message;
