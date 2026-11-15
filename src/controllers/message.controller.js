import Message from "../models/message.model.js";
import { clearHistoryUpTo } from "../services/conversationService.js";
import { sendError } from "../utility/httpError.js";

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

    await clearHistoryUpTo({
      conversationId: message.conversationId,
      userId,
      messageId,
    });

    res.status(200).json({ message: "Messages deleted successfully" });
  } catch (error) {
    sendError(res, error, "deleteMessages controller");
  }
};
