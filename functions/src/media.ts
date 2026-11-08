import express, { Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { asyncHandler, requireAuth } from "./auth";
import { BOX_PREFIX, CACHE_ROOT, CHUNK_BYTES, DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAX_CHUNKS, MAX_UPLOAD_BYTES } from "./constants";
import { MediaKind, MediaUpload } from "./models";
import { circleCol, messageCol, readFields, userFields } from "./paths";
import {
  OBJECT_NAME,
  checkBytes,
  checkHead,
  checkLockedSize,
  chunkName,
  cleanFileName,
  deleteChunks,
  isObjectId,
  joinChunks,
  objectInfo,
  putObject,
  readHead,
  readObject,
} from "./sf-cache";

const uidOf = (res: Response) => (res.locals.token as DecodedIdToken).uid;
const MESSAGE_KINDS: MediaKind[] = ["image", "video", "audio"];
/** `?locked=1`: the file was locked on the sender's device (message encryption), so the server stores ciphertext and checks only the size. */
const locked = (req: Request) => req.query.locked === "1";

/** The file comes as the plain request body (any content type except JSON: the type is found from the first bytes, not from the header). */
const fileBody = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });
const chunkBody = express.raw({ type: () => true, limit: CHUNK_BYTES });

/**
 * The media cache: /api/sf-cache/<userid>/<objectid>. Files are stored by the person who sends them (in their own folder)
 * and read through this proxy, never straight from Google Storage.
 */
export const cacheRouter = Router();

/** Upload a file to send in a message: `POST /api/sf-cache?kind=image|video|audio&name=<file name>`, the file as the body (`&locked=1`: a locked file, no name). Answers where it is stored. */
cacheRouter.post(
  "/",
  requireAuth,
  fileBody,
  asyncHandler(async (req, res) => {
    const kind = req.query.kind as MediaKind;
    if (!MESSAGE_KINDS.includes(kind)) {
      res.status(400).json({ error: "kind must be image, video or audio" });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const checked = locked(req) ? checkLockedSize(kind, bytes.length) : checkBytes(kind, bytes); // a locked file (`locked=1`) cannot be looked into: only its size is checked
    if ("error" in checked) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    const uid = uidOf(res);
    const objectId = messageCol(uid).doc().id; // a message with this file gets the same id
    const name = locked(req) ? null : cleanFileName(req.query.name); // the name of a locked file is locked inside the message
    await putObject(uid, objectId, bytes, kind, checked.mime, name);
    res.status(201).json({ ownerId: uid, objectId, kind, mime: checked.mime, name, bytes: bytes.length } satisfies MediaUpload);
  }),
);

/**
 * A big file is sent in pieces, still through the API (at most MAX_CHUNKS of CHUNK_BYTES each):
 *   1. `POST /api/sf-cache/uploads` answers `{ uploadId }`; the file will get that id as its object id
 *   2. `PUT /api/sf-cache/uploads/<uploadId>/<n>` for every piece n = 0, 1, 2 ... (a piece sent again replaces the first one)
 *   3. `POST /api/sf-cache/uploads/<uploadId>/finish?kind=...&parts=<how many>&name=...` joins them; it answers like a single upload
 * The pieces are in the sender's folder as tmp/<uploadId>/<n>.
 */
cacheRouter.post("/uploads", requireAuth, (_req, res) => {
  res.status(201).json({ uploadId: messageCol(uidOf(res)).doc().id, chunkBytes: CHUNK_BYTES, maxChunks: MAX_CHUNKS });
});

cacheRouter.put(
  "/uploads/:uploadId/:n",
  requireAuth,
  chunkBody,
  asyncHandler(async (req, res) => {
    const n = /^\d{1,2}$/.test(req.params.n) ? Number(req.params.n) : -1;
    if (!isObjectId(req.params.uploadId) || n < 0 || n >= MAX_CHUNKS) {
      res.status(400).json({ error: `A piece is numbered 0 to ${MAX_CHUNKS - 1}` });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!bytes.length) {
      res.status(400).json({ error: "Send the piece as the request body" });
      return;
    }
    const uid = uidOf(res);
    const name = chunkName(req.params.uploadId, n);
    await putObject(uid, name, bytes, "chunk", "application/octet-stream");
    res.status(204).end();
  }),
);

cacheRouter.post(
  "/uploads/:uploadId/finish",
  requireAuth,
  asyncHandler(async (req, res) => {
    const kind = req.query.kind as MediaKind;
    const parts = Number(req.query.parts);
    if (!isObjectId(req.params.uploadId) || !MESSAGE_KINDS.includes(kind) || !Number.isInteger(parts) || parts < 1 || parts > MAX_CHUNKS) {
      res.status(400).json({ error: `Say the kind (image, video or audio) and how many pieces there are (1 to ${MAX_CHUNKS})` });
      return;
    }
    const uid = uidOf(res);
    const objectId = req.params.uploadId;
    const done = await objectInfo(uid, objectId);
    if (done?.kind === kind) {
      // finished before (the answer got lost): the same answer again
      res.json({ ownerId: uid, objectId, kind, mime: done.mime, name: done.fileName, bytes: done.bytes } satisfies MediaUpload);
      return;
    }
    const pieces = await Promise.all(Array.from({ length: parts }, (_, n) => objectInfo(uid, chunkName(objectId, n))));
    const missing = pieces.findIndex((p) => !p);
    if (missing >= 0) {
      res.status(400).json({ error: `Piece ${missing} has not arrived` });
      return;
    }
    const size = pieces.reduce((sum, p) => sum + p!.bytes, 0);
    const checked = locked(req) ? checkLockedSize(kind, size) : checkHead(kind, await readHead(uid, chunkName(objectId, 0), 12), size);
    if ("error" in checked) {
      await deleteChunks(uid, objectId);
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    const name = locked(req) ? null : cleanFileName(req.query.name);
    await joinChunks(uid, objectId, parts, objectId, kind, checked.mime, name);
    await deleteChunks(uid, objectId);
    res.status(201).json({ ownerId: uid, objectId, kind, mime: checked.mime, name, bytes: size } satisfies MediaUpload);
  }),
);

/** Add the small preview to one of my uploads (an image or a video): `PUT /api/sf-cache/<objectid>/thumb`, the picture as the body. */
cacheRouter.put(
  "/:objectId/thumb",
  requireAuth,
  fileBody,
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const info = isObjectId(req.params.objectId) ? await objectInfo(uid, req.params.objectId) : null;
    if (!info || !(info.kind === "image" || info.kind === "video")) {
      res.status(404).json({ error: "Upload the file first (a preview is for an image or a video)" });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const checked = locked(req) ? checkLockedSize("thumb", bytes.length) : checkBytes("thumb", bytes);
    if ("error" in checked) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    await putObject(uid, `${req.params.objectId}.thumb`, bytes, "thumb", checked.mime);
    res.status(204).end();
  }),
);

/** Is `reader` one of `owner`'s confirmed friends? */
async function isFriendOf(reader: string, owner: string): Promise<boolean> {
  const mine = await circleCol(reader).doc(DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).where("linkedUid", "==", owner).select("status").get();
  return mine.docs.some((d) => d.data().status === "confirmed");
}

/**
 * May `reader` open this object of `owner`? The owner always. A safebox file (`box-<connectionId>`): the two friends of that confirmed friendship. A message file: the person it was sent to, who has the message
 * (the message has the id of its file, so deleting the message closes the file). A profile picture: the owner's confirmed friends.
 * Anything else, also an unknown object, is simply "not found" (so nobody can find out what exists).
 */
async function mayRead(reader: string, owner: string, objectId: string): Promise<boolean> {
  if (reader === owner) return true;
  // a safebox: the owner is `box-<connectionId>`, and only the two friends of that confirmed friendship may read it
  if (owner.startsWith(BOX_PREFIX)) {
    const entry = (await circleCol(reader).doc(DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).doc(owner.slice(BOX_PREFIX.length)).get()).data();
    return entry?.status === "confirmed" && Boolean(entry.linkedUid);
  }
  const message = await readFields(messageCol(reader).doc(objectId), "media", "fromUid");
  if (message?.media && message.fromUid === owner) return true;
  const account = await userFields(owner, "avatarObjectId");
  return account?.avatarObjectId === objectId && (await isFriendOf(reader, owner));
}

/**
 * The proxy, `getObject(userid/objectid)`: `GET /api/sf-cache/<userid>/<objectid>` (or `<objectid>.thumb`), an ordinary API call
 * with the login header. It answers with the bytes of the file, its type (`Content-Type`) and its name (`Content-Disposition`).
 */
cacheRouter.get(
  "/:ownerId/:name",
  requireAuth,
  asyncHandler(async (req: Request, res: Response) => {
    const { ownerId, name } = req.params;
    const parsed = OBJECT_NAME.exec(name);
    const info = parsed && (await mayRead(uidOf(res), ownerId, parsed[1])) ? await objectInfo(ownerId, name) : null;
    if (!info) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const etag = `"${name}"`; // a file never changes under its name
    res.set({ "Content-Type": info.mime, "Content-Length": String(info.bytes), "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(info.fileName ?? name)}`, "Cache-Control": "private, max-age=31536000, immutable", ETag: etag, "X-Content-Type-Options": "nosniff" });
    if (req.header("If-None-Match") === etag) {
      res.status(304).end();
      return;
    }
    const stream = readObject(ownerId, name);
    stream.on("error", (err) => {
      console.error(`Could not read ${CACHE_ROOT}/${ownerId}/${name}`, err);
      res.destroy();
    });
    stream.pipe(res);
  }),
);
