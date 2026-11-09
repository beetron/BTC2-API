import { initializeApp, cert } from "firebase-admin/app";
import { createRequire } from "module";

const appEnvironment = process.env.NODE_ENV;

// Automated tests run without Firebase credentials (the key file is not in
// git), so push notifications are disabled there. Production and
// development initialise exactly as before.
const initFirebase = () => {
  if (appEnvironment === "test") return null;

  let serviceAccount;
  if (appEnvironment === "production") {
    // Parse JSON string from environment variable
    serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
  } else {
    // In development, use require for JSON files
    const require = createRequire(import.meta.url);
    serviceAccount = require("./serviceAccountKey.json");
  }

  return initializeApp({
    credential: cert(serviceAccount),
  });
};

const firebaseApp = initFirebase();

export default firebaseApp;
