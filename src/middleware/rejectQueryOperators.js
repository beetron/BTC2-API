// Rejects JSON bodies that contain MongoDB query operators as keys
// (anything starting with "$", at any depth).
//
// Controllers pass body fields straight into queries, e.g.
// User.findOne({ uniqueId }). If a client sends { "uniqueId": { "$ne": "x" } }
// instead of a string, that becomes a query matching any user, which let
// signup skip the invite check and let forgotpassword reset a password
// without knowing the account's email. No legitimate client sends "$" keys,
// so the whole request is refused. (Query strings are not affected: Express
// 5's default parser never produces nested objects.)

const MAX_DEPTH = 20;

const hasOperatorKey = (value, depth = 0) => {
  if (depth > MAX_DEPTH) return true;
  if (Array.isArray(value)) {
    return value.some((item) => hasOperatorKey(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.keys(value).some(
      (key) => key.startsWith("$") || hasOperatorKey(value[key], depth + 1)
    );
  }
  return false;
};

const rejectQueryOperators = (req, res, next) => {
  if (hasOperatorKey(req.body)) {
    return res.status(400).json({ error: "Invalid request" });
  }
  next();
};

export default rejectQueryOperators;
