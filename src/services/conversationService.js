import Conversation from "../models/conversation.model.js";
import ConversationReadState from "../models/conversationReadState.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";

const areFriends = (user, otherUserId) =>
  user.friendList.some((id) => id.toString() === otherUserId.toString());

const getOrCreateReadState = async (conversationId, userId) => {
  let state = await ConversationReadState.findOne({ conversationId, userId });
  if (!state) {
    state = await ConversationReadState.create({ conversationId, userId });
  }
  return state;
};

const encodeCursor = (msg) =>
  Buffer.from(`${msg.createdAt.toISOString()}|${msg._id.toString()}`).toString(
    "base64"
  );

const decodeCursor = (cursor) => {
  const [createdAtStr, id] = Buffer.from(cursor, "base64")
    .toString("utf-8")
    .split("|");
  return { createdAt: new Date(createdAtStr), id };
};

/////////////////////////////////////////////
// Direct (1:1) conversations
/////////////////////////////////////////////

export const findOrCreateDirectConversation = async (userIdA, userIdB) => {
  const directKey = Conversation.buildDirectKey(userIdA, userIdB);

  let conversation = await Conversation.findOne({ directKey });
  if (conversation) return conversation;

  conversation = await Conversation.create({
    type: "direct",
    directKey,
    members: [{ userId: userIdA }, { userId: userIdB }],
    createdBy: userIdA,
    lastMessageAt: new Date(),
  });

  return conversation;
};

/////////////////////////////////////////////
// Messaging (shared by direct + group conversations)
/////////////////////////////////////////////

export const postMessage = async ({
  conversationId,
  senderId,
  message,
  imageFiles = [],
}) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  if (!conversation.isActiveMember(senderId)) {
    throw new Error("Not a member of this conversation");
  }

  // receiverId only makes sense for a direct conversation
  let receiverId = null;
  if (conversation.type === "direct") {
    const other = conversation.members.find(
      (m) => m.userId.toString() !== senderId.toString()
    );
    receiverId = other ? other.userId : null;
  }

  const newMessage = await Message.create({
    senderId,
    receiverId,
    conversationId,
    message,
    imageFiles,
  });

  conversation.lastMessageAt = newMessage.createdAt;
  await conversation.save();

  const recipients = conversation.members.filter(
    (m) => !m.leftAt && m.userId.toString() !== senderId.toString()
  );

  await Promise.all(
    recipients.map(async (m) => {
      const state = await getOrCreateReadState(conversationId, m.userId);
      state.unreadCount += 1;
      await state.save();
    })
  );

  // Sender's own view is implicitly caught up
  const senderState = await getOrCreateReadState(conversationId, senderId);
  senderState.lastReadMessageId = newMessage._id;
  senderState.unreadCount = 0;
  await senderState.save();

  return { message: newMessage, conversation, recipients };
};

// Cursor-paginated history. Returns the most recent page first; pass the
// previous page's nextCursor to page further back in time.
export const getConversationMessages = async (
  conversationId,
  userId,
  { cursor, limit = 50 } = {}
) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  if (!conversation.isActiveMember(userId)) {
    throw new Error("Not a member of this conversation");
  }

  const state = await getOrCreateReadState(conversationId, userId);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

  const query = { conversationId };
  if (state.clearedAt) {
    query.createdAt = { $gt: state.clearedAt };
  }
  if (cursor) {
    const { createdAt, id } = decodeCursor(cursor);
    query.$and = [
      ...(query.$and || []),
      { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }] },
    ];
  }

  const rows = await Message.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1);

  const hasMore = rows.length > safeLimit;
  const messages = hasMore ? rows.slice(0, safeLimit) : rows;
  const nextCursor = hasMore ? encodeCursor(messages[messages.length - 1]) : null;

  // Mark read only on the freshest page (no cursor = just opened the thread)
  if (!cursor && messages.length > 0) {
    state.lastReadMessageId = messages[0]._id;
    state.unreadCount = 0;
    await state.save();
  }

  return { messages, nextCursor };
};

// Legacy-compatible read: plain array, capped, no cursor -- matches the
// exact response shape of GET /messages/get/:id before this migration.
export const getDirectConversationMessagesLegacy = async (
  conversationId,
  userId,
  limit = 200
) => {
  const { messages } = await getConversationMessages(conversationId, userId, {
    limit,
  });
  return messages;
};

// Per-user "clear history up to this message" -- mirrors the old
// UserConversation.deleteMessagesUpTo semantics. For direct conversations,
// once both members have cleared everything, the conversation, its
// messages, and both read states are removed entirely (it's fully
// reconstructible on demand via findOrCreateDirectConversation). Group
// conversations are never auto-deleted this way -- clearing history is a
// per-viewer thing, dissolving a group is a separate explicit action.
export const clearHistoryUpTo = async ({ conversationId, userId, messageId }) => {
  const message = await Message.findOne({ _id: messageId, conversationId });
  if (!message) throw new Error("Message not found in this conversation");

  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  if (!conversation.isActiveMember(userId)) {
    throw new Error("Not a member of this conversation");
  }

  const clearedWindowMessages = await Message.find({
    conversationId,
    createdAt: { $lte: message.createdAt },
  });
  const candidateImageFiles = clearedWindowMessages.flatMap((m) => m.imageFiles);

  const state = await getOrCreateReadState(conversationId, userId);
  state.clearedAt = message.createdAt;
  state.unreadCount = 0;
  await state.save();

  let conversationDeleted = false;

  if (conversation.type === "direct") {
    const activeMembers = conversation.members.filter((m) => !m.leftAt);
    const latestMessage = await Message.findOne({ conversationId }).sort({
      createdAt: -1,
    });

    if (latestMessage && activeMembers.length === 2) {
      const states = await ConversationReadState.find({
        conversationId,
        userId: { $in: activeMembers.map((m) => m.userId) },
      });

      const allCleared =
        states.length === activeMembers.length &&
        states.every((s) => s.clearedAt && s.clearedAt >= latestMessage.createdAt);

      if (allCleared) {
        await Message.deleteMany({ conversationId });
        await ConversationReadState.deleteMany({ conversationId });
        await Conversation.deleteOne({ _id: conversationId });
        conversationDeleted = true;
      }
    }
  }

  // Safe regardless of whether the conversation cascade-deleted: this only
  // unlinks a file once no Message anywhere still references it.
  await handleImageFileCleanup(candidateImageFiles);

  return { conversationDeleted };
};

/////////////////////////////////////////////
// Conversation list
/////////////////////////////////////////////

export const listConversations = async (userId) => {
  const conversations = await Conversation.find({ "members.userId": userId }).sort({
    lastMessageAt: -1,
  });
  const active = conversations.filter((c) => c.isActiveMember(userId));

  return Promise.all(
    active.map(async (c) => {
      const state = await getOrCreateReadState(c._id, userId);
      let name = c.name;
      let avatar = c.avatar;
      let partnerId = null;

      if (c.type === "direct") {
        const other = c.members.find((m) => m.userId.toString() !== userId.toString());
        const partner = other ? await User.findById(other.userId).select(
          "nickname username profileImage uniqueId"
        ) : null;
        name = partner?.nickname || partner?.username || null;
        avatar = partner?.profileImage || null;
        partnerId = other ? other.userId : null;
      }

      return {
        conversationId: c._id,
        type: c.type,
        name,
        avatar,
        partnerId,
        memberCount: c.members.filter((m) => !m.leftAt).length,
        lastMessageAt: c.lastMessageAt,
        unreadCount: state.unreadCount,
      };
    })
  );
};

// Full detail for one conversation, with member profiles resolved -- used
// by clients to render group member lists and direct-chat headers.
export const getConversationDetail = async (conversationId, userId) => {
  const conversation = await Conversation.findById(conversationId).populate(
    "members.userId",
    "nickname username profileImage uniqueId"
  );
  if (!conversation) throw new Error("Conversation not found");

  const isActive = conversation.members.some(
    (m) => m.userId._id.toString() === userId.toString() && !m.leftAt
  );
  if (!isActive) throw new Error("Not a member of this conversation");

  let name = conversation.name;
  let avatar = conversation.avatar;
  let partnerId = null;

  const activeMembers = conversation.members.filter((m) => !m.leftAt && m.userId);

  if (conversation.type === "direct") {
    const other = activeMembers.find(
      (m) => m.userId._id.toString() !== userId.toString()
    );
    name = other?.userId.nickname || other?.userId.username || null;
    avatar = other?.userId.profileImage || null;
    partnerId = other ? other.userId._id : null;
  }

  return {
    conversationId: conversation._id,
    type: conversation.type,
    name,
    avatar,
    partnerId,
    createdBy: conversation.createdBy,
    lastMessageAt: conversation.lastMessageAt,
    members: activeMembers.map((m) => ({
      userId: m.userId._id,
      role: m.role,
      joinedAt: m.joinedAt,
      nickname: m.userId.nickname || m.userId.username || null,
      profileImage: m.userId.profileImage || null,
      uniqueId: m.userId.uniqueId || null,
    })),
  };
};

/////////////////////////////////////////////
// Group management
/////////////////////////////////////////////

export const createGroup = async ({ creatorId, name, memberIds = [] }) => {
  const creator = await User.findById(creatorId);
  if (!creator) throw new Error("User not found");

  const uniqueMemberIds = [...new Set(memberIds.map((id) => id.toString()))].filter(
    (id) => id !== creatorId.toString()
  );

  for (const id of uniqueMemberIds) {
    if (!areFriends(creator, id)) {
      throw new Error("You can only add your own friends to a group");
    }
  }

  const conversation = await Conversation.create({
    type: "group",
    name,
    members: [
      { userId: creatorId, role: "owner" },
      ...uniqueMemberIds.map((id) => ({ userId: id, role: "member" })),
    ],
    createdBy: creatorId,
    lastMessageAt: new Date(),
  });

  return conversation;
};

export const addMembers = async ({ conversationId, actorId, memberIds }) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  if (conversation.type !== "group") throw new Error("Not a group conversation");
  if (!conversation.isActiveMember(actorId)) {
    throw new Error("Not a member of this conversation");
  }

  const actor = await User.findById(actorId);

  for (const rawId of memberIds) {
    const id = rawId.toString();
    if (id === actorId.toString()) continue;
    if (!areFriends(actor, id)) {
      throw new Error("You can only add your own friends to a group");
    }

    const existing = conversation.members.find((m) => m.userId.toString() === id);
    if (existing) {
      if (existing.leftAt) {
        existing.leftAt = null;
        existing.joinedAt = new Date();
      }
    } else {
      conversation.members.push({ userId: id, role: "member" });
    }
  }

  await conversation.save();
  return conversation;
};

export const removeMember = async ({ conversationId, actorId, targetUserId }) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  if (conversation.type !== "group") throw new Error("Not a group conversation");

  const isSelf = actorId.toString() === targetUserId.toString();
  if (!isSelf) {
    const actorRole = conversation.getMemberRole(actorId);
    if (actorRole !== "owner") {
      throw new Error("Only the owner can remove other members");
    }
  }

  const target = conversation.members.find(
    (m) => m.userId.toString() === targetUserId.toString() && !m.leftAt
  );
  if (!target) throw new Error("Member not found in this conversation");

  const wasOwner = target.role === "owner";
  target.leftAt = new Date();

  const remainingActive = conversation.members.filter(
    (m) => !m.leftAt && m.userId.toString() !== targetUserId.toString()
  );

  // Owner succession: promote the longest-tenured remaining member so a
  // group never silently ends up with nobody able to rename it / remove
  // members.
  if (wasOwner && remainingActive.length > 0) {
    const byJoinedAt = (a, b) => new Date(a.joinedAt) - new Date(b.joinedAt);
    const successor = [...remainingActive].sort(byJoinedAt)[0];
    successor.role = "owner";
  }

  await conversation.save();
  await ConversationReadState.deleteOne({ conversationId, userId: targetUserId });

  // Dissolve the group once nobody is left in it -- mirrors the direct-chat
  // cascade-delete in clearHistoryUpTo, just triggered by emptiness here
  // instead of both sides clearing history.
  let conversationDeleted = false;
  if (remainingActive.length === 0) {
    const messages = await Message.find({ conversationId });
    const candidateImageFiles = messages.flatMap((m) => m.imageFiles);

    console.log(
      `Group conversation ${conversationId} has no members left -- deleting conversation, ${messages.length} message(s), and read-state rows.`
    );

    await Message.deleteMany({ conversationId });
    await ConversationReadState.deleteMany({ conversationId });
    await Conversation.deleteOne({ _id: conversationId });
    conversationDeleted = true;

    await handleImageFileCleanup(candidateImageFiles);
  }

  return { conversation, conversationDeleted };
};

export const renameGroup = async ({ conversationId, actorId, name, avatar }) => {
  const conversation = await Conversation.findById(conversationId);
  if (!conversation) throw new Error("Conversation not found");
  if (conversation.type !== "group") throw new Error("Not a group conversation");

  const role = conversation.getMemberRole(actorId);
  if (role !== "owner") {
    throw new Error("Only the owner can update this group");
  }

  if (name !== undefined) conversation.name = name;
  if (avatar !== undefined) conversation.avatar = avatar;
  await conversation.save();

  return conversation;
};
