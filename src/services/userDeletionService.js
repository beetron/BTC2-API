import fs from "fs";
import path from "path";
import User from "../models/user.model.js";
import UserConversation from "../models/userConversation.model.js";
import Message from "../models/message.model.js";
import Conversation from "../models/conversation.model.js";
import ConversationReadState from "../models/conversationReadState.model.js";
import { removeMember } from "./conversationService.js";
import { revokeUserSessions } from "./sessionService.js";
import { handleImageFileCleanup } from "../utility/imageCleanup.js";
import { io } from "../socket/socket.js";

const uploadsDir = path.join(process.cwd(), "src", "uploads", "images");

/////////////////////////////////////////////
// Permanently delete an account and the data that is wholly its own.
// Shared by self-delete (DELETE /auth/deleteAccount/:userId) and admin
// delete, so the two can never drift apart.
//
// - Direct conversations are deleted outright, both sides.
// - Groups: the account leaves (owner succession / empty-group dissolve
//   follow the normal leave rules), but messages it sent stay unless the
//   caller purged them first.
// Returns false if the user doesn't exist.
/////////////////////////////////////////////
export const deleteUserAccount = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return false;

  // Sign the account out everywhere first, so no device can keep writing
  // while its data is being removed.
  await revokeUserSessions(user._id);

  // Remove userId from friendList, friendRequests, and blockedUsers
  await User.updateMany(
    {
      $or: [
        { friendList: user._id },
        { friendRequests: user._id },
        { blockedUsers: user._id },
      ],
    },
    {
      $pull: {
        friendList: user._id,
        friendRequests: user._id,
        blockedUsers: user._id,
      },
    }
  );

  // Direct conversations are wholly the account's own history -- delete
  // them outright.
  const directConversations = await Conversation.find({
    type: "direct",
    "members.userId": user._id,
  }).select("_id");
  const directConversationIds = directConversations.map((c) => c._id);

  const directMessages = await Message.find({
    conversationId: { $in: directConversationIds },
  }).select("imageFiles");
  const imageFilesToCheck = directMessages.flatMap((m) => m.imageFiles || []);

  await Message.deleteMany({ conversationId: { $in: directConversationIds } });
  await ConversationReadState.deleteMany({
    conversationId: { $in: directConversationIds },
  });
  await Conversation.deleteMany({ _id: { $in: directConversationIds } });

  // Group conversations: leave through the normal rules, so an owner hands
  // the group to the longest-tenured member and an emptied group is
  // dissolved, exactly as if they had tapped "leave".
  const groupConversations = await Conversation.find({
    type: "group",
    "members.userId": user._id,
  });
  for (const group of groupConversations) {
    if (!group.isActiveMember(user._id)) continue;
    const conversationId = group._id.toString();
    const { conversationDeleted } = await removeMember({
      conversationId,
      actorId: user._id,
      targetUserId: user._id,
    });
    if (!conversationDeleted) {
      io.to(conversationId).emit("conversation:memberRemoved", {
        conversationId,
        userId: user._id.toString(),
      });
    }
  }

  // Drop the member entries entirely: once the User document is gone a
  // populated entry would resolve to null and break member lookups.
  await Conversation.updateMany(
    { type: "group", "members.userId": user._id },
    { $pull: { members: { userId: user._id } } }
  );
  await ConversationReadState.deleteMany({ userId: user._id });

  // Legacy cleanup for any pair not yet migrated to the new model.
  const legacyMessages = await Message.find({
    $or: [{ senderId: user._id }, { receiverId: user._id }],
    conversationId: null,
  }).select("imageFiles");
  imageFilesToCheck.push(...legacyMessages.flatMap((m) => m.imageFiles || []));
  await Message.deleteMany({
    $or: [{ senderId: user._id }, { receiverId: user._id }],
    conversationId: null,
  });
  await UserConversation.deleteMany({
    $or: [{ senderId: user._id }, { receiverId: user._id }],
  });

  // Cleanup unreferenced image files
  await handleImageFileCleanup(imageFilesToCheck);

  if (user.profileImage) {
    try {
      await fs.promises.unlink(path.join(uploadsDir, path.basename(user.profileImage)));
    } catch (error) {
      console.log("Error removing profile image of deleted user: ", error.message);
    }
  }

  await User.findByIdAndDelete(user._id);

  return true;
};
