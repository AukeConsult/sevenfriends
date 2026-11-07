import express, { Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { FRIENDS_SUBCOLLECTION, MAX_UPLOAD_BYTES, SAFEBOX_MAX_BYTES, SAFEBOX_MAX_ITEMS, boxOwner } from "./constants";
import { connectionOf } from "./conversation";
import { BoxKeys, ENC_HEADER_MAX, MediaRef, Safebox, SafeboxItem } from "./models";
import { parseEncryptedUpload, wrapsCover, wrapsFor } from "./box-encryption";
import { publishedKeysOf } from "./keys";
import { circleCol, messageCol, safeboxItems } from "./paths";
import { nameOf, sendPush } from "./push";
import { touchFeed, touchFeedIfExists } from "./sync";
import { checkBytes, checkSafeboxFile, cleanFileName, deleteFolder, deleteObject, isObjectId, objectInfo, putObject, readAll, readObject } from "./sf-cache";

const uidOf = (res: Response) => (res.locals.token as DecodedIdToken).uid;
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);
/** One file may be as big as one upload request allows. */
const MAX_FILE_BYTES = MAX_UPLOAD_BYTES;
/** The file comes as the plain request body (the type is found from the first bytes, not from the header). */
const fileBody = express.raw({ type: () => true, limit: MAX_FILE_BYTES });
/** An encrypted file is a little bigger (the header and the 16 bytes of the lock): the same limit for the file itself. */
const encryptedBody = express.raw({ type: () => true, limit: MAX_FILE_BYTES + ENC_HEADER_MAX + 1024 });

/**
 * The safebox of one friendship: files only the two friends see. Mounted under /circles/:circleId/friends/:friendId/safebox.
 * Whoever may open it is found from the friend entry (a CONFIRMED friend), never from the id in the address alone. The box has
 * the shared id of the friendship, so both friends reach the same files; nobody else can, and it goes when the friendship ends.
 */
export const safeboxRouter = Router({ mergeParams: true });

const toItem = (id: string, d: FirebaseFirestore.DocumentData, uid: string): SafeboxItem => ({
  id,
  name: d.name as string,
  kind: d.kind,
  mime: d.mime as string,
  bytes: d.bytes as number,
  ownerId: d.addedBy as string,
  mine: d.addedBy === uid,
  createdAt: iso(d.createdAt),
  hasThumb: Boolean(d.hasThumb),
  ...(d.enc ? { enc: wrapsFor(d.enc, uid) } : {}), // an encrypted file: only my copies of the file key are sent
});

/** The files in the box, newest first, with how much room is left. */
safeboxRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const uid = uidOf(res);
    const items = (await safeboxItems(connection.id).get()).docs.map((d) => toItem(d.id, d.data(), uid)).sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
    const box: Safebox = { items, usedBytes: items.reduce((sum, i) => sum + i.bytes, 0), maxBytes: SAFEBOX_MAX_BYTES, maxFileBytes: MAX_FILE_BYTES };
    res.json(box);
  }),
);

/**
 * The keys in use of me and of my friend (a CONFIRMED friendship only, like the rest of the box): the app locks files only when both
 * of us have a key, and otherwise keeps storing them as before.
 */
safeboxRouter.get(
  "/keys",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const [mine, friend] = await Promise.all([publishedKeysOf(uidOf(res)), publishedKeysOf(connection.peerUid)]);
    res.json({ friendUid: connection.peerUid, mine, friend } satisfies BoxKeys);
  }),
);

type Connection = NonNullable<Awaited<ReturnType<typeof connectionOf>>>;

/**
 * Stores a checked file in the box (and its preview, when it has one) and answers with the new item, or answers with an error
 * (the box is full) and returns null.
 */
/** True when the box has room for a file of this many bytes; otherwise answers with an error (the box is full) and returns false. */
async function boxHasRoom(res: Response, connection: Connection, size: number): Promise<boolean> {
  const existing = (await safeboxItems(connection.id).select("bytes").get()).docs;
  if (existing.length >= SAFEBOX_MAX_ITEMS) {
    res.status(409).json({ error: `The safebox is full (at most ${SAFEBOX_MAX_ITEMS} files). Delete some first.` });
    return false;
  }
  if (existing.reduce((sum, d) => sum + (d.data().bytes as number), 0) + size > SAFEBOX_MAX_BYTES) {
    res.status(413).json({ error: `The safebox is full (at most ${Math.round(SAFEBOX_MAX_BYTES / 1024 / 1024)} MB). Delete some files first.` });
    return false;
  }
  return true;
}

async function storeInBox(res: Response, connection: Connection, bytes: Buffer, name: string, checked: { kind: SafeboxItem["kind"]; mime: string }, thumb: Buffer | null, originalSender: string | null = null): Promise<SafeboxItem | null> {
  if (!(await boxHasRoom(res, connection, bytes.length))) return null;
  const ref = safeboxItems(connection.id).doc();
  // the person who saves a file owns it: `addedBy` on the item and `savedBy` on the stored file (and on its preview) say whose it is, for the encryption to come
  const owner = uidOf(res);
  await putObject(boxOwner(connection.id), ref.id, bytes, checked.kind, checked.mime, name, owner);
  if (thumb) await putObject(boxOwner(connection.id), `${ref.id}.thumb`, thumb, "thumb", "image/jpeg", null, owner);
  await ref.set({ name, kind: checked.kind, mime: checked.mime, bytes: bytes.length, addedBy: owner, ...(originalSender ? { originalSender } : {}), hasThumb: Boolean(thumb), createdAt: FieldValue.serverTimestamp() });
  return toItem(ref.id, (await ref.get()).data()!, uidOf(res));
}

/**
 * Tell my friend that something was added to the box: an unread note "In the safebox" in both feeds (it shows on their home page
 * like a message does, and the conversation says it too), and a push that opens the box. Best effort: the file is in the box anyway.
 */
async function announceItem(res: Response, connection: Connection): Promise<void> {
  try {
    const uid = uidOf(res);
    const fromName = await nameOf(uid);
    const mine = messageCol(uid).doc();
    const theirs = messageCol(connection.peerUid).doc(mine.id);
    const common = { connectionId: connection.id, fromUid: uid, fromName, toUid: connection.peerUid, text: "", inBox: true, time: FieldValue.serverTimestamp() };
    const myEntry = (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);
    const batch = getFirestore().batch();
    batch.set(mine, { ...common, circleId: connection.circleId, read: true });
    batch.set(theirs, { ...common, circleId: connection.peerCircleId, read: false });
    touchFeed(batch, myEntry);
    await touchFeedIfExists(batch, circleCol(connection.peerUid).doc(connection.peerCircleId).collection(FRIENDS_SUBCOLLECTION).doc(connection.id));
    await batch.commit();
    await sendPush(connection.peerUid, { id: `message-${mine.id}`, title: fromName, body: "📦 Added to the safebox", url: `/friends/${connection.id}/safebox`, kind: "message" });
  } catch (err) {
    console.error("Could not announce the safebox item", err);
  }
}

/** Put a file in the box: `POST .../safebox?name=<file name>`, the file as the body. Answers with the new item. */
safeboxRouter.post(
  "/",
  fileBody,
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const checked = checkSafeboxFile(bytes, MAX_FILE_BYTES);
    if ("error" in checked) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    const item = await storeInBox(res, connection, bytes, cleanFileName(req.query.name) ?? "File", checked, null);
    if (item) {
      await announceItem(res, connection);
      res.status(201).json(item);
    }
  }),
);

/**
 * Put an ENCRYPTED file in the box: `POST .../safebox/encrypted`, the body is the header, the encrypted file and its preview (see EncryptedUploadHeader).
 * The server cannot look inside: it checks the shape, the size, and that the file key is locked for every key in use of both friends. It stores
 * the ciphertext as it is, and no file name (the name is inside `enc.meta`). Answers with the new item.
 */
safeboxRouter.post(
  "/encrypted",
  encryptedBody,
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const upload = parseEncryptedUpload(Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), MAX_FILE_BYTES);
    if ("error" in upload) {
      res.status(upload.status).json({ error: upload.error });
      return;
    }
    const owner = uidOf(res);
    const [mine, friend] = await Promise.all([publishedKeysOf(owner), publishedKeysOf(connection.peerUid)]);
    if (!wrapsCover(upload.header.enc, [{ uid: owner, keys: mine }, { uid: connection.peerUid, keys: friend }])) {
      res.status(409).json({ error: "The encryption keys changed while the file was sent. Try again." });
      return;
    }
    if (!(await boxHasRoom(res, connection, upload.file.length))) return;
    const ref = safeboxItems(connection.id).doc();
    const { kind, enc } = upload.header;
    await putObject(boxOwner(connection.id), ref.id, upload.file, kind, "application/octet-stream", null, owner);
    if (upload.thumb) await putObject(boxOwner(connection.id), `${ref.id}.thumb`, upload.thumb, "thumb", "application/octet-stream", null, owner);
    await ref.set({ name: "Encrypted file", kind, mime: "application/octet-stream", bytes: upload.file.length, addedBy: owner, hasThumb: Boolean(upload.thumb), enc, createdAt: FieldValue.serverTimestamp() });
    await announceItem(res, connection);
    res.status(201).json(toItem(ref.id, (await ref.get()).data()!, owner));
  }),
);

/**
 * MOVE the picture or video of a message of this conversation into the box: `POST .../safebox/from-message` `{ messageId }`.
 * Either friend may, whoever sent it (the box is shared: both find the file there). The message stays in both feeds with
 * `inBox: true` and no file, so the conversation only says it is in the safebox; the file leaves the conversation.
 * Answers with the new item.
 */
safeboxRouter.post(
  "/from-message",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const messageId = req.body?.messageId;
    const message = isObjectId(messageId) ? (await messageCol(uidOf(res)).doc(messageId).get()).data() : undefined;
    const media = message?.connectionId === connection.id ? (message.media as MediaRef | undefined) : undefined;
    if (!media || (media.kind !== "image" && media.kind !== "video")) {
      res.status(404).json({ error: "That message has no picture or video" });
      return;
    }
    if (media.bytes > MAX_FILE_BYTES) {
      res.status(413).json({ error: `That file is too big for the safebox (at most ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)` });
      return;
    }
    const bytes = await readAll(media.ownerId, media.objectId);
    if (!bytes) {
      res.status(404).json({ error: "The file is gone" });
      return;
    }
    const checked = checkSafeboxFile(bytes, MAX_FILE_BYTES);
    if ("error" in checked) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    const thumb = media.hasThumb ? await readAll(media.ownerId, `${media.objectId}.thumb`) : null;
    const item = await storeInBox(res, connection, bytes, cleanFileName(media.name) ?? (media.kind === "video" ? "Video" : "Picture"), checked, thumb, media.ownerId); // moved from a message: whoever moves it owns it in the box; who sent it is kept as `originalSender`
    if (!item) return;
    // both copies of the message lose the file and say where it went; both friends' apps reload the feed
    const moved = { media: FieldValue.delete(), inBox: true };
    const myEntry = (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);
    const batch = getFirestore().batch();
    const fromName = await nameOf(uidOf(res));
    batch.update(messageCol(uidOf(res)).doc(messageId), moved);
    const theirs = messageCol(connection.peerUid).doc(messageId);
    if ((await theirs.get()).exists) batch.update(theirs, { ...moved, read: false, fromName }); // my friend is told: unread again, on the home page too
    touchFeed(batch, myEntry);
    await touchFeedIfExists(batch, circleCol(connection.peerUid).doc(connection.peerCircleId).collection(FRIENDS_SUBCOLLECTION).doc(connection.id));
    await batch.commit();
    await deleteObject(media.ownerId, media.objectId); // the file (and its preview) now lives in the box only
    await sendPush(connection.peerUid, { id: `message-${messageId}-box`, title: fromName, body: "📦 Moved to the safebox", url: `/friends/${connection.id}/safebox`, kind: "message" });
    res.status(201).json(item);
  }),
);

/** The item `:itemId` of this box, or answers "not found" and returns null (also for an id that is not valid). */
async function itemOf(req: Request, res: Response, connectionId: string) {
  const snap = isObjectId(req.params.itemId) ? await safeboxItems(connectionId).doc(req.params.itemId).get() : null;
  if (!snap?.exists) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return { ref: snap.ref, id: snap.id, data: snap.data()! };
}

/** Add the small preview to an image or a video in the box: `PUT .../safebox/<id>/thumb`, the picture as the body. */
safeboxRouter.put(
  "/:itemId/thumb",
  fileBody,
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const item = await itemOf(req, res, connection.id);
    if (!item) return;
    if (item.data.kind !== "image" && item.data.kind !== "video") {
      res.status(400).json({ error: "A preview is for an image or a video" });
      return;
    }
    if (item.data.enc) {
      res.status(400).json({ error: "The preview of an encrypted file is sent with the file" });
      return;
    }
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const checked = checkBytes("thumb", bytes);
    if ("error" in checked) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    await putObject(boxOwner(connection.id), `${item.id}.thumb`, bytes, "thumb", checked.mime, null, item.data.addedBy as string); // the preview belongs to whoever owns the file
    await item.ref.update({ hasThumb: true });
    res.status(204).end();
  }),
);

/** Change the name of a file: `{ name }`. Either friend may. */
safeboxRouter.put(
  "/:itemId",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const item = await itemOf(req, res, connection.id);
    if (!item) return;
    if (item.data.enc) {
      // an encrypted file is renamed on the device: the new name comes locked with the file key of the file (`{ metaIv, meta }`)
      const { metaIv, meta } = (req.body ?? {}) as { metaIv?: unknown; meta?: unknown };
      const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
      if (typeof metaIv !== "string" || metaIv.length !== 16 || !base64.test(metaIv) || typeof meta !== "string" || meta.length > 1500 || !base64.test(meta)) {
        res.status(400).json({ error: "Those names are not valid" });
        return;
      }
      const enc = { ...item.data.enc, metaIv, meta };
      await item.ref.update({ enc });
      res.json(toItem(item.id, { ...item.data, enc }, uidOf(res)));
      return;
    }
    const name = cleanFileName(req.body?.name);
    if (!name) {
      res.status(400).json({ error: "Give the file a name" });
      return;
    }
    await item.ref.update({ name });
    res.json(toItem(item.id, { ...item.data, name }, uidOf(res)));
  }),
);

/** Take a file out of the box, for both friends. */
safeboxRouter.delete(
  "/:itemId",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const item = await itemOf(req, res, connection.id);
    if (!item) return;
    await deleteObject(boxOwner(connection.id), item.id);
    await item.ref.delete();
    res.status(204).end();
  }),
);

/** The file itself (or its preview, `/thumb`): the bytes, with their type and name. Only the two friends get it. */
async function sendFile(req: Request, res: Response, thumb: boolean): Promise<void> {
  const connection = await connectionOf(req, res);
  if (!connection) return;
  const item = await itemOf(req, res, connection.id);
  if (!item) return;
  const objectName = thumb ? `${item.id}.thumb` : item.id;
  const info = await objectInfo(boxOwner(connection.id), objectName);
  if (!info) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const attachment = Boolean(item.data.enc) || (!thumb && item.data.kind === "document" && item.data.mime !== "application/pdf" && !String(item.data.mime).startsWith("text/"));
  const fileName = thumb || item.data.enc ? objectName : (item.data.name as string); // an encrypted file has no readable name on the server
  const etag = `"${objectName}-${info.bytes}"`; // a file never changes under its id
  res.set({
    "Content-Type": info.mime,
    "Content-Length": String(info.bytes),
    "Content-Disposition": `${attachment ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "private, max-age=31536000, immutable",
    ETag: etag,
    "X-Content-Type-Options": "nosniff",
  });
  if (req.header("If-None-Match") === etag) {
    res.status(304).end();
    return;
  }
  const stream = readObject(boxOwner(connection.id), objectName);
  stream.on("error", (err) => {
    console.error(`Could not read safebox file ${connection.id}/${objectName}`, err);
    res.destroy();
  });
  stream.pipe(res);
}
safeboxRouter.get("/:itemId/thumb", asyncHandler((req, res) => sendFile(req, res, true)));
safeboxRouter.get("/:itemId", asyncHandler((req, res) => sendFile(req, res, false)));

/** The whole box of a friendship goes: the list and the files (when the friendship ends or an account is erased). Never raises. */
export async function deleteBox(connectionId: string): Promise<void> {
  try {
    const docs = await safeboxItems(connectionId).select().get();
    await Promise.all(docs.docs.map((d) => d.ref.delete()));
  } catch (err) {
    console.error(`Could not delete the safebox list of ${connectionId}`, err);
  }
  await deleteFolder(boxOwner(connectionId));
}
