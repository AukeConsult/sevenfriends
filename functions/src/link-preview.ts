import { lookup as dnsLookup } from "dns";
import { request as httpRequest } from "http";
import { request as httpsRequest } from "https";
import { isIP } from "net";
import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { asyncHandler, requireAuth } from "./auth";
import { MessageLink } from "./models";

/**
 * The first link of a message and whether its page may be shown INSIDE the app (a frame).
 *
 *  - YouTube, Vimeo and Spotify links get the official embed address (their players are made for frames).
 *  - Any other page: the server asks the site once (GET, headers only) and reads whether it forbids framing
 *    (`X-Frame-Options`, or `Content-Security-Policy: frame-ancestors`). If it does not, the page can be framed.
 *  - The check never fails the message: any problem (slow, error, not a web page) just means "no preview" and the link stays a plain link.
 *
 * The server fetches an address a person typed, so it is careful (SSRF): only http(s) on ports 80/443, no passwords in the address,
 * the address is resolved by OUR lookup, which refuses private / internal / loopback / link-local addresses at connect time (so a name that changes
 * its mind between the check and the connection is refused too), at most 3 redirects (each one checked the same way), a short time limit,
 * and the body is never read.
 */

const URL_PATTERN = /https?:\/\/[^\s<>"']+/i;
const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 3000;

/** The first web address in a text, without the punctuation that ends a sentence, or null. */
export function firstUrl(text: string): string | null {
  const found = URL_PATTERN.exec(text)?.[0];
  if (!found) return null;
  const trimmed = found.replace(/[.,;:!?)\]}]+$/, "");
  try {
    const url = new URL(trimmed);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

/** The address of the official player for a link to a video or a song, or null. */
export function playerUrl(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m|music)\./, "");
  const id = /^[\w-]{6,20}$/;
  if (host === "youtu.be") {
    const v = url.pathname.slice(1).split("/")[0];
    return id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "youtube.com") {
    const v = url.pathname === "/watch" ? url.searchParams.get("v") : /^\/(shorts|embed|live)\/([\w-]{6,20})/.exec(url.pathname)?.[2];
    return v && id.test(v) ? `https://www.youtube-nocookie.com/embed/${v}` : null;
  }
  if (host === "vimeo.com") {
    const v = /^\/(\d{5,12})(?:\/|$)/.exec(url.pathname)?.[1];
    return v ? `https://player.vimeo.com/video/${v}` : null;
  }
  if (host === "open.spotify.com") {
    const m = /^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,30})/.exec(url.pathname);
    return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : null;
  }
  return null;
}

/** True for addresses that are not on the public internet: this machine, the home / company network, link-local (cloud metadata) ... */
export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    );
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === "::" || lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || /^fe[89ab]/.test(lower);
  }
  return true; // not an address at all
}

/** The lookup used for the connection: only public addresses are allowed. */
const safeLookup: typeof dnsLookup = ((hostname: string, options: unknown, callback: (...args: unknown[]) => void) => {
  const opts = (typeof options === "object" && options ? options : {}) as { all?: boolean };
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as { address: string; family: number }[];
    if (!list.length || list.some((a) => isPrivateAddress(a.address))) return callback(new Error("Address not allowed"));
    return opts.all ? callback(null, list) : callback(null, list[0].address, list[0].family);
  });
}) as typeof dnsLookup;

type Headers = Record<string, string | string[] | undefined>;

function headersOf(url: URL): Promise<{ status: number; headers: Headers }> {
  return new Promise((resolve, reject) => {
    const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
    if (port !== 80 && port !== 443) return reject(new Error("Port not allowed"));
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(url, { method: "GET", lookup: safeLookup, headers: { "user-agent": "SevenFriendsLinkCheck/1.0", accept: "text/html" }, timeout: TIMEOUT_MS }, (res) => {
      resolve({ status: res.statusCode ?? 0, headers: res.headers });
      res.destroy(); // only the headers are wanted
    });
    req.on("timeout", () => req.destroy(new Error("Timeout")));
    req.on("error", reject);
    req.end();
  });
}

/** Does the site allow its page in a frame of another site? (`headers` of the page.) */
export function framingAllowed(headers: Headers): boolean {
  if (headers["x-frame-options"]) return false; // DENY, SAMEORIGIN (and the old ALLOW-FROM): not for us
  const csp = ([] as string[]).concat(headers["content-security-policy"] ?? []).join(";");
  const ancestors = /(?:^|;)\s*frame-ancestors\s+([^;]*)/i.exec(csp)?.[1];
  if (ancestors === undefined) return true;
  return ancestors.split(/\s+/).some((token) => token === "*" || token === "https:");
}

async function pageAllowsFrame(start: URL): Promise<string | null> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { status, headers } = await headersOf(url);
    if (status >= 300 && status < 400 && typeof headers.location === "string") {
      const next = new URL(headers.location, url);
      if (next.protocol !== "http:" && next.protocol !== "https:") return null;
      url = next;
      continue;
    }
    if (status < 200 || status >= 300) return null;
    if (!String(headers["content-type"] ?? "").toLowerCase().includes("text/html")) return null; // a picture, a file ...: not a page to frame
    return framingAllowed(headers) ? url.href : null;
  }
  return null;
}

/** The link of a message (its first web address) and, when its page can be shown in a frame, the address to frame. Never throws. */
export async function linkOf(text: string): Promise<MessageLink | null> {
  const href = firstUrl(text);
  if (!href) return null;
  const url = new URL(href);
  const player = playerUrl(url);
  if (player) return { url: href, embedUrl: player };
  try {
    return { url: href, embedUrl: await pageAllowsFrame(url) };
  } catch {
    return { url: href, embedUrl: null }; // slow, refused or not a page: just a link
  }
}

// ---- the message field asks before sending: POST /api/link-preview { text } -> { link: MessageLink | null } ----

const ASKS_PER_MINUTE = 20;
const asked = new Map<string, number[]>(); // user id -> times of the last asks (in this server instance)

/** True when this person asked too often in the last minute (the fetch of a typed address must not be a free tool). */
export function tooMany(uid: string, now = Date.now()): boolean {
  const recent = (asked.get(uid) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  asked.set(uid, recent);
  if (asked.size > 5000) for (const [id, times] of asked) if (!times.some((t) => now - t < 60_000)) asked.delete(id);
  return recent.length > ASKS_PER_MINUTE;
}

/** What the message field shows while somebody is still writing: the link of the text and whether its page can be framed. Same check as at send time. */
export const linkPreviewRouter = Router();
linkPreviewRouter.use(requireAuth);
linkPreviewRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const text = typeof req.body?.text === "string" ? req.body.text.slice(0, 5000) : "";
    if (!firstUrl(text)) {
      res.json({ link: null });
      return;
    }
    if (tooMany((res.locals.token as DecodedIdToken).uid)) {
      res.status(429).json({ error: "Too many link checks. Wait a moment." });
      return;
    }
    res.json({ link: await linkOf(text) });
  }),
);
