import dotenv from "dotenv";
dotenv.config();

// Get API URL
export const API_URL =
  process.env.NODE_ENV === "development"
    ? process.env.DEVELOPMENT_URL
    : process.env.PRODUCTION_URL;
