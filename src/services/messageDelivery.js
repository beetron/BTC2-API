import { getReceiverSocketIds, io } from "../socket/socket.js";
import { notificationService } from "./notificationService.js";

// Which of the sender's sockets should NOT get the conversation:message
// event for their own message.
//
// A client may send its socket id in the X-Socket-Id header. Then only that
// socket is skipped, so the sender's other devices (an open web tab while
// sending from the phone) also see the message. Without the header every
// one of the sender's sockets is skipped, which is how the API has always
// behaved: current mobile builds refetch on this event and would briefly
// drop their just-sent message if they got it for their own send.
const senderSocketsToSkip = (req, senderId) => {
  const senderSocketIds = getReceiverSocketIds(senderId.toString());
  const sendingSocketId = req.get("X-Socket-Id");
  if (sendingSocketId && senderSocketIds.includes(sendingSocketId)) {
    return [sendingSocketId];
  }
  return senderSocketIds;
};

// Tells every member's open clients that a message arrived. Clients only
// get ids and refetch, so no message content goes over the socket.
export const broadcastNewMessage = (req, conversationId, message) => {
  const id = conversationId.toString();
  io.to(id)
    .except(senderSocketsToSkip(req, message.senderId))
    .emit("conversation:message", {
      conversationId: id,
      messageId: message._id,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId ?? null,
    });
};

// Push notifications for members with no socket connected. Called after
// the HTTP response is sent and never awaited, so the sender is not kept
// waiting on Firebase once per offline member. notificationService
// catches its own errors; allSettled is a second net so a failure here can
// never become an unhandled rejection.
export const notifyOfflineRecipients = (recipients, notification) => {
  const offline = recipients.filter(
    (m) => getReceiverSocketIds(m.userId.toString()).length === 0
  );
  if (offline.length === 0) return;

  Promise.allSettled(
    offline.map((m) => notificationService(m.userId, notification))
  ).then((results) => {
    results.forEach((result) => {
      if (result.status === "rejected") {
        console.log("Push notification failed: ", result.reason?.message);
      }
    });
  });
};
