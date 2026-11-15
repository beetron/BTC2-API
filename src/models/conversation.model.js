import mongoose from "mongoose";

const memberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["owner", "member"],
      default: "member",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    leftAt: {
      type: Date,
      default: null,
    },
  },
  { _id: false }
);

const conversationSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["direct", "group"],
      required: true,
    },
    members: [memberSchema],
    name: {
      type: String,
      default: null,
    },
    avatar: {
      type: String,
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    // Sorted-pair key for direct conversations only ("<smallerId>_<largerId>").
    // Lets us find-or-create the 1:1 thread without scanning members. Null
    // for group conversations.
    directKey: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Only enforced for documents where directKey is actually a string, so
// multiple group conversations (directKey: null) never collide.
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: "string" } } }
);
conversationSchema.index({ "members.userId": 1, lastMessageAt: -1 });

conversationSchema.statics.buildDirectKey = function (userIdA, userIdB) {
  const [a, b] = [userIdA.toString(), userIdB.toString()].sort();
  return `${a}_${b}`;
};

// Works on plain objects too, so callers can use .lean() queries
conversationSchema.statics.hasActiveMember = function (conversation, userId) {
  return conversation.members.some(
    (m) => m.userId.toString() === userId.toString() && !m.leftAt
  );
};

// Query filter matching conversations the user is currently a member of.
// leftAt: null also matches members saved before leftAt existed.
conversationSchema.statics.activeMemberFilter = function (userId) {
  return { members: { $elemMatch: { userId, leftAt: null } } };
};

conversationSchema.methods.isActiveMember = function (userId) {
  return this.constructor.hasActiveMember(this, userId);
};

conversationSchema.methods.getMemberRole = function (userId) {
  const member = this.members.find(
    (m) => m.userId.toString() === userId.toString() && !m.leftAt
  );
  return member ? member.role : null;
};

const Conversation = mongoose.model("Conversation", conversationSchema);
export default Conversation;
