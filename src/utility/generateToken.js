import jwt from "jsonwebtoken";

const generateToken = (userId) => {
  const token = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
    // expiresIn: "30m",
  });

  return token;
};

export default generateToken;
