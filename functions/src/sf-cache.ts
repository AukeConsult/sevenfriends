import { getStorage } from "firebase-admin/storage";
import { Readable } from "stream";
import { CACHE_ROOT, MAX_CACHE_BYTES, MAX_PICTURE_BYTES } from "./constants";
import { CacheKind, MediaKind } from "./models";

const MB = 1024 * 1024;

/** The file formats we recognise by their first bytes. The type the app claims is never trusted. */
type Container = "jpeg" | "png" | "gif" | "webp" | "mp4" | "quicktime" | "webm" | "ogg" | "mp3" | "wav";
type Family = "image" | "video" | "audio";

/** The content type served for a container, per family (an mp4 or webm file can be a video or only sound). */
const TYPES: Record<Container, Partial<Record<Family, string>>> = {
  jpeg: { image: "image/jpeg" },
  png: { image: "image/png" },
  gif: { image: "image/gif" },
  webp: { image: "image/webp" },
  mp4: { video: "video/mp4", audio: "audio/mp4" },
  quicktime: { video: "video/quicktime" },
  webm: { video: "video/webm", audio: "audio/webm" },
  ogg: { audio: "audio/ogg" },
  mp3: { audio: "audio/mpeg" },
  wav: { audio: "audio/wav" },
};

const PICTURES: Container[] = ["jpeg", "png", "webp"];

/**
 * What each kind of object may be: the one place with the limits and the allowed formats.
 * 'thumb' is the small preview of an image or video (stored next to it as <objectid>.thumb).
 */
const KIND_RULES: Record<CacheKind | "thumb", { family: Family; containers: Container[]; maxBytes: number; countsInQuota: boolean }> = {
  image: { family: "image", containers: [...PICTURES, "gif"], maxBytes: 10 * MB, countsInQuota: true },
  video: { family: "video", containers: ["mp4", "quicktime", "webm"], maxBytes: 100 * MB, countsInQuota: true },
  audio: { family: "audio", containers: ["mp4", "webm", "ogg", "mp3", "wav"], maxBytes: 25 * MB, countsInQuota: true },
  avatar: { family: "image", containers: PICTURES, maxBytes: MAX_PICTURE_BYTES, countsInQuota: false },
  icon: { family: "image", containers: PICTURES, maxBytes: 32 * 1024, countsInQuota: false },
  thumb: { family: "image", containers: PICTURES, maxBytes: 100 * 1024, countsInQuota: true },
};

/** What a stored object can be: the kinds above, a preview, or one piece of an upload that is not finished (`tmp/<uploadid>/<n>`). */
type StoredKind = CacheKind | "thumb" | "chunk";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Which file format the first bytes say it is, or null. */
function sniff(b: Buffer): Container | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(PNG)) return "png";
  const head = b.toString("latin1", 0, 4);
  if (head === "GIF8") return "gif";
  if (head === "RIFF") {
    const form = b.toString("latin1", 8, 12);
    return form === "WEBP" ? "webp" : form === "WAVE" ? "wav" : null;
  }
  if (b.toString("latin1", 4, 8) === "ftyp") return b.toString("latin1", 8, 10) === "qt" ? "quicktime" : "mp4";
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
  if (head === "OggS") return "ogg";
  if (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
  return null;
}

/** The content type to store for these bytes as that kind of object, or the reason (and HTTP status) it is refused. */
export function checkBytes(kind: CacheKind | "thumb", bytes: Buffer): { mime: string } | { status: number; error: string } {
  return checkHead(kind, bytes, bytes.length);
}

/** The same check for a file whose first bytes (`head`) and whole size are known (a file put together from pieces). */
export function checkHead(kind: CacheKind | "thumb", head: Buffer, size: number): { mime: string } | { status: number; error: string } {
  const rule = KIND_RULES[kind];
  if (!size) return { status: 400, error: "Send the file as the request body" };
  if (size > rule.maxBytes) {
    return { status: 413, error: `That file is too big (at most ${Math.round(rule.maxBytes / 1024 / (rule.maxBytes >= MB ? 1024 : 1))} ${rule.maxBytes >= MB ? "MB" : "KB"})` };
  }
  const container = sniff(head);
  const mime = container && rule.containers.includes(container) ? TYPES[container][rule.family] : undefined;
  return mime ? { mime } : { status: 415, error: `That is not a supported ${kind === "thumb" ? "preview" : kind} file` };
}

// ---------------------------------------------------------------- storage

const bucket = () => getStorage().bucket();
const path = (owner: string, name: string) => `${CACHE_ROOT}/${owner}/${name}`;
/** The object names are Firestore ids (letters and digits), optionally with `.thumb`. */
export const OBJECT_NAME = /^([A-Za-z0-9_-]{8,40})(\.thumb)?$/;
export const isObjectId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{8,40}$/.test(v);

/** What a message with a file and no text says in a notification or on Home. */
export const mediaLabel = (kind: MediaKind) => ({ image: "📷 Photo", video: "🎞 Video", audio: "🎤 Audio" })[kind];

/** Store a file (replaces one with the same name). A file never changes once stored, so the browser may keep it for ever. */
export async function putObject(owner: string, name: string, data: Buffer, kind: StoredKind, mime: string, fileName: string | null = null): Promise<void> {
  await bucket()
    .file(path(owner, name))
    .save(data, {
      contentType: mime,
      resumable: false,
      metadata: { cacheControl: "private, max-age=31536000, immutable", metadata: { kind, ...(fileName ? { fileName } : {}) } },
    });
}

/** A file name from the app, made safe to store and to send back in a header: no folders, no control characters, at most 100 characters. */
export const cleanFileName = (v: unknown): string | null => (typeof v === "string" ? v.replace(/[\\/\u0000-\u001f]/g, "").trim().slice(0, 100) || null : null);

export interface ObjectInfo {
  bytes: number;
  mime: string;
  /** the name the file had when it was uploaded */
  fileName: string | null;
  kind: StoredKind | null;
}

/** What is stored under that name, or null when nothing is. */
export async function objectInfo(owner: string, name: string): Promise<ObjectInfo | null> {
  try {
    const [m] = await bucket().file(path(owner, name)).getMetadata();
    return { bytes: Number(m.size), mime: String(m.contentType), fileName: (m.metadata?.fileName as string | undefined) ?? null, kind: (m.metadata?.kind as ObjectInfo["kind"]) ?? null };
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
}

/** The file as a stream. */
export function readObject(owner: string, name: string): Readable {
  return bucket().file(path(owner, name)).createReadStream();
}

/** The whole file, for the few small ones the backend sends on itself (a profile picture). */
export async function readAll(owner: string, name: string): Promise<Buffer | null> {
  try {
    return (await bucket().file(path(owner, name)).download())[0];
  } catch (err: any) {
    if (err?.code === 404) return null;
    throw err;
  }
}

/** The first `length` bytes of a file. */
export async function readHead(owner: string, name: string, length: number): Promise<Buffer> {
  return (await bucket().file(path(owner, name)).download({ start: 0, end: length - 1 }))[0];
}

// ---- chunked upload: the pieces wait under tmp/<uploadid>/<n> until they are joined into one file ----

export const chunkName = (uploadId: string, n: number) => `tmp/${uploadId}/${n}`;

/** Join the pieces 0..parts-1 into the file `objectId` and give it its type, name and kind. */
export async function joinChunks(owner: string, uploadId: string, parts: number, objectId: string, kind: CacheKind, mime: string, fileName: string | null): Promise<void> {
  const target = bucket().file(path(owner, objectId));
  await bucket().combine(Array.from({ length: parts }, (_, n) => bucket().file(path(owner, chunkName(uploadId, n)))), target);
  await target.setMetadata({ contentType: mime, cacheControl: "private, max-age=31536000, immutable", metadata: { kind, ...(fileName ? { fileName } : {}) } });
}

/** Delete the pieces of an upload (after it is joined, or given up). */
export async function deleteChunks(owner: string, uploadId: string): Promise<void> {
  try {
    await bucket().deleteFiles({ prefix: path(owner, `tmp/${uploadId}/`), force: true });
  } catch (err) {
    console.error(`Could not delete the pieces of upload ${uploadId}`, err);
  }
}

/** Delete a file and its preview; nothing there is fine. Failing to delete is logged, never raised: the data it belonged to is gone already. */
export async function deleteObject(owner: string, objectId: string): Promise<void> {
  for (const name of [objectId, `${objectId}.thumb`]) {
    try {
      await bucket().file(path(owner, name)).delete({ ignoreNotFound: true });
    } catch (err) {
      console.error(`Could not delete ${path(owner, name)}`, err);
    }
  }
}

/** Delete everything a person has in the cache. */
export async function deleteFolder(owner: string): Promise<void> {
  try {
    await bucket().deleteFiles({ prefix: `${CACHE_ROOT}/${owner}/`, force: true });
  } catch (err) {
    console.error(`Could not delete the folder of ${owner}`, err);
  }
}

/** How much of a person's quota is used (images, video and audio, with their previews). */
export async function usedBytes(owner: string): Promise<number> {
  const [files] = await bucket().getFiles({ prefix: `${CACHE_ROOT}/${owner}/` });
  return files.reduce((sum, f) => {
    const kind = f.metadata.metadata?.kind as StoredKind | undefined;
    return sum + (kind && (kind === "chunk" || KIND_RULES[kind].countsInQuota) ? Number(f.metadata.size) : 0);
  }, 0);
}

export const quotaLeft = async (owner: string) => MAX_CACHE_BYTES - (await usedBytes(owner));
