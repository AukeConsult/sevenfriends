import express, { Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { FRIENDS_SUBCOLLECTION, MAX_UPLOAD_BYTES, SAFEBOX_MAX_BYTES, SAFEBOX_MAX_ITEMS, boxOwner } from "./constants";
import { connectionOf } from "./conversation";
import { MediaRef, Safebox, SafeboxItem } from "./models";
import { circleCol, messageCol, safeboxItems } from "./paths";
import { touchFeed, touchFeedIfExists } from "./sync";
import { checkBytes, checkSafeboxFile, cleanFileName, deleteFolder, deleteObject, isObjectId, objectInfo, putObject, readAll, readObject } from "./sf-cache";

const uidOf = (res: Response) => (res.locals.token as DecodedIdToken).uid;
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);
/** One file may be as big as one upload request allows. */
const MAX_FILE_BYTES = MAX_UPLOAD_BYTES;
/** The file comes as the plain request body (the type is found from the first bytes, not from the header). */
const fileBody = express.raw({ type: () => true, limit: MAX_FILE_BYTES });

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
  mine: d.addedBy === uid,
  createdAt: iso(d.createdAt),
  hasThumb: Boolean(d.hasThumb),
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

type Connection = NonNullable<Awaited<ReturnType<typeof connectionOf>>>;

/**
 * Stores a checked file in the box (and its preview, when it has one) and answers with the new item, or answers with an error
 * (the box is full) and returns null.
 */
async function storeInBox(res: Response, connection: Connection, bytes: Buffer, name: string, checked: { kind: SafeboxItem["kind"]; mime: string }, thumb: Buffer | null): Promise<SafeboxItem | null> {
  const existing = (await safeboxItems(connection.id).get()).docs;
  if (existing.length >= SAFEBOX_MAX_ITEMS) {
    res.status(409).json({ error: `The safebox is full (at most ${SAFEBOX_MAX_ITEMS} files). Delete some first.` });
    return null;
  }
  if (existing.reduce((sum, d) => sum + (d.data().bytes as number), 0) + bytes.length > SAFEBOX_MAX_BYTES) {
    res.status(413).json({ error: `The safebox is full (at most ${Math.round(SAFEBOX_MAX_BYTES / 1024 / 1024)} MB). Delete some files first.` });
    return null;
  }
  const ref = safeboxItems(connection.id).doc();
  await putObject(boxOwner(connection.id), ref.id, bytes, checked.kind, checked.mime, name);
  if (thumb) await putObject(boxOwner(connection.id), `${ref.id}.thumb`, thumb, "thumb", "image/jpeg");
  await ref.set({ name, kind: checked.kind, mime: checked.mime, bytes: bytes.length, addedBy: uidOf(res), hasThumb: Boolean(thumb), createdAt: FieldValue.serverTimestamp() });
  return toItem(ref.id, (await ref.get()).data()!, uidOf(res));
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
    if (item) res.status(201).json(item);
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
    const item = await storeInBox(res, connection, bytes, cleanFileName(media.name) ?? (media.kind === "video" ? "Video" : "Picture"), checked, thumb);
    if (!item) return;
    // both copies of the message lose the file and say where it went; both friends' apps reload the feed
    const moved = { media: FieldValue.delete(), inBox: true };
    const myEntry = (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);
    const batch = getFirestore().batch();
    batch.update(messageCol(uidOf(res)).doc(messageId), moved);
    const theirs = messageCol(connection.peerUid).doc(messageId);
    if ((await theirs.get()).exists) batch.update(theirs, moved);
    touchFeed(batch, myEntry);
    await touchFeedIfExists(batch, circleCol(connection.peerUid).doc(connection.peerCircleId).collection(FRIENDS_SUBCOLLECTION).doc(connection.id));
    await batch.commit();
    await deleteObject(media.ownerId, media.objectId); // the file (and its preview) now lives in the box only
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
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const checked = checkBytes("thumb", bytes);
    if ("error" in checked) {
      res.status(checked.status).json({ error: checked.error });
      return;
    }
    await putObject(boxOwner(connection.id), `${item.id}.thumb`, bytes, "thumb", checked.mime);
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
  const attachment = !thumb && item.data.kind === "document" && item.data.mime !== "application/pdf" && !String(item.data.mime).startsWith("text/");
  const fileName = thumb ? objectName : (item.data.name as string);
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
    const docs = await safeboxItems(connectionId).get();
    await Promise.all(docs.docs.map((d) => d.ref.delete()));
  } catch (err) {
    console.error(`Could not delete the safebox list of ${connectionId}`, err);
  }
  await deleteFolder(boxOwner(connectionId));
}
