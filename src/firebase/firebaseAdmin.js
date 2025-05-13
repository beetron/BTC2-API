import admin from "firebase-admin";
import { createRequire } from "module";

const appEnvironment = process.env.NODE_ENV;
let serviceAccount;

if (appEnvironment === "production") {
  // Parse JSON string from environment variable
  serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
} else {
  // In development, use require for JSON files
  const require = createRequire(import.meta.url);
  serviceAccount = require("./serviceAccountKey.json");
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

export default admin;
