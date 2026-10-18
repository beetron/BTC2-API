// There is exactly one admin, identified by ADMIN_USER_ID (the account's
// Mongo _id, set as a deployment secret). No database field can grant admin,
// so no user-facing endpoint can be tricked into granting it either.
// Leaving the variable unset turns every admin endpoint off.
export const isAdminUser = (user) => {
  const adminUserId = process.env.ADMIN_USER_ID?.trim();
  return Boolean(adminUserId && user?._id && user._id.toString() === adminUserId);
};

// Runs after protectRoute. Non-admins get a plain 404 so the admin surface
// isn't advertised, and so the web client (which logs out on 401/403)
// doesn't sign anyone out for probing it.
const requireAdmin = (req, res, next) => {
  if (!isAdminUser(req.user)) {
    return res.status(404).json({ error: "Not found" });
  }
  next();
};

export default requireAdmin;
