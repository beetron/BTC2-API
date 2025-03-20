import admin from "../firebase/firebaseAdmin.js";
import User from "../models/user.model.js";

export const notificationService = async (recipientId, data) => {
  try {
    const recipient = await User.findById(recipientId);
    if (
      !recipient ||
      !recipient.fcmTokens ||
      recipient.fcmTokens.length === 0
    ) {
      console.log("No FCM tokens found for user ${recipientId}");
      return false;
    }

    const tokens = recipient.fcmTokens.map((t) => t.token);

    const message = {
      tokens: tokens,
      notification: {
        title: data.title || "New Update",
        body: data.body || "You have a new message",
      },
      data: data.payload || {},
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: 1,
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
