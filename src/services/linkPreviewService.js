import LinkPreview from "../models/linkPreview.model.js";
import { safeFetch } from "../utility/safeFetch.js";
import { extractOgTags } from "../utility/extractOgTags.js";

// Negative caching (status "unavailable") uses a short TTL so a transiently
// down site gets retried soon; successful previews are cached longer since
// OG metadata for a given URL rarely changes.
const FRESH_TTL_MS = {
  ok: 24 * 60 * 60 * 1000,
  unavailable: 60 * 60 * 1000,
};

const toPublicShape = (doc) => ({
  url: doc.url,
  title: doc.title,
  description: doc.description,
  image: doc.image,
  siteName: doc.siteName,
});

const isFresh = (doc) => {
  const ttl = FRESH_TTL_MS[doc.status] ?? FRESH_TTL_MS.unavailable;
  return Date.now() - doc.fetchedAt.getTime() < ttl;
};

export const getPreview = async (url) => {
  const cached = await LinkPreview.findOne({ url });
  if (cached && isFresh(cached)) {
    return toPublicShape(cached);
  }

  let fields = { title: null, description: null, image: null, siteName: null };
  let status = "unavailable";

  try {
    const { body, contentType, finalUrl } = await safeFetch(url);
    if (contentType.includes("text/html")) {
      fields = extractOgTags(body.toString("utf-8"), finalUrl);
      if (fields.title || fields.description || fields.image) {
        status = "ok";
      }
    }
  } catch (error) {
    console.log(`Link preview fetch failed for ${url}: ${error.message}`);
  }

  const updated = await LinkPreview.findOneAndUpdate(
    { url },
    { url, status, ...fields, fetchedAt: new Date() },
    { upsert: true, new: true }
  );

  return toPublicShape(updated);
};

// Proxies a preview's image through our backend rather than letting the
// browser hit the third-party host directly -- keeps the recipient's IP
// from being exposed to whoever owns the linked page, same rationale as
// fetching the OG tags server-side in the first place.
export const getPreviewImage = async (imageUrl) => {
  const { body, contentType } = await safeFetch(imageUrl, {
    maxBytes: 3 * 1024 * 1024,
  });

  if (!contentType.startsWith("image/")) {
    throw new Error("URL did not return an image");
  }

  return { body, contentType };
};
