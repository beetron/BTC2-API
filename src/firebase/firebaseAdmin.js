import { initializeApp, cert } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { createRequire } from "module";

const appEnvironment = process.env.NODE_ENV;
let serviceAccount;

if (appEnvironment === "production") {
  serviceAccount = JSON.parse(process.env.FIREBASE_KEY);
} else {
  const require = createRequire(import.meta.url);
  serviceAccount = require("./serviceAccountKey.json");
}

initializeApp({
  credential: cert(serviceAccount),
});

export { getMessaging };
