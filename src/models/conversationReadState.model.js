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
    // Per-user "cleared my view up to here" marker
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
// The unread total for one user (app icon badge, push notifications)
conversationReadStateSchema.index({ userId: 1 });

const ConversationReadState = mongoose.model(
  "ConversationReadState",
  conversationReadStateSchema
);
export default ConversationReadState;
