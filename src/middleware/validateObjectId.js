// Rejects route params that are not 24-character hex ObjectIds before they
// reach a query. Without this, a malformed id makes Mongoose throw a
// CastError deep inside a service instead of a clear 400.
//
// mongoose.isValidObjectId() is not used: it also accepts any 12-character
// string, which is not an id any client would send.
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

export const isObjectIdString = (value) =>
  typeof value === "string" && OBJECT_ID.test(value);

const validateObjectId =
  (...paramNames) =>
  (req, res, next) => {
    for (const name of paramNames) {
      if (!isObjectIdString(req.params[name])) {
        return res.status(400).json({ error: `Invalid ${name}` });
      }
    }
    next();
  };

export default validateObjectId;
