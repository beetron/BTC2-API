import jwt from "jsonwebtoken";
import User from "../models/user.model.js";

const protectRoute = async (req, res, next) => {
  try {
    // Read token from cookies
    const token = req.cookies.jwt;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify token validity
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded) {
      return res.status(401).json({ error: "Unauthorized - Invalid Token" });
    }

    // Find user if token is valid
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({ error: "Unauthorized - User not found" });
    }

    // Set user in request object
    req.user = user;

    // Call function after protectRoute
    next();
  } catch (error) {
    console.log("Error in protectRoute: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

export default protectRoute;
