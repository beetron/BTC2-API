import Message from "../models/message.model.js";
import { clearHistoryUpTo } from "../services/conversationService.js";
import { sendError } from "../utility/httpError.js";
import { io } from "../socket/socket.js";

/////////////////////////////////////////////
// Clear the caller's own view of a conversation up to a message. Used by
// both clients; only affects the caller. (Deleting a single message for
// everyone is DELETE /conversations/:id/messages/:messageId.)
/////////////////////////////////////////////
export const deleteMessages = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId).select("conversationId").lean();
    if (!message || !message.conversationId) {
      return res.status(404).json({ error: "Message not found" });
    }

    const { conversationDeleted } = await clearHistoryUpTo({
      conversationId: message.conversationId,
      userId,
      messageId,
    });

    // Both sides of a direct chat have now cleared everything, so the
    // conversation itself is gone. Anyone who still has it open must move
    // to a new one (POST /conversations/direct) or every send would 404.
    if (conversationDeleted) {
      io.to(message.conversationId.toString()).emit("conversation:deleted", {
        conversationId: message.conversationId.toString(),
      });
    }

    res.status(200).json({ message: "Messages deleted successfully", conversationDeleted });
  } catch (error) {
    sendError(res, error, "deleteMessages controller");
  }
};
