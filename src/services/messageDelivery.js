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

// Tells every member's open clients that a message was created, edited or
// deleted. All three use the conversation:message event that every client
// build already refetches on, so clients that do not know about edits or
// deletes still show them (deleted messages drop out of their refetched
// page). Newer clients read `action` and can update just that message.
// Only ids go over the socket, never message content.
//
// action: "created" | "edited" | "deleted". Only the sender can do any of
// the three, so the sender's sockets are the ones skipped.
const broadcastMessageEvent = (req, conversationId, message, action) => {
  const id = conversationId.toString();
  io.to(id)
    .except(senderSocketsToSkip(req, message.senderId))
    .emit("conversation:message", {
      conversationId: id,
      messageId: message._id,
      senderId: message.senderId,
      clientMessageId: message.clientMessageId ?? null,
      action,
    });
};

export const broadcastNewMessage = (req, conversationId, message) =>
  broadcastMessageEvent(req, conversationId, message, "created");

export const broadcastEditedMessage = (req, conversationId, message) =>
  broadcastMessageEvent(req, conversationId, message, "edited");

export const broadcastDeletedMessage = (req, conversationId, message) =>
  broadcastMessageEvent(req, conversationId, message, "deleted");

// Sends one push notification. Replaceable only so tests can record which
// actions push and which do not (see setPushSenderForTests).
let sendPush = notificationService;

export const setPushSenderForTests = (sender) => {
  sendPush = sender || notificationService;
};

// Push notifications for members with no socket connected. Only for NEW
// messages (text or images): editing or deleting a message must never send
// a push. Called after the HTTP response is sent and never awaited, so the
// sender is not kept waiting on Firebase once per offline member.
// notificationService catches its own errors; allSettled is a second net
// so a failure here can never become an unhandled rejection.
export const notifyOfflineRecipients = (recipients, notification) => {
  const offline = recipients.filter(
    (m) => getReceiverSocketIds(m.userId.toString()).length === 0
  );
  if (offline.length === 0) return;

  Promise.allSettled(
    offline.map((m) => sendPush(m.userId, notification))
  ).then((results) => {
    results.forEach((result) => {
      if (result.status === "rejected") {
        console.log("Push notification failed: ", result.reason?.message);
      }
    });
  });
};
