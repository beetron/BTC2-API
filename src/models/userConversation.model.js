import Message from "./message.model.js";
import mongoose from "mongoose";

const userConversationSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    messages: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Message",
        default: [],
      },
    ],
    lastReadMessageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Message",
    },
    deleteFromTimestamp: {
      type: Date,
      default: null,
    },
    unreadCount: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Get messages
userConversationSchema.methods.getMessages = async function () {
  const messages = await Message.find({
    _id: { $in: this.messages },
    createdAt: {
      $gt: this.deleteFromTimestamp || new Date(0),
    },
  }).sort({ createdAt: -1 });

  // Update lastReadMessageId if there are messages
  if (messages.length > 0) {
    this.lastReadMessageId = messages[0]._id;
    this.unreadCount = 0;
    await this.save();
  }

  return messages;
};

// Get unread messages count
userConversationSchema.methods.getUnreadCount = async function () {
  const lastRead = await Message.findById(this.lastReadMessageId);
  const lastReadTime = lastRead ? lastRead.createdAt : new Date(0);

  return Message.countDocuments({
    _id: { $in: this.messages },
    createdAt: {
      $gt: Math.max(lastReadTime, this.deleteFromTimestamp || new Date(0)),
    },
  });
};

// Delete messages between sender and receiver up to recent
// message shown on user's frontend screen
userConversationSchema.methods.deleteMessagesUpTo = async function (messageId) {
  const message = await Message.findById(messageId);
  if (!message) {
    throw new Error("Message not found");
  }

  // Verify this message belongs to this conversation
  if (!this.messages.includes(messageId)) {
    throw new Error("Message not found in this conversation");
  }

  // Get index of message to delete up to
  const messageIndex = this.messages.indexOf(messageId);
  const messagesToRemove = this.messages.slice(0, messageIndex + 1);

  // Update conversation's messages array (only for this user)
  this.messages = this.messages.slice(messageIndex + 1);

  // Reset unread count and lastReadMessageId
  this.unreadCount = 0;
  if (this.messages.length === 0) {
    this.lastReadMessageId = null;
  }

  // Find the partner's conversation
  const partnerConversation = await this.constructor.findOne({
    senderId: this.receiverId,
    receiverId: this.senderId,
  });

  // Check which messages can be safely deleted from database
  if (partnerConversation) {
    const safeToDelete = messagesToRemove.filter(
      (msgId) => !partnerConversation.messages.includes(msgId)
    );

    if (safeToDelete.length > 0) {
      // Delete messages that are no longer referenced by either conversation
      await Message.deleteMany({ _id: { $in: safeToDelete } });
    }
  }

  return this.save();
};

userConversationSchema.index({ senderId: 1, receiverId: 1 }, { unique: true });

const UserConversation = mongoose.model(
  "UserConversation",
  userConversationSchema
);
export default UserConversation;
