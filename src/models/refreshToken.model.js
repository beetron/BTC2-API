import mongoose from "mongoose";

const refreshTokenSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Only the hash is stored (same rationale as password hashing) so a DB
    // leak alone can't be used to impersonate a session.
    tokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

// Mongo auto-deletes the document once expiresAt passes -- no cleanup job
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
refreshTokenSchema.index({ userId: 1 });

const RefreshToken = mongoose.model("RefreshToken", refreshTokenSchema);
export default RefreshToken;
