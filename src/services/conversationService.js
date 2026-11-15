import Conversation from "../models/conversation.model.js";
import ConversationReadState from "../models/conversationReadState.model.js";
import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";
import { HttpError } from "../utility/httpError.js";
import { isObjectIdString } from "../middleware/validateObjectId.js";

// Neither client limits message length; this only stops a single message
// from being absurdly large (the JSON body limit alone allows ~100 KB).
export const MAX_MESSAGE_LENGTH = 10000;

// A UUID, or any similar client-generated token
const CLIENT_MESSAGE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const areFriends = (user, otherUserId) =>
  user.friendList.some((id) => id.toString() === otherUserId.toString());

// Loads just enough of a conversation to check membership, and throws the
// same errors every endpoint has always returned
const loadConversationForMember = async (conversationId, userId, fields = "members") => {
  const conversation = await Conversation.findById(conversationId).select(fields).lean();
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (!Conversation.hasActiveMember(conversation, userId)) {
    throw new HttpError(400, "Not a member of this conversation");
  }
  return conversation;
};

const encodeCursor = (msg) =>
  Buffer.from(`${msg.createdAt.toISOString()}|${msg._id.toString()}`).toString(
    "base64"
  );

const decodeCursor = (cursor) => {
  if (typeof cursor !== "string") throw new HttpError(400, "Invalid cursor");
  const [createdAtStr, id] = Buffer.from(cursor, "base64")
    .toString("utf-8")
    .split("|");
  const createdAt = new Date(createdAtStr);
  if (Number.isNaN(createdAt.getTime()) || !isObjectIdString(id)) {
    throw new HttpError(400, "Invalid cursor");
  }
  return { createdAt, id };
};

const isBlank = (value) => value === undefined || value === null || value === "";

const validateMessageInput = ({ message, imageFiles, clientMessageId }) => {
  if (!isBlank(message) && typeof message !== "string") {
    throw new HttpError(400, "message must be a string");
  }
  const hasText = typeof message === "string" && message.trim().length > 0;
  if (!hasText && imageFiles.length === 0) {
    throw new HttpError(400, "Message cannot be empty");
  }
  if (hasText && message.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(
      400,
      `Message must be ${MAX_MESSAGE_LENGTH} characters or less`
    );
  }
  if (
    !isBlank(clientMessageId) &&
    !(typeof clientMessageId === "string" && CLIENT_MESSAGE_ID.test(clientMessageId))
  ) {
    throw new HttpError(400, "Invalid clientMessageId");
  }
};

// The message this sender already stored under clientMessageId, if any. A
// clientMessageId reused for a different conversation is a client bug, not
// a retry, so it is refused rather than silently answered with the other
// conversation's message.
const findByClientMessageId = async (senderId, clientMessageId, conversationId) => {
  const existing = await Message.findOne({ senderId, clientMessageId }).lean();
  if (!existing) return null;
  if (existing.conversationId?.toString() !== conversationId.toString()) {
    throw new HttpError(409, "clientMessageId was already used for another message");
  }
  return existing;
};

/////////////////////////////////////////////
// Direct (1:1) conversations
/////////////////////////////////////////////

// True if either user has blocked the other
const isBlockedEitherWay = async (userIdA, userIdB) =>
  Boolean(
    await User.exists({
      $or: [
        { _id: userIdA, blockedUsers: userIdB },
        { _id: userIdB, blockedUsers: userIdA },
      ],
    })
  );

export const findOrCreateDirectConversation = async (userIdA, userIdB) => {
  // Blocking deletes the direct conversation; without this check either
  // side could simply recreate it (POST /conversations/direct or the legacy
  // /messages/send and /messages/upload endpoints) and keep messaging.
  if (await isBlockedEitherWay(userIdA, userIdB)) {
    throw new HttpError(400, "Cannot start a conversation with this user");
  }

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

// Returns { message, conversation, recipients, duplicate }. duplicate is true
// when clientMessageId matched a message this sender already stored: that
// message is returned as is, and nothing is written or should be notified.
export const postMessage = async ({
  conversationId,
  senderId,
  message,
  imageFiles = [],
  clientMessageId,
}) => {
  validateMessageInput({ message, imageFiles, clientMessageId });
  const clientId = isBlank(clientMessageId) ? undefined : clientMessageId;

  const conversation = await loadConversationForMember(
    conversationId,
    senderId,
    "type members"
  );

  if (clientId) {
    const existing = await findByClientMessageId(senderId, clientId, conversation._id);
    if (existing) {
      return { message: existing, conversation, recipients: [], duplicate: true };
    }
  }

  // receiverId only makes sense for a direct conversation
  let receiverId = null;
  if (conversation.type === "direct") {
    const other = conversation.members.find(
      (m) => m.userId.toString() !== senderId.toString()
    );
    receiverId = other ? other.userId : null;
  }

  let newMessage;
  try {
    newMessage = await Message.create({
      senderId,
      receiverId,
      conversationId: conversation._id,
      message,
      imageFiles,
      clientMessageId: clientId,
    });
  } catch (error) {
    // Two copies of the same retry arrived at once and the other one won
    // the unique index: answer with the message it stored
    if (error.code === 11000 && clientId) {
      const existing = await findByClientMessageId(senderId, clientId, conversation._id);
      if (existing) {
        return { message: existing, conversation, recipients: [], duplicate: true };
      }
    }
    throw error;
  }

  const recipients = conversation.members.filter(
    (m) => !m.leftAt && m.userId.toString() !== senderId.toString()
  );

  // One round trip for every member's read state instead of a find and a
  // save per member. Upserts also remove the old find-then-create race,
  // where two messages arriving together could both try to create the
  // same read-state row and one would fail on the unique index.
  const readStateOps = recipients.map((m) => ({
    updateOne: {
      filter: { conversationId: conversation._id, userId: m.userId },
      update: { $inc: { unreadCount: 1 } },
      upsert: true,
    },
  }));
  // Sender's own view is implicitly caught up
  readStateOps.push({
    updateOne: {
      filter: { conversationId: conversation._id, userId: senderId },
      update: { $set: { lastReadMessageId: newMessage._id, unreadCount: 0 } },
      upsert: true,
    },
  });

  await Promise.all([
    Conversation.updateOne(
      { _id: conversation._id },
      { $set: { lastMessageAt: newMessage.createdAt } }
    ),
    ConversationReadState.bulkWrite(readStateOps, { ordered: false }),
  ]);

  return { message: newMessage, conversation, recipients, duplicate: false };
};

// Cursor-paginated history. Returns the most recent page first; pass the
// previous page's nextCursor to page further back in time.
export const getConversationMessages = async (
  conversationId,
  userId,
  { cursor, limit = 50 } = {}
) => {
  const [conversation, state] = await Promise.all([
    loadConversationForMember(conversationId, userId),
    ConversationReadState.findOne({ conversationId, userId })
      .select("clearedAt")
      .lean(),
  ]);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

  const query = { conversationId: conversation._id };
  if (state?.clearedAt) {
    query.createdAt = { $gt: state.clearedAt };
  }
  if (cursor) {
    const { createdAt, id } = decodeCursor(cursor);
    query.$and = [
      ...(query.$and || []),
      { $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }] },
    ];
  }

  // lean(): the page is only serialised to JSON, so skipping Mongoose
  // document hydration saves CPU and memory with an identical response
  const rows = await Message.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit + 1)
    .lean();

  const hasMore = rows.length > safeLimit;
  const messages = hasMore ? rows.slice(0, safeLimit) : rows;
  const nextCursor = hasMore ? encodeCursor(messages[messages.length - 1]) : null;

  // Mark read only on the freshest page (no cursor = just opened the thread)
  if (!cursor && messages.length > 0) {
    await ConversationReadState.updateOne(
      { conversationId: conversation._id, userId },
      { $set: { lastReadMessageId: messages[0]._id, unreadCount: 0 } },
      { upsert: true }
    );
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
  const message = await Message.findOne({ _id: messageId, conversationId })
    .select("createdAt")
    .lean();
  if (!message) throw new HttpError(404, "Message not found in this conversation");

  const conversation = await loadConversationForMember(
    conversationId,
    userId,
    "type members"
  );

  await ConversationReadState.updateOne(
    { conversationId, userId },
    { $set: { clearedAt: message.createdAt, unreadCount: 0 } },
    { upsert: true }
  );

  let conversationDeleted = false;

  if (conversation.type === "direct") {
    const activeMembers = conversation.members.filter((m) => !m.leftAt);
    const latestMessage = await Message.findOne({ conversationId })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();

    if (latestMessage && activeMembers.length === 2) {
      const states = await ConversationReadState.find({
        conversationId,
        userId: { $in: activeMembers.map((m) => m.userId) },
      })
        .select("clearedAt")
        .lean();

      const allCleared =
        states.length === activeMembers.length &&
        states.every((s) => s.clearedAt && s.clearedAt >= latestMessage.createdAt);

      if (allCleared) {
        // Image files can only become unreferenced when messages are
        // actually deleted, so they are only gathered here. Clearing one
        // user's view deletes nothing and leaves every file in use.
        const candidateImageFiles = await Message.distinct("imageFiles", {
          conversationId,
        });
        await Message.deleteMany({ conversationId });
        await ConversationReadState.deleteMany({ conversationId });
        await Conversation.deleteOne({ _id: conversationId });
        conversationDeleted = true;
        // Only unlinks a file once no Message anywhere still references it
        await handleImageFileCleanup(candidateImageFiles);
      }
    }
  }

  return { conversationDeleted };
};

/////////////////////////////////////////////
// Conversation list
/////////////////////////////////////////////

export const listConversations = async (userId) => {
  // Filtering on active membership in the query (instead of loading every
  // conversation the user was ever in and filtering in JS) plus lean()
  // keeps this cheap; it runs on every socket event in both clients.
  const active = await Conversation.find(Conversation.activeMemberFilter(userId))
    .sort({ lastMessageAt: -1 })
    .select("type name avatar members lastMessageAt")
    .lean();

  if (active.length === 0) return [];

  // Batch both per-conversation lookups below into one query each instead
  // of one (or two) queries per conversation. Any conversation without a
  // read state yet just reads as unreadCount 0; postMessage and
  // clearHistoryUpTo upsert the row the moment they need one.
  const partnerIds = active
    .filter((c) => c.type === "direct")
    .map((c) => c.members.find((m) => m.userId.toString() !== userId.toString())?.userId)
    .filter(Boolean);

  const [readStates, partners] = await Promise.all([
    ConversationReadState.find({
      conversationId: { $in: active.map((c) => c._id) },
      userId,
    })
      .select("conversationId unreadCount")
      .lean(),
    User.find({ _id: { $in: partnerIds } })
      .select("nickname username profileImage uniqueId")
      .lean(),
  ]);

  const unreadByConversationId = new Map(
    readStates.map((s) => [s.conversationId.toString(), s.unreadCount])
  );
  const partnerById = new Map(partners.map((p) => [p._id.toString(), p]));

  return active.map((c) => {
    let name = c.name;
    let avatar = c.avatar;
    let partnerId = null;

    if (c.type === "direct") {
      const other = c.members.find((m) => m.userId.toString() !== userId.toString());
      const partner = other ? partnerById.get(other.userId.toString()) : null;
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
      unreadCount: unreadByConversationId.get(c._id.toString()) || 0,
    };
  });
};

// Full detail for one conversation, with member profiles resolved -- used
// by clients to render group member lists and direct-chat headers.
export const getConversationDetail = async (conversationId, userId) => {
  const conversation = await Conversation.findById(conversationId).populate(
    "members.userId",
    "nickname username profileImage uniqueId"
  );
  if (!conversation) throw new HttpError(404, "Conversation not found");

  // m.userId is null when that member's account no longer exists
  const isActive = conversation.members.some(
    (m) => m.userId && m.userId._id.toString() === userId.toString() && !m.leftAt
  );
  if (!isActive) throw new HttpError(400, "Not a member of this conversation");

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
  if (!creator) throw new HttpError(404, "User not found");

  const uniqueMemberIds = [...new Set(memberIds.map((id) => id.toString()))].filter(
    (id) => id !== creatorId.toString()
  );

  for (const id of uniqueMemberIds) {
    if (!areFriends(creator, id)) {
      throw new HttpError(400, "You can only add your own friends to a group");
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
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (conversation.type !== "group") throw new HttpError(400, "Not a group conversation");
  if (!conversation.isActiveMember(actorId)) {
    throw new HttpError(400, "Not a member of this conversation");
  }

  const actor = await User.findById(actorId);

  for (const rawId of memberIds) {
    const id = rawId.toString();
    if (id === actorId.toString()) continue;
    if (!areFriends(actor, id)) {
      throw new HttpError(400, "You can only add your own friends to a group");
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
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (conversation.type !== "group") throw new HttpError(400, "Not a group conversation");

  const isSelf = actorId.toString() === targetUserId.toString();
  if (!isSelf) {
    const actorRole = conversation.getMemberRole(actorId);
    if (actorRole !== "owner") {
      throw new HttpError(400, "Only the owner can remove other members");
    }
  }

  const target = conversation.members.find(
    (m) => m.userId.toString() === targetUserId.toString() && !m.leftAt
  );
  if (!target) throw new HttpError(404, "Member not found in this conversation");

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
  if (!conversation) throw new HttpError(404, "Conversation not found");
  if (conversation.type !== "group") throw new HttpError(400, "Not a group conversation");

  const role = conversation.getMemberRole(actorId);
  if (role !== "owner") {
    throw new HttpError(400, "Only the owner can update this group");
  }

  if (name !== undefined) conversation.name = name;
  if (avatar !== undefined) conversation.avatar = avatar;
  await conversation.save();

  return conversation;
};
