import jwt from "jsonwebtoken";

const generateTokenAndSetCookie = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });

  res.cookie("jwt", token, {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days to milliseconds
    httpOnly: true, // Counter Cross-Site scripting (XSS) attacks
    sameSite: "strict", // Counter Cross-Site Request Forgery (CSRF)
    secure: process.env.NODE_ENV !== "development",
  });
};

export default generateTokenAndSetCookie;
