import { getMessaging } from "firebase-admin/messaging";
import firebaseApp from "../firebase/firebaseAdmin.js";
import User from "../models/user.model.js";
import { getTotalUnread } from "./conversationService.js";

export const notificationService = async (recipientId, data) => {
  // Firebase is only left uninitialised under NODE_ENV=test
  if (!firebaseApp) return false;

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

    // Same total the app sets after marking a chat read
    const totalUnread = await getTotalUnread(recipientId);

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

    const response = await getMessaging().sendEachForMulticast(message);

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
          { $pull: { fcmTokens: { token: { $in: failedTokens } } } },
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
