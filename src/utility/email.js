import User from "../models/user.model.js";

// Email addresses are matched without regard to case. New and changed
// addresses are stored lowercased; accounts created before that keep the
// case they were typed with, so lookups fall back to a case-insensitive
// match for them.
export const normalizeEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The user with this email (plus any extra conditions), or null. The exact
// match uses the email index; the fallback only runs when that misses.
export const findUserByEmail = async (email, extra = {}) => {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  return (
    (await User.findOne({ ...extra, email: normalized })) ??
    (await User.findOne({
      ...extra,
      email: { $regex: `^${escapeRegex(normalized)}$`, $options: "i" },
    }))
  );
};
