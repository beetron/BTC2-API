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
  },
  { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });

const Message = mongoose.model("Message", messageSchema);
export default Message;
