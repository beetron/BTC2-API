import mongoose from "mongoose";

const conversationReadStateSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
    // Per-user "cleared my view up to here" marker, replaces
    // UserConversation.deleteFromTimestamp.
    clearedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

conversationReadStateSchema.index(
  { conversationId: 1, userId: 1 },
  { unique: true }
);

const ConversationReadState = mongoose.model(
  "ConversationReadState",
  conversationReadStateSchema
);
export default ConversationReadState;
