import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import { isAccessTokenRevoked } from "../utility/sessionRevocation.js";

const protectRoute = async (req, res, next) => {
  try {
    // Check headers for jwt token via authorization
    const authHeader = req.headers["authorization"];

    // Split token from Bearer
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Verify token validity. An expired or malformed token is a 401 so
    // clients run their refresh-and-retry path instead of treating it as a
    // server failure.
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({ error: "Unauthorized - Invalid Token" });
    }

    if (!decoded) {
      return res.status(401).json({ error: "Unauthorized - Invalid Token" });
    }

    // Find user if token is valid
    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(401).json({ error: "Unauthorized - User not found" });
    }

    if (isAccessTokenRevoked(user, decoded)) {
      return res.status(401).json({ error: "Unauthorized - Session revoked" });
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
