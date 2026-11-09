// Shared harness for the API integration tests.
//
// Each test file runs in its own process (node --test), calls startTestApp()
// once, and gets the real Express app backed by a throwaway in-memory
// MongoDB. Nothing here touches the real database, Firebase or SMTP.

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret";
// Admin endpoints stay disabled unless a test sets ADMIN_USER_ID
delete process.env.ADMIN_USER_ID;

import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";

let mongod;
let app;

export const startTestApp = async () => {
  // CI provides a real MongoDB service container via MONGO_TEST_URI; locally
  // an in-memory server is started instead. Either way each test file gets
  // its own database, dropped again in stopTestApp.
  if (process.env.MONGO_TEST_URI) {
    await mongoose.connect(process.env.MONGO_TEST_URI, {
      dbName: `btc2_test_${process.pid}`,
    });
  } else {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }
  // Imported only after the env above is set, since several modules read
  // process.env when they load
  ({ app } = await import("../../src/app.js"));
  // Build unique indexes (username, email...) before tests rely on them
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.syncIndexes())
  );
  return app;
};

export const stopTestApp = async () => {
  if (process.env.MONGO_TEST_URI) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
  await mongod?.stop();
};

export const clearDatabase = async () => {
  const collections = await mongoose.connection.db.collections();
  await Promise.all(collections.map((c) => c.deleteMany({})));
};

export const api = () => request(app);

export const User = () => mongoose.model("User");

let userCounter = 0;

// Inserts a user straight into the database (bypassing signup) and returns
// the document plus the plain-text password used
export const createUser = async (overrides = {}) => {
  userCounter += 1;
  const username = overrides.username || `testuser${userCounter}`;
  const password = overrides.password || "password123";
  const user = await User().create({
    username,
    email: `${username}@example.com`,
    ...overrides,
    password: await bcrypt.hash(password, 4),
  });
  return { user, password };
};

// Logs in through the real endpoint and returns { token, refreshToken, body }
export const login = async (username, password) => {
  const res = await api().post("/auth/login").send({ username, password });
  if (res.status !== 200) {
    throw new Error(`login failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return { token: res.body.token, refreshToken: res.body.refreshToken, body: res.body };
};

// Signs an access token directly, for tests that don't need a real login
export const tokenFor = (user, options = {}) =>
  jwt.sign({ userId: user._id.toString() }, process.env.JWT_SECRET, {
    expiresIn: "7d",
    ...options,
  });

export const auth = (token) => ({ Authorization: `Bearer ${token}` });

// Makes two users friends with each other
export const befriend = async (a, b) => {
  await User().updateOne({ _id: a._id }, { $addToSet: { friendList: b._id } });
  await User().updateOne({ _id: b._id }, { $addToSet: { friendList: a._id } });
};
