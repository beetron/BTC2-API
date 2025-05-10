import admin from "../firebase/firebaseAdmin.js";
import User from "../models/user.model.js";
import UserConversation from "../models/userConversation.model.js";
import { ObjectId } from "mongodb";

export const notificationService = async (recipientId, data) => {
  try {
    const recipient = await User.findById(recipientId);
    if (
      !recipient ||
      !recipient.fcmTokens ||
      recipient.fcmTokens.length === 0
    ) {
      console.log(`No FCM tokens found for user ${recipientId}`);
      return;
    }

    const tokens = recipient.fcmTokens.map((t) => t.token);

    // Convert recipientId to mongo ObjectId
    const ownerObjectId = new ObjectId(`${recipientId}`);

    // aggregate unreadCount across *recipient* conversations
    const [{ totalUnread = 0 } = {}] = await UserConversation.aggregate([
      {
        $match: { senderId: ownerObjectId },
      },
      {
        $group: {
          _id: null,
          totalUnread: { $sum: "$unreadCount" },
        },
      },
    ]);

    const message = {
      tokens: tokens,
      notification: {
        title: data.title || "New Update",
        // body: data.body || "You have a new message",
        body: "",
      },
      data: data.payload || {},
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: totalUnread,
          },
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // Handle failed tokens
    if (response.failureCount > 0) {
      const failedTokens = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(tokens[idx]);
        }
      });

      // Remove tokens from database
      if (failedTokens.length > 0) {
        await User.updateOne(
          {
            _id: recipientId,
          },
          { $pull: { fcmTokens: { token: { $in: failedTokens } } } }
        );
      }
    }
    return response.successCount > 0;
  } catch (error) {
    console.error("Error sending notification: ", error);
    return false;
  }
};

export default notificationService;
