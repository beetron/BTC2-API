import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import RefreshToken from "../models/refreshToken.model.js";
import { isAdminUser } from "../middleware/requireAdmin.js";
import { endAllSessions, revokeUserSessions } from "../services/sessionService.js";
import {
  purgeMessagesSentBy,
  notifyConversationsChanged,
} from "../services/messagePurgeService.js";
import { deleteUserAccount } from "../services/userDeletionService.js";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_QUERY_LENGTH = 100;

const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Fields the admin UI is allowed to see. Never the password hash, FCM
// tokens, or social graph arrays.
const USER_SUMMARY_FIELDS = "username uniqueId nickname email profileImage createdAt";

const toSummary = (user) => ({
  _id: user._id,
  username: user.username,
  uniqueId: user.uniqueId,
  nickname: user.nickname,
  email: user.email,
  profileImage: user.profileImage,
  createdAt: user.createdAt,
  isAdmin: isAdminUser(user),
});

const findTargetUser = async (req, res, select) => {
  const { id } = req.params;
  if (!OBJECT_ID_PATTERN.test(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return null;
  }
  const query = User.findById(id);
  if (select) query.select(select);
  const user = await query;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return null;
  }
  return user;
};

/////////////////////////////////////////////
// List / search users, alphabetical by username, cursor paginated.
// q is a prefix match on username, uniqueId or email. Anchored,
// case-sensitive prefixes let Mongo use the existing unique indexes.
/////////////////////////////////////////////
export const listUsers = async (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const cursor = typeof req.query.cursor === "string" ? req.query.cursor : "";
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE
    );

    if (q.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: "Search is too long" });
    }

    const filter = {};
    if (q) {
      const prefixes = [...new Set([q, q.toLowerCase()])].map(
        (v) => new RegExp(`^${escapeRegex(v)}`)
      );
      filter.$or = [
        { username: { $in: prefixes } },
        { uniqueId: { $in: prefixes } },
        { email: { $in: prefixes } },
      ];
    }
    if (cursor) {
      filter.username = { $gt: cursor };
    }

    const rows = await User.find(filter)
      .select(USER_SUMMARY_FIELDS)
      .sort({ username: 1 })
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const users = hasMore ? rows.slice(0, limit) : rows;

    res.status(200).json({
      users: users.map(toSummary),
      nextCursor: hasMore ? users[users.length - 1].username : null,
    });
  } catch (error) {
    console.log("Error in admin listUsers controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// One user, with the counts the manage page shows before any action
/////////////////////////////////////////////
export const getUser = async (req, res) => {
  try {
    const user = await findTargetUser(
      req,
      res,
      `${USER_SUMMARY_FIELDS} friendList fcmTokens updatedAt`
    );
    if (!user) return;

    const [messagesSent, groupCount, activeSessions] = await Promise.all([
      Message.countDocuments({ senderId: user._id }),
      Conversation.countDocuments({
        type: "group",
        members: { $elemMatch: { userId: user._id, leftAt: null } },
      }),
      RefreshToken.countDocuments({ userId: user._id, expiresAt: { $gt: new Date() } }),
    ]);

    res.status(200).json({
      ...toSummary(user),
      updatedAt: user.updatedAt,
      friendCount: user.friendList.length,
      deviceCount: user.fcmTokens.length,
      messagesSent,
      groupCount,
      activeSessions,
    });
  } catch (error) {
    console.log("Error in admin getUser controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Edit username / email / uniqueId / password. All or nothing: every field
// is validated before anything is written. Any change signs the user out
// on every device, because the iOS app caches the profile from login and
// would otherwise keep showing (and using) the old values.
/////////////////////////////////////////////
export const updateUser = async (req, res) => {
  try {
    const user = await findTargetUser(req, res);
    if (!user) return;

    const { username, email, uniqueId, password } = req.body || {};
    const changes = {};

    if (username !== undefined) {
      if (typeof username !== "string") {
        return res.status(400).json({ error: "Username must be text" });
      }
      const value = username.trim().toLowerCase();
      if (value.length < 6 || value.length > 20) {
        return res.status(400).json({ error: "Username must be 6 to 20 characters" });
      }
      if (value !== user.username) changes.username = value;
    }

    if (uniqueId !== undefined) {
      if (typeof uniqueId !== "string") {
        return res.status(400).json({ error: "Unique ID must be text" });
      }
      const value = uniqueId.trim();
      if (value.length < 6 || value.length > 20) {
        return res.status(400).json({ error: "Unique ID must be 6 to 20 characters" });
      }
      if (value !== user.uniqueId) changes.uniqueId = value;
    }

    if (email !== undefined) {
      if (typeof email !== "string") {
        return res.status(400).json({ error: "Email must be text" });
      }
      const value = email.trim();
      if (value.length > 254 || !EMAIL_PATTERN.test(value)) {
        return res.status(400).json({ error: "Email address is invalid" });
      }
      if (value !== user.email) changes.email = value;
    }

    if (password !== undefined) {
      if (typeof password !== "string") {
        return res.status(400).json({ error: "Password must be text" });
      }
      // bcrypt silently ignores anything past 72 bytes
      if (password.length < 6 || Buffer.byteLength(password, "utf8") > 72) {
        return res.status(400).json({ error: "Password must be 6 to 72 characters" });
      }
      changes.password = password;
    }

    if (Object.keys(changes).length === 0) {
      return res.status(400).json({ error: "No changes to save" });
    }

    const othersFilter = { _id: { $ne: user._id } };
    const [usernameTaken, uniqueIdTaken, emailTaken] = await Promise.all([
      changes.username ? User.exists({ ...othersFilter, username: changes.username }) : null,
      changes.uniqueId ? User.exists({ ...othersFilter, uniqueId: changes.uniqueId }) : null,
      changes.email ? User.exists({ ...othersFilter, email: changes.email }) : null,
    ]);
    if (usernameTaken) return res.status(409).json({ error: "Username is taken" });
    if (uniqueIdTaken) return res.status(409).json({ error: "Unique ID is taken" });
    if (emailTaken) return res.status(409).json({ error: "Email address is already in use" });

    if (changes.username) user.username = changes.username;
    if (changes.uniqueId) user.uniqueId = changes.uniqueId;
    if (changes.email) user.email = changes.email;
    if (changes.password) {
      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(changes.password, salt);
    }
    user.sessionsRevokedAt = new Date();

    try {
      await user.save();
    } catch (error) {
      // Lost a race with another write claiming the same value
      if (error.code === 11000) {
        return res.status(409).json({ error: "That value was just taken, try another" });
      }
      if (error.name === "ValidationError") {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    await endAllSessions(user._id);

    console.log(
      `Admin ${req.user.username} updated user ${user._id}: ${Object.keys(changes).join(", ")}`
    );

    res.status(200).json({
      user: toSummary(user),
      changed: Object.keys(changes),
    });
  } catch (error) {
    console.log("Error in admin updateUser controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Delete every message this user sent (direct + group). The account and
// everyone else's messages stay.
/////////////////////////////////////////////
export const deleteUserMessages = async (req, res) => {
  try {
    const user = await findTargetUser(req, res, "_id username");
    if (!user) return;

    const { deletedCount, conversationIds } = await purgeMessagesSentBy(user._id);

    console.log(
      `Admin ${req.user.username} deleted ${deletedCount} message(s) sent by user ${user._id}`
    );

    res.status(200).json({ deletedCount, conversationCount: conversationIds.length });
  } catch (error) {
    console.log("Error in admin deleteUserMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Permanently delete a user: everything they sent, their direct chats
// (both sides), their group memberships, and the account itself.
/////////////////////////////////////////////
export const deleteUser = async (req, res) => {
  try {
    const user = await findTargetUser(req, res, "_id username");
    if (!user) return;

    if (user._id.equals(req.user._id)) {
      return res.status(400).json({ error: "You can't delete your own account here" });
    }

    // Sign them out before purging, so nothing new is sent mid-delete
    await revokeUserSessions(user._id);
    const { deletedCount, conversationIds } = await purgeMessagesSentBy(user._id, {
      notify: false,
    });
    await deleteUserAccount(user._id);

    // Direct chats are gone now; only groups that still exist need their
    // members' clients to refetch
    const survivingGroups = await Conversation.find({
      _id: { $in: conversationIds },
      type: "group",
    }).select("_id");
    notifyConversationsChanged(survivingGroups.map((c) => c._id));

    console.log(`Admin ${req.user.username} deleted user ${user._id} (${user.username})`);

    res.status(200).json({ message: "User deleted", deletedMessages: deletedCount });
  } catch (error) {
    console.log("Error in admin deleteUser controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
