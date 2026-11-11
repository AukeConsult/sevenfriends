import express, { Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAX_UPLOAD_BYTES, SAFEBOX_MAX_BYTES, SAFEBOX_MAX_ITEMS, SAFEBOX_REMINDERS, boxOwner } from "./constants";
import { Peer, connectionOf, peerEntryRef, peerSleeps } from "./conversation";
import { ALBUM_PICTURES_MAX, ATTACHMENTS_MAX, CASE_DOCUMENTS_MAX, BoxKeys, DeviceList, PersonKeyLists, ENC_HEADER_MAX, GroupShareItem, MediaRef, SAFEBOX_OBJECT_TYPES, Safebox, SafeboxItem } from "./models";
import { MAX_WRAPS, ParsedReminder, lockedBytes, objectBytes, parseEncryptedUpload, parseNewObject, parseObjectChange, wrapValid, wrapsCover, wrapsFor } from "./box-encryption";
import { publishedKeysOf } from "./keys";
import { circleCol, keyListCol, messageCol, safeboxItems, userFields } from "./paths";
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

/**
 * Who may change or take out an item. For now BOTH friends may change or delete ANY item (a file or an object); the owner is kept on every item
 * (`addedBy`) so a rule such as "only the owner" can be added here, in one place, when it is decided.
 */
const canChange = (_item: FirebaseFirestore.DocumentData, _uid: string): boolean => true;

/** An object (a note ...) has no stored file; an item without a type is a file (everything from before there were types). */
const isObject = (d: FirebaseFirestore.DocumentData): boolean => SAFEBOX_OBJECT_TYPES.includes(d.type);

const toItem = (id: string, d: FirebaseFirestore.DocumentData, uid: string): SafeboxItem => ({
  id,
  type: d.type ?? "file",
  revision: (d.revision as number | undefined) ?? 1,
  updatedAt: iso(d.updatedAt),
  name: d.name as string,
  kind: d.kind,
  mime: d.mime as string,
  bytes: d.bytes as number,
  ownerId: d.addedBy as string,
  mine: d.addedBy === uid,
  createdAt: iso(d.createdAt),
  parentId: (d.parentId as string | undefined) ?? null,
  hasThumb: Boolean(d.hasThumb),
  order: (d.order as number | undefined) ?? null,
  ...(d.enc ? { enc: wrapsFor(d.enc, uid) } : {}), // an encrypted file: only my copies of the file key are sent
});

/**
 * What the list asks of each item: everything but the whole content of an object (`enc.body`: it is read when the item is opened, see
 * `GET /items/:itemId`). Firestore sends only these fields.
 */
const LIST_FIELDS = ["type", "revision", "updatedAt", "name", "kind", "mime", "bytes", "addedBy", "circles", "createdAt", "parentId", "hasThumb", "order", "enc.v", "enc.iv", "enc.metaIv", "enc.meta", "enc.thumbIv", "enc.wraps", "enc.bodyIv"];

/** An item that stands on its own has a number; an attachment and a link between two items do not. */
const isNumbered = (i: { parentId: string | null; type: string }): boolean => !i.parentId && i.type !== "relation";

/** Writes `order` on the items in the given order (1, 2, 3 ...), in batches. */
async function writeOrder(connectionId: string, ids: string[], only?: Set<string>): Promise<void> {
  const todo = ids.map((id, i) => ({ id, order: i + 1 })).filter((x) => !only || only.has(x.id));
  for (let from = 0; from < todo.length; from += 400) {
    const batch = getFirestore().batch();
    for (const x of todo.slice(from, from + 400)) batch.update(safeboxItems(connectionId).doc(x.id), { order: x.order });
    await batch.commit();
  }
}

/**
 * The list in the order of the numbers. Items from before there were numbers, a gap left by a deleted item and two items with the same number
 * are put right here: the items are numbered 1, 2, 3 ... (an item without a number comes after the numbered ones, oldest first) and the new
 * numbers are stored. Numbering is best effort: if the write fails the list is still returned numbered.
 */
async function numberItems(connectionId: string, items: SafeboxItem[]): Promise<SafeboxItem[]> {
  const top = items.filter(isNumbered).sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity) || (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
  const changed = new Set(top.filter((item, i) => item.order !== i + 1).map((item) => item.id));
  top.forEach((item, i) => (item.order = i + 1));
  if (changed.size) await writeOrder(connectionId, top.map((item) => item.id), changed).catch(() => undefined);
  return [...top, ...items.filter((i) => !isNumbered(i)).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""))];
}

/** The number a new item gets: one more than the biggest (and than how many there are, for items that have none yet). */
async function nextOrder(connectionId: string): Promise<number> {
  const top = (await safeboxItems(connectionId).select("order", "parentId", "type").get()).docs.map((d) => d.data()).filter((d) => !d.parentId && d.type !== "relation");
  return Math.max(top.length, ...top.map((d) => (d.order as number | undefined) ?? 0)) + 1;
}

/** The files in the box, in the order of their numbers, with how much room is left. */
safeboxRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const uid = uidOf(res);
    const found = (await safeboxItems(connection.id).select(...LIST_FIELDS).get()).docs.filter((d) => inCircle(d.data(), uid, connection.circleId)).map((d) => toItem(d.id, d.data(), uid));
    const items = await numberItems(connection.id, found);
    const box: Safebox = { items, usedBytes: items.reduce((sum, i) => sum + i.bytes, 0), maxBytes: SAFEBOX_MAX_BYTES, maxFileBytes: MAX_FILE_BYTES };
    res.json(box);
  }),
);

/**
 * The new order of the items, as the ids of the items (dragged in the app): they get the numbers 1, 2, 3 ... in that order. An item that is not
 * named keeps its place after the named ones. Both friends may do it.
 */
safeboxRouter.put(
  "/order",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const uid = uidOf(res);
    const ids = (req.body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || ids.length > 5000 || ids.some((id) => typeof id !== "string")) {
      res.status(400).json({ error: "Send the ids of the items in their new order." });
      return;
    }
    const docs = (await safeboxItems(connection.id).select("parentId", "type", "circles", "order").get()).docs.filter((d) => inCircle(d.data(), uid, connection.circleId) && !d.data().parentId && d.data().type !== "relation");
    const known = new Set(docs.map((d) => d.id));
    const named = [...new Set(ids as string[])].filter((id) => known.has(id));
    const rest = docs.filter((d) => !named.includes(d.id)).sort((a, b) => ((a.data().order as number | undefined) ?? Infinity) - ((b.data().order as number | undefined) ?? Infinity)).map((d) => d.id);
    await writeOrder(connection.id, [...named, ...rest]);
    res.status(204).end();
  }),
);

/**
 * The signed device lists (every version, oldest first) of every OTHER person of this connection (a CONFIRMED friendship or group only):
 * the app pins them and checks the chain and the signatures of messages and items against them (docs/design/default-key.md).
 * The server only hands them over; a list it changed or made up fails the check on the device.
 */
safeboxRouter.get(
  "/key-lists",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const people: PersonKeyLists[] = await Promise.all(
      connection.peers.map(async (peer) => {
        const snap = await keyListCol(peer.uid).get();
        const lists = snap.docs.map((d) => {
          const { version, devices, prev, signedBy, signature, since } = d.data() as DeviceList;
          return { version, devices, prev, signedBy, signature, ...(since ? { since } : {}) } satisfies DeviceList;
        });
        return { uid: peer.uid, lists: lists.sort((a, b) => a.version - b.version) };
      }),
    );
    res.json({ people });
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
    const [mine, others] = await Promise.all([
      publishedKeysOf(uidOf(res)),
      Promise.all(
        connection.peers.map(async (peer) => ({
          uid: peer.uid,
          name: connection.group ? (((await userFields(peer.uid, "displayName"))?.displayName as string | undefined) ?? "Someone") : connection.name,
          keys: await publishedKeysOf(peer.uid),
        })),
      ),
    ]);
    // a friendship: `friendUid` and `friend` as before (and the friend is the one entry of `others`); a group: only `others`
    res.json({ friendUid: connection.group ? "" : connection.peerUid, mine, friend: connection.group ? [] : (others[0]?.keys ?? []), others } satisfies BoxKeys);
  }),
);

type Connection = NonNullable<Awaited<ReturnType<typeof connectionOf>>>;

const hasCopy = (wraps: { uid: string; keyId: string }[], uid: string, keyId: string): boolean => wraps.some((w) => w.uid === uid && w.keyId === keyId);
const SHARE_MAX_ITEMS = 100;

/**
 * A group's box, for the members' devices: which items still lack a copy of their key for a key in use of a member (somebody joined, somebody made a new key), with MY copies of
 * each (my device can open those) and the keys to give one. A member's device does this by itself when the group is opened (design: docs/design/groups.md, "History in the safebox").
 */
safeboxRouter.get(
  "/share-todo",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    if (!connection.group) {
      res.status(404).json({ error: "Only a group shares its box this way" });
      return;
    }
    const me = uidOf(res);
    const people = await peopleOf(connection, me);
    const items: GroupShareItem[] = [];
    for (const d of (await safeboxItems(connection.id).select("enc").get()).docs) {
      const wraps = (d.data().enc?.wraps ?? []) as { uid: string; keyId: string; wrappedKey: string }[];
      if (!wraps.length) continue; // an item made before locking: nothing to copy
      const missing = people.flatMap((p) => p.keys.filter((k) => !hasCopy(wraps, p.uid, k.id)).map((k) => ({ uid: p.uid, keyId: k.id })));
      const mine = wraps.filter((w) => w.uid === me);
      if (missing.length && mine.length) items.push({ id: d.id, wraps: mine, missing });
      if (items.length >= SHARE_MAX_ITEMS) break;
    }
    res.json({ items });
  }),
);

/**
 * The new copies: `{ items: [{ id, wraps: [wrap] }] }`. A copy is accepted only for a member of the group and one of that member's keys in use; it is added to the item when
 * the item has no copy for that key yet. Nothing is ever taken away here. Answers how many items got something.
 */
safeboxRouter.post(
  "/share",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    if (!connection.group) {
      res.status(404).json({ error: "Only a group shares its box this way" });
      return;
    }
    const people = await peopleOf(connection, uidOf(res));
    const given: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!given.length || given.length > SHARE_MAX_ITEMS) {
      res.status(400).json({ error: `Send between 1 and ${SHARE_MAX_ITEMS} items` });
      return;
    }
    const items = given as { id?: unknown; wraps?: unknown }[];
    for (const i of items) {
      const wraps = Array.isArray(i?.wraps) ? (i.wraps as unknown[]) : [];
      const fits = wraps.every((w) => wrapValid(w) && people.some((p) => p.uid === w.uid && p.keys.some((k) => k.id === w.keyId)));
      if (typeof i?.id !== "string" || !isObjectId(i.id) || !wraps.length || wraps.length > MAX_WRAPS || !fits) {
        res.status(400).json({ error: "That is not a copy of a key for a key of a member of the group" });
        return;
      }
    }
    const refs = items.map((i) => safeboxItems(connection.id).doc(i.id as string));
    const snaps = await getFirestore().getAll(...refs, { fieldMask: ["enc"] });
    const batch = getFirestore().batch();
    let added = 0;
    snaps.forEach((snap, n) => {
      const wraps = snap.data()?.enc?.wraps as { uid: string; keyId: string; wrappedKey: string }[] | undefined;
      if (!Array.isArray(wraps)) return;
      const fresh = (items[n].wraps as { uid: string; keyId: string; wrappedKey: string }[]).filter((w) => !hasCopy(wraps, w.uid, w.keyId)).map((w) => ({ uid: w.uid, keyId: w.keyId, wrappedKey: w.wrappedKey }));
      if (!fresh.length) return;
      batch.update(snap.ref, { "enc.wraps": [...wraps, ...fresh] });
      added++;
    });
    if (added) await batch.commit();
    res.json({ added });
  }),
);

/** Which circle each of the two friends has this friendship in, written on every file: a file never belongs to more than the friendship of its two circles, and cannot show up in another one. */
const circlesOf = (connection: Connection, me: string): Record<string, string> => ({ [me]: connection.circleId, ...Object.fromEntries(connection.peers.map((peer) => [peer.uid, peer.circleId])) });

/** Me and the other people of the connection with the keys each has in use: what a locked file, item or message must carry a copy of the key for (`wrapsCover`). */
const peopleOf = (connection: Connection, me: string): Promise<{ uid: string; keys: Awaited<ReturnType<typeof publishedKeysOf>> }[]> =>
  Promise.all([me, ...connection.peers.map((peer) => peer.uid)].map(async (uid) => ({ uid, keys: await publishedKeysOf(uid) })));

/** True when the file belongs to the circle I am looking from (a file stored before circles were written down counts as the default circle). */
const inCircle = (data: FirebaseFirestore.DocumentData, uid: string, circleId: string): boolean => ((data.circles as Record<string, string> | undefined)?.[uid] ?? DEFAULT_CIRCLE_ID) === circleId;

/**
 * Stores a checked file in the box (and its preview, when it has one) and answers with the new item, or answers with an error
 * (the box is full) and returns null.
 */
/** True when the box has room for a file of this many bytes; otherwise answers with an error (the box is full) and returns false. */
async function boxHasRoom(res: Response, connection: Connection, size: number, replacing: string | null = null): Promise<boolean> {
  const existing = (await safeboxItems(connection.id).select("bytes").get()).docs.filter((d) => d.id !== replacing); // a file that is being replaced does not count
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
  await ref.set({ name, kind: checked.kind, mime: checked.mime, bytes: bytes.length, addedBy: owner, circles: circlesOf(connection, owner), ...(originalSender ? { originalSender } : {}), hasThumb: Boolean(thumb), order: await nextOrder(connection.id), createdAt: FieldValue.serverTimestamp() });
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
    if (item) {
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
    const me = uidOf(res);
    if (!wrapsCover(upload.header.enc, await peopleOf(connection, me))) {
      res.status(409).json({ error: "The encryption keys changed while the file was sent. Try again." });
      return;
    }
    // `?parent=<object id>`: this locked file is an ATTACHMENT of that object (at most ATTACHMENTS_MAX; an album holds only pictures and videos, up to ALBUM_PICTURES_MAX)
    let parent: { ref: DocumentReference; id: string; data: FirebaseFirestore.DocumentData } | null = null;
    if (req.query.parent !== undefined) {
      if (req.query.replaces !== undefined) {
        res.status(400).json({ error: "An attachment does not replace a file" });
        return;
      }
      parent = await itemById(res, connection.id, req.query.parent);
      if (!parent) return;
      if (!isObject(parent.data)) {
        res.status(400).json({ error: "Only an object can have attachments" });
        return;
      }
      const album = parent.data.type === "album";
      if (album && upload.header.kind !== "image" && upload.header.kind !== "video") {
        res.status(400).json({ error: "An album holds only pictures and videos" });
        return;
      }
      const max = album ? ALBUM_PICTURES_MAX : parent.data.type === "case" ? CASE_DOCUMENTS_MAX : ATTACHMENTS_MAX;
      if ((await safeboxItems(connection.id).where("parentId", "==", parent.id).count().get()).data().count >= max) {
        res.status(409).json({ error: `At most ${max} ${album ? "pictures and videos" : "attachments"} on one item` });
        return;
      }
    }
    // `?replaces=<item id>`: this locked file takes the place of a plain file of the box (the app locks the files that were put in before the keys)
    let old: { ref: DocumentReference; id: string; data: FirebaseFirestore.DocumentData } | null = null;
    if (req.query.replaces !== undefined) {
      old = await itemById(res, connection.id, req.query.replaces);
      if (!old) return;
      if (old.data.enc) {
        res.status(409).json({ error: "That file is already encrypted" });
        return;
      }
    }
    if (!(await boxHasRoom(res, connection, upload.file.length, old?.id ?? null))) return;
    const ref = safeboxItems(connection.id).doc();
    const { kind, enc } = upload.header;
    const replaced = old ? { ...(old.data.order ? { order: old.data.order } : {}), createdAt: old.data.createdAt ?? FieldValue.serverTimestamp(), ...(old.data.originalSender ? { originalSender: old.data.originalSender } : {}) } : null; // it keeps the owner, the date and who first sent it
    const owner = (old?.data.addedBy as string | undefined) ?? me;
    const name = boxOwner(connection.id);
    await putObject(name, ref.id, upload.file, kind, "application/octet-stream", null, owner);
    if (upload.thumb) await putObject(name, `${ref.id}.thumb`, upload.thumb, "thumb", "application/octet-stream", null, owner);
    const fields = { name: "Encrypted file", kind, mime: "application/octet-stream", bytes: upload.file.length, addedBy: owner, circles: circlesOf(connection, owner), hasThumb: Boolean(upload.thumb), enc, ...(parent ? { parentId: parent.id } : {}), ...(replaced ?? { createdAt: FieldValue.serverTimestamp() }), ...(!parent && !old ? { order: await nextOrder(connection.id) } : {}) };
    if (old) {
      // ONE atomic step: the locked item appears and the plain item goes in the same transaction (it still must be there and still plain), so the
      // list never shows both or neither. If it fails, the locked file just stored is taken away again and the plain file stays.
      const oldRef = old.ref;
      try {
        await getFirestore().runTransaction(async (tx) => {
          const current = await tx.get(oldRef);
          if (!current.exists || current.data()?.enc) throw new Error("replaced");
          tx.set(ref, fields);
          tx.delete(oldRef);
        });
      } catch (err) {
        await deleteObject(name, ref.id);
        if (err instanceof Error && err.message === "replaced") {
          res.status(409).json({ error: "That file was changed meanwhile" });
          return;
        }
        throw err;
      }
      await deleteObject(name, old.id).catch((err) => console.error(`Could not delete the plain file ${connection.id}/${old.id}`, err)); // the list no longer has it; only the stored bytes are left to clean up
    } else {
      await ref.set(fields);
    }
    res.status(201).json(toItem(ref.id, (await ref.get()).data()!, me));
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
    if (message?.enc?.media) {
      res.status(409).json({ error: "This picture or video is locked. It cannot be moved to the safebox yet." }); // the server cannot read it; moving a locked file is not built yet
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
    const fromName = await nameOf(uidOf(res), undefined, connection.circleId);
    batch.update(messageCol(uidOf(res)).doc(messageId), moved);
    for (const peer of connection.peers) {
      const theirs = messageCol(peer.uid).doc(messageId);
      if ((await theirs.get()).exists) batch.update(theirs, { ...moved, read: false, fromName }); // my friend is told: unread again, on the home page too
    }
    touchFeed(batch, myEntry);
    for (const peer of connection.peers) await touchFeedIfExists(batch, peerEntryRef(connection, peer));
    await batch.commit();
    await deleteObject(media.ownerId, media.objectId); // the file (and its preview) now lives in the box only
    for (const peer of connection.peers as Peer[]) {
      if (!(await peerSleeps(connection, peer))) await sendPush(peer.uid, { circleId: peer.circleId, id: `message-${messageId}-box`, title: fromName, body: "📦 Moved to the safebox", url: `/friends/${connection.id}/safebox`, kind: "message" });
    }
    res.status(201).json(item);
  }),
);

/** The item `:itemId` of this box, or answers "not found" and returns null (also for an id that is not valid). */
async function itemOf(req: Request, res: Response, connectionId: string) {
  return itemById(res, connectionId, req.params.itemId);
}

async function itemById(res: Response, connectionId: string, itemId: unknown) {
  const snap = isObjectId(itemId) ? await safeboxItems(connectionId).doc(itemId).get() : null;
  if (!snap?.exists) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return { ref: snap.ref, id: snap.id, data: snap.data()! };
}

const reminderRef = (connectionId: string, itemId: string) => getFirestore().collection(SAFEBOX_REMINDERS).doc(`${connectionId}_${itemId}`);

/**
 * The reminder of an object with a time (a date, a ticket): the moment to push and who gets it, kept in `safebox-reminders` (the server cannot read the
 * object, so this moment is all it knows). `undefined` = leave as it is; `null`, or a moment that has passed already, = none (a reminder is never sent late
 * for an event saved after its lead time). The sender is `sendDueReminders` (safebox-reminders.ts).
 */
async function setReminder(connection: Connection, itemId: string, me: string, remind: ParsedReminder | null | undefined): Promise<void> {
  if (remind === undefined) return;
  const ref = reminderRef(connection.id, itemId);
  if (remind === null || remind.at.getTime() <= Date.now()) {
    await ref.delete();
    return;
  }
  const targets = [{ uid: me, circleId: connection.circleId, friendUid: connection.peerUid }, ...(remind.both ? connection.peers.map((peer) => ({ uid: peer.uid, circleId: peer.circleId, friendUid: me })) : [])];
  await ref.set({ connectionId: connection.id, itemId, at: Timestamp.fromMillis(remind.at.getTime()), targets, setBy: me });
}

/**
 * Put an OBJECT in the box (a note ...): `POST .../safebox/items` `{ type, enc }`, the content locked on the device (`enc.meta` is the locked payload).
 * The server cannot look inside: it checks the type, the shape, the size, and that the key is locked for every key in use of both friends. There is no
 * file and no preview; the locked payload counts in the box. Answers with the new item.
 */
safeboxRouter.post(
  "/items",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const parsed = parseNewObject(req.body);
    if ("error" in parsed) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }
    const me = uidOf(res);
    if (!wrapsCover(parsed.enc, await peopleOf(connection, me))) {
      res.status(409).json({ error: "The encryption keys changed while the item was sent. Try again." });
      return;
    }
    const bytes = objectBytes(parsed.enc);
    if (!(await boxHasRoom(res, connection, bytes))) return;
    const ref = safeboxItems(connection.id).doc();
    await ref.set({ type: parsed.type, name: "Encrypted item", kind: "document", mime: "application/octet-stream", bytes, addedBy: me, circles: circlesOf(connection, me), hasThumb: false, enc: parsed.enc, revision: 1, ...(parsed.type === "relation" ? {} : { order: await nextOrder(connection.id) }), createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
    await setReminder(connection, ref.id, me, parsed.remind);
    res.status(201).json(toItem(ref.id, (await ref.get()).data()!, me));
  }),
);

/**
 * Change an OBJECT: `PUT .../safebox/items/:id` `{ revision, metaIv, meta }`, the new locked content and the revision the app started from. If the other
 * friend saved in between the revision is not the current one: 409, and the app reads the item again. The key and its copies stay as they are.
 */
safeboxRouter.get(
  "/items/:itemId",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const item = await itemOf(req, res, connection.id);
    if (!item) return;
    res.json(toItem(item.id, item.data, uidOf(res))); // the whole item, with the content of an object
  }),
);

safeboxRouter.put(
  "/items/:itemId",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const item = await itemOf(req, res, connection.id);
    if (!item) return;
    if (!isObject(item.data) || !item.data.enc) {
      res.status(400).json({ error: "That item is not an object" });
      return;
    }
    if (!canChange(item.data, uidOf(res))) {
      res.status(403).json({ error: "You cannot change this item" });
      return;
    }
    const change = parseObjectChange(req.body);
    if ("error" in change) {
      res.status(change.status).json({ error: change.error });
      return;
    }
    const bytes = objectBytes({ meta: change.meta, body: change.body });
    // the new size must fit (the old content of this object does not count)
    if (!(await boxHasRoom(res, connection, bytes, item.id))) return;
    let saved: FirebaseFirestore.DocumentData | null = null;
    await getFirestore().runTransaction(async (tx) => {
      const current = await tx.get(item.ref);
      const data = current.data();
      if (!data || ((data.revision as number | undefined) ?? 1) !== change.revision) return; // somebody else saved first (or it is gone): saved stays null
      const { body: _oldBody, bodyIv: _oldBodyIv, ...kept } = data.enc; // the content comes from this change, an older app sends it whole in `meta`
      saved = { ...data, enc: { ...kept, iv: change.metaIv, metaIv: change.metaIv, meta: change.meta, ...(change.body ? { bodyIv: change.bodyIv, body: change.body } : {}) }, bytes, revision: change.revision + 1, updatedAt: Timestamp.now() };
      tx.update(item.ref, { enc: saved.enc, bytes, revision: saved.revision, updatedAt: FieldValue.serverTimestamp() });
    });
    if (!saved) {
      res.status(409).json({ error: "This item was changed by your friend. Open it again to see the new version." });
      return;
    }
    await setReminder(connection, item.id, uidOf(res), change.remind);
    res.json(toItem(item.id, saved, uidOf(res)));
  }),
);

/**
 * Lock an OBJECT anew (design: docs/design/default-key.md, step 5b): `PUT .../safebox/items/:id/reencrypt` `{ revision, enc }` with a fresh content key and the copies
 * for every key in use of every member (`wrapsCover`). The revision goes up, so a change started with the old key is refused (409) and cannot be saved under the new one.
 */
safeboxRouter.put(
  "/items/:itemId/reencrypt",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const item = await itemOf(req, res, connection.id);
    if (!item) return;
    if (!isObject(item.data) || !item.data.enc || !Number.isInteger(req.body?.revision)) {
      res.status(400).json({ error: "That item cannot be locked again" });
      return;
    }
    const parsed = parseNewObject({ type: item.data.type, enc: req.body.enc });
    if ("error" in parsed) {
      res.status(parsed.status).json({ error: parsed.error });
      return;
    }
    if (!wrapsCover(parsed.enc, await peopleOf(connection, uidOf(res)))) {
      res.status(409).json({ error: "The encryption keys changed. Try again." });
      return;
    }
    const bytes = objectBytes({ meta: parsed.enc.meta, body: parsed.enc.body });
    let ok = false;
    await getFirestore().runTransaction(async (tx) => {
      const data = (await tx.get(item.ref)).data();
      if (!data || ((data.revision as number | undefined) ?? 1) !== req.body.revision) return;
      tx.update(item.ref, { enc: parsed.enc, bytes, revision: req.body.revision + 1 });
      ok = true;
    });
    if (!ok) {
      res.status(409).json({ error: "This item changed. Try again." });
      return;
    }
    res.status(204).end();
  }),
);

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
    if (isObject(item.data)) {
      res.status(400).json({ error: "An item that is not a file has no name to change: change its content" });
      return;
    }
    if (!canChange(item.data, uidOf(res))) {
      res.status(403).json({ error: "You cannot change this item" });
      return;
    }
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
    if (!canChange(item.data, uidOf(res))) {
      res.status(403).json({ error: "You cannot take out this item" });
      return;
    }
    if (isObject(item.data)) {
      // the attachments of an object go with it: their stored files, their previews and their entries
      for (const child of (await safeboxItems(connection.id).where("parentId", "==", item.id).get()).docs) {
        await deleteObject(boxOwner(connection.id), child.id);
        await deleteObject(boxOwner(connection.id), `${child.id}.thumb`);
        await child.ref.delete();
      }
    }
    await deleteObject(boxOwner(connection.id), item.id); // an object has no stored file: nothing is found, nothing fails
    await item.ref.delete();
    await reminderRef(connection.id, item.id).delete();
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

/**
 * A person who leaves a group (or is removed) takes their items out of its box: everything they saved, with the files, the previews, the attachments of
 * their objects and the reminders. What others saved stays (also what the others attached to their own items). Never raises.
 */
export async function deleteItemsOf(connectionId: string, uid: string): Promise<void> {
  try {
    const owner = boxOwner(connectionId);
    const items = safeboxItems(connectionId);
    const mine = (await items.where("addedBy", "==", uid).select().get()).docs;
    const doomed = new Map(mine.map((d) => [d.id, d.ref]));
    // what is attached to those items goes with them: one query for 30 items at a time (the limit of `in`), not one for each
    for (let i = 0; i < mine.length; i += 30) {
      const ids = mine.slice(i, i + 30).map((d) => d.id);
      for (const child of (await items.where("parentId", "in", ids).select().get()).docs) doomed.set(child.id, child.ref);
    }
    // ten at a time, so a big box does not take one round trip after another
    const all = [...doomed];
    for (let i = 0; i < all.length; i += 10) {
      await Promise.all(
        all.slice(i, i + 10).map(async ([id, ref]) => {
          await deleteObject(owner, id); // an object has no stored file: nothing is found, nothing fails
          await deleteObject(owner, `${id}.thumb`);
          await ref.delete();
          await reminderRef(connectionId, id).delete();
        }),
      );
    }
  } catch (err) {
    console.error(`Could not remove the items of ${uid} from the safebox of ${connectionId}`, err);
  }
}

/** The whole box of a friendship goes: the list and the files (when the friendship ends or an account is erased). Never raises. */
export async function deleteBox(connectionId: string): Promise<void> {
  try {
    const docs = await safeboxItems(connectionId).select().get();
    await Promise.all(docs.docs.map((d) => Promise.all([d.ref.delete(), reminderRef(connectionId, d.id).delete()])));
  } catch (err) {
    console.error(`Could not delete the safebox list of ${connectionId}`, err);
  }
  await deleteFolder(boxOwner(connectionId));
}
