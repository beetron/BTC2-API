import * as linkPreviewService from "../services/linkPreviewService.js";

const isHttpUrl = (value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

/////////////////////////////////////////////
// Open Graph metadata for a message's link (cached server-side)
/////////////////////////////////////////////
export const getLinkPreview = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !isHttpUrl(url)) {
      return res.status(400).json({ error: "A valid http(s) url is required" });
    }

    const preview = await linkPreviewService.getPreview(url);
    res.status(200).json(preview);
  } catch (error) {
    console.log("Error in getLinkPreview controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/////////////////////////////////////////////
// Proxy a preview's image so the browser never contacts the linked host
// directly
/////////////////////////////////////////////
export const getLinkPreviewImage = async (req, res) => {
  try {
    const { url } = req.query;
    if (!url || !isHttpUrl(url)) {
      return res.status(400).json({ error: "A valid http(s) url is required" });
    }

    const { body, contentType } = await linkPreviewService.getPreviewImage(url);
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "private, max-age=86400");
    res.status(200).send(body);
  } catch (error) {
    console.log("Error in getLinkPreviewImage controller: ", error.message);
    res.status(400).json({ error: "Could not load image" });
  }
};
