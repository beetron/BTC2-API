import dns from "dns/promises";
import ipaddr from "ipaddr.js";

// SSRF-guarded outbound fetch for user-supplied URLs (link previews). Blocks
// requests to loopback/private/link-local/reserved addresses -- including
// the 169.254.169.254 cloud metadata endpoint -- and revalidates every
// redirect hop instead of trusting fetch's automatic redirect following,
// since a URL can pass validation and then redirect to an internal target.

const BLOCKED_RANGES = [
  "unspecified",
  "loopback",
  "private",
  "linkLocal",
  "uniqueLocal",
  "reserved",
  "carrierGradeNat",
  "broadcast",
  "multicast",
];

const isBlockedAddress = (address) => {
  try {
    const parsed = ipaddr.parse(address);
    const range = parsed.range();
    return BLOCKED_RANGES.includes(range);
  } catch {
    // Unparseable address -- fail closed
    return true;
  }
};

const assertPublicUrl = async (urlString) => {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error("Invalid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed");
  }

  const hostname = parsed.hostname;
  if (!hostname || hostname === "localhost") {
    throw new Error("URL host is not allowed");
  }

  // Literal IP in the URL (e.g. http://169.254.169.254/) -- check directly
  if (ipaddr.isValid(hostname)) {
    if (isBlockedAddress(hostname)) {
      throw new Error("URL host is not allowed");
    }
    return parsed;
  }

  // Hostname -- resolve and check every returned address (DNS rebinding is
  // still possible between this check and the actual connect, but this
  // blocks the overwhelming majority of naive SSRF attempts)
  let addresses;
  try {
    addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("Could not resolve URL host");
  }

  if (addresses.length === 0 || addresses.some((a) => isBlockedAddress(a.address))) {
    throw new Error("URL host is not allowed");
  }

  return parsed;
};

/**
 * Fetch a URL with SSRF guarding, a byte cap, a timeout, and manual
 * (revalidated) redirect following.
 */
export const safeFetch = async (
  urlString,
  { maxRedirects = 3, timeoutMs = 5000, maxBytes = 2 * 1024 * 1024 } = {}
) => {
  let currentUrl = urlString;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const validated = await assertPublicUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      response = await fetch(validated.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; BTC2LinkPreview/1.0)",
          Accept: "text/html,image/*;q=0.8,*/*;q=0.5",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("Redirect with no location");
      }
      currentUrl = new URL(location, validated).href;
      continue;
    }

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader && Number(contentLengthHeader) > maxBytes) {
      throw new Error("Response too large");
    }

    // Cap the body read regardless of a (possibly absent/wrong) Content-Length
    const reader = response.body?.getReader();
    const chunks = [];
    let total = 0;

    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          throw new Error("Response too large");
        }
        chunks.push(value);
      }
    }

    return {
      finalUrl: validated.href,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      body: Buffer.concat(chunks.map((c) => Buffer.from(c))),
    };
  }

  throw new Error("Too many redirects");
};

export default safeFetch;
