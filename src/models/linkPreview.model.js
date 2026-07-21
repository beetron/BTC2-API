import mongoose from "mongoose";

const linkPreviewSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      unique: true,
    },
    status: {
      type: String,
      enum: ["ok", "unavailable"],
      required: true,
    },
    title: { type: String, default: null },
    description: { type: String, default: null },
    image: { type: String, default: null },
    siteName: { type: String, default: null },
    fetchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const LinkPreview = mongoose.model("LinkPreview", linkPreviewSchema);
export default LinkPreview;
