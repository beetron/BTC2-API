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
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
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
