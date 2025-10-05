import bcrypt from "bcryptjs";
import User from "../models/user.model.js";
import generateToken from "../utility/generateToken.js";
import { sendEmail } from "../utility/sendEmail.js";

/////////////////////////////////////////////
// Signup (signup assigns username as the default uniqueId)
/////////////////////////////////////////////
export const signup = async (req, res) => {
  try {
    const { username, password, email, uniqueId } = req.body;

    // Check if friend's uniqueId exists
    const friend = await User.findOne({ uniqueId });

    if (!friend) {
      return res.status(400).json({ error: "Friend's Unique ID incorrect" });
    }

    // Convert username to lowercase
    const usernameLowerCase = username.toLowerCase();

    // Check if username & unique ID is taken
    const user = await User.findOne({ username: usernameLowerCase });
    const newUniqueId = await User.findOne({ uniqueId: usernameLowerCase });

    if (user || newUniqueId) {
      return res.status(400).json({ error: "Username is taken" });
    }

    // Check if email address is not blank
    if (!email || email.trim() === "") {
      return res.status(400).json({ error: "Email address is required" });
    }

    // Check if email address is not in use
    const emailInUse = await User.findOne({ email });
    if (emailInUse) {
      return res.status(400).json({ error: "Email address is already in use" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // New user object with existing friend added to friendList
    const newUser = new User({
      username: usernameLowerCase,
      password: hashedPassword,
      email: email,
      profileImage: "",
      friendList: [friend._id],
    });

    if (newUser) {
      // Generate JWT token
      const token = generateToken(newUser._id);
      await newUser.save();

      // Update the friend's friendList with the new user's _id
      await User.findByIdAndUpdate(friend._id, {
        $push: { friendList: newUser._id },
      });

      res.status(201).json({
        _id: newUser._id,
        nickname: newUser.nickname,
        uniqueId: newUser.uniqueId,
        email: newUser.email,
        profileImage: newUser.profileImage,
        token,
      });
    }
  } catch (error) {
    console.log("Error during signup", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/////////////////////////////////////////////
// Login
/////////////////////////////////////////////
export const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    // Convert username to lowercase
    const usernameLowerCase = username.toLowerCase();

    // Search for username
    const user = await User.findOne({ username: usernameLowerCase });

    // Check password integrity
    const isPasswordCorrect = await bcrypt.compare(
      password,
      user?.password || ""
    );

    // Check credentials
    if (!user || !isPasswordCorrect) {
      return res.status(400).json({ error: "Invalid login information" });
    }

    // Generate token
    const token = generateToken(user._id);

    res.status(200).json({
      _id: user._id,
      uniqueId: user.uniqueId,
      nickname: user.nickname,
      profileImage: user.profileImage,
      token,
    });
  } catch (error) {
    console.log("Error during login", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

// Logout
export const logout = (req, res) => {
  try {
    res.cookie("jwt", "", { maxAge: 0 });
    res.status(200).json({ message: "You have logged out" });
  } catch (error) {
    console.log("Error logging out", error.message);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/////////////////////////////////////////////
// Forgot username
/////////////////////////////////////////////
export const forgotUsername = async (req, res) => {
  // Retrieve email from request body
  const { email } = req.body;

  try {
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "Email not found" });
    }

    // Send username to user's email
    await sendEmail({
      to: email,
      subject: "BTC2 - Username Recovery",
      text: `Your username is: ${user.username}\n\nIf you did not request this email, someone may be trying to access your account.`,
    });

    return res.status(200).json({ message: "Username sent to email" });
  } catch (error) {
    console.log("Error in forgotUsername controller: ", error.message);
    res
      .status(500)
      .json({ error: "Internal server error, please try again later" });
  }
};
