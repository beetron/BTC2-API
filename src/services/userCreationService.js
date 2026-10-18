import bcrypt from "bcryptjs";
import User from "../models/user.model.js";

/////////////////////////////////////////////
// Create an account that starts out friends with one existing user.
// Shared by signup (the friend is whoever invited them) and admin create
// (the friend is the admin), so both build accounts the same way.
//
// Callers validate the fields first. uniqueId and nickname are optional
// and fall back to the username through the schema defaults. Throws if
// the friend doesn't exist; the new account is removed again in that case,
// so a one-way friendship is never left behind.
/////////////////////////////////////////////
export const createUserWithFriend = async ({
  username,
  email,
  password,
  friendId,
  uniqueId,
  nickname,
}) => {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);

  const user = new User({
    username,
    password: hashedPassword,
    email,
    profileImage: "",
    friendList: [friendId],
    ...(uniqueId ? { uniqueId } : {}),
    ...(nickname ? { nickname } : {}),
  });
  await user.save();

  try {
    // $addToSet so a repeated request can't list the same friend twice
    const result = await User.updateOne(
      { _id: friendId },
      { $addToSet: { friendList: user._id } }
    );
    if (result.matchedCount === 0) {
      throw new Error("Friend account not found");
    }
  } catch (error) {
    await User.deleteOne({ _id: user._id });
    throw error;
  }

  return user;
};
