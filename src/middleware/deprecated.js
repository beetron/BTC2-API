// Marks a route as deprecated (RFC 9745 Deprecation header) and logs every
// call, so the logs show whether anything still uses it before it is
// removed. Runs after protectRoute, so the caller is known.
//
// The value is the date the routes were deprecated: 2026-11-15 00:00 UTC.
const DEPRECATED_SINCE = "@1794700800";

const deprecated = (req, res, next) => {
  res.set("Deprecation", DEPRECATED_SINCE);
  console.log(
    `Deprecated endpoint called: ${req.method} ${req.baseUrl}${req.route?.path} by user ${req.user?._id}`
  );
  next();
};

export default deprecated;
