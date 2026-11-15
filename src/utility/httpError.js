// An error whose message is safe to show to the client, with the HTTP status
// to send it with. Anything else thrown inside a controller is treated as
// unexpected: it is logged and the client gets a generic message, so
// internal details (Mongoose cast errors, driver messages) never leak.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Unexpected failures are answered with 400, not 500: btc2-web's API client
// signs the user out on any 401, 403 or 500 response, so a database hiccup
// must not end someone's session. Switch this to 500 once the web client
// only signs out on 401.
const UNEXPECTED_ERROR_STATUS = 400;

export const sendError = (res, error, context) => {
  // Work done after the response (socket events, push notifications) can
  // still fail; there is nothing left to answer, so only log it
  if (res.headersSent) {
    console.log(`Error in ${context} after response: `, error.message);
    return;
  }
  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message });
  }
  console.log(`Error in ${context}: `, error.message);
  return res.status(UNEXPECTED_ERROR_STATUS).json({ error: "Request failed" });
};
