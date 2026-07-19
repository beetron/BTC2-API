// Lightweight Open Graph / meta-tag extractor. Deliberately avoids a full
// HTML parser: <meta> tags are matched with a bounded quantifier first, then
// attributes are pulled from each short match individually, so a hostile
// page can't trigger catastrophic backtracking (ReDoS) the way an
// unbounded regex over the whole document could.

const META_TAG_RE = /<meta\b[^>]{0,500}>/gi;
const ATTR_RE = /(property|name)\s*=\s*["']([^"']{1,100})["']|content\s*=\s*["']([^"']{0,500})["']/gi;
const TITLE_TAG_RE = /<title[^>]{0,100}>([^<]{0,300})<\/title>/i;

const parseMetaTags = (html) => {
  const tags = html.match(META_TAG_RE) || [];
  const map = {};

  for (const tag of tags) {
    let key = null;
    let content = null;
    let match;
    ATTR_RE.lastIndex = 0;
    while ((match = ATTR_RE.exec(tag)) !== null) {
      if (match[2] !== undefined) key = match[2].toLowerCase();
      if (match[3] !== undefined) content = match[3];
    }
    if (key && content !== null && !(key in map)) {
      map[key] = decodeHtmlEntities(content);
    }
  }

  return map;
};

const decodeHtmlEntities = (str) =>
  str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");

/**
 * Extract Open Graph (with meta-description / <title> fallback) fields from
 * an HTML document. `baseUrl` is used to resolve relative og:image URLs.
 */
export const extractOgTags = (html, baseUrl) => {
  // OG tags live in <head>, which is always near the top of a well-formed
  // document -- capping the scan window keeps this fast and ReDoS-safe on
  // huge pages regardless of the safeFetch byte cap upstream.
  const head = html.slice(0, 200_000);
  const meta = parseMetaTags(head);

  const title =
    meta["og:title"] || meta["twitter:title"] || (head.match(TITLE_TAG_RE)?.[1]?.trim() ?? null);
  const description =
    meta["og:description"] || meta["twitter:description"] || meta["description"] || null;
  const siteName = meta["og:site_name"] || null;

  let image = meta["og:image"] || meta["og:image:url"] || meta["twitter:image"] || null;
  if (image) {
    try {
      image = new URL(image, baseUrl).href;
      if (!["http:", "https:"].includes(new URL(image).protocol)) {
        image = null;
      }
    } catch {
      image = null;
    }
  }

  return {
    title: title || null,
    description: description || null,
    image,
    siteName,
  };
};

export default extractOgTags;
