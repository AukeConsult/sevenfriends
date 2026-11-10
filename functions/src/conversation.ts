import { Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION } from "./constants";
import { ChatMessage, Conversation, MediaRef, MessageDeleteCriteria, MessageEnc, MessageEncMedia, MessageLink, MessageDeleteResult, NewMedia } from "./models";
import { circleCol, messageCol, missingIndex, userFields } from "./paths";
import { nameOf, sendPush } from "./push";
import { findPeerEntry, shownNameOf } from "./circle-profile";
import { linkOf } from "./link-preview";
import { otherMembers } from "./group-members";
import { Refused, parseMessageEnc, parseRelock, wrapsCover, wrapsFor } from "./box-encryption";
import { publishedKeysOf } from "./keys";
import { touchFeed, touchFeedIfExists } from "./sync";
import { LOCKED_MIME, deleteObject, deleteObjects, isObjectId, mediaLabel, objectInfo } from "./sf-cache";

export const MAX_MESSAGE_LENGTH = 2000;
const FEED_LIMIT = 200; // the feed shows the latest 200 messages

/**
 * The message feed of one connection. Mounted under /circles/:circleId/friends/:friendId/messages.
 *
 * A message is stored TWICE, once in each person's `messages` collection, with the same message id:
 *   user-account/{uid}/messages/{id}: { connectionId, fromUid, fromName, toUid, text, time, read }
 * The sender's copy is `read: true`, the receiver's copy is `read: false` until they open the feed.
 * The connection id is the shared id of the two friend entries.
 */
export const conversationRouter = Router({ mergeParams: true });

const uidOf = (res: Response) => (res.locals.token as DecodedIdToken).uid;
const iso = (t: unknown) => (t instanceof Timestamp ? t.toDate().toISOString() : null);

/**
 * The other people of a connection and the circle each has it in. A friendship has ONE (the friend); a group has all the other members. Everything that
 * is written for "the other side" (copies of a message, the keys a text is locked for, the push) goes over this list, so a friendship is simply a list of one.
 */
export interface Peer {
  uid: string;
  circleId: string;
}

/** The friend entry of a connection in the list of one of the other people (the entry has the id of the connection in every list). */
export const peerEntryRef = (connection: { id: string }, peer: Peer): DocumentReference => circleCol(peer.uid).doc(peer.circleId).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);

/** A connection as the routes see it: who it is with, in which circle, and the list of the other people (see `Peer`). */
export interface ConnectionInfo {
  id: string;
  /** the circle of MY entry */
  circleId: string;
  name: string;
  /** a group: there is no single friend (`peerUid` and `peerCircleId` are empty): everything goes over `peers` */
  group: boolean;
  peerUid: string;
  peerCircleId: string;
  peers: Peer[];
}

/** My confirmed connection for :friendId, or answers with an error and returns null. */
export async function connectionOf(req: Request, res: Response): Promise<ConnectionInfo | null> {
  const entry = await (res.locals.circleRef as DocumentReference)
    .collection(FRIENDS_SUBCOLLECTION)
    .doc(req.params.friendId)
    .get();
  const data = entry.data();
  if (!data) {
    res.status(404).json({ error: "Friend not found" });
    return null;
  }
  const group = data.kind === "group"; // a group: the other end is its other members (see groups.ts)
  if (data.status !== "confirmed" || (!group && !data.linkedUid)) {
    res.status(403).json({ error: "You can message a friend once the connection is confirmed" });
    return null;
  }
  if (group) {
    const peers = await otherMembers(entry.id, (res.locals.token as DecodedIdToken).uid);
    return { id: entry.id, circleId: (res.locals.circleRef as DocumentReference).id, name: data.name as string, group, peerUid: "", peerCircleId: "", peers };
  }
  return {
    group,
    id: entry.id,
    circleId: (res.locals.circleRef as DocumentReference).id, // the circle of MY entry
    name: await shownNameOf(data), // the real name of the friend, as in the list
    peerUid: data.linkedUid as string, // the friend (the first of `peers`): for what only a friendship has (recovery, profile)
    peerCircleId: (data.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID,
    peers: [{ uid: data.linkedUid as string, circleId: (data.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID }] as Peer[],
  };
}

/** The conversation, oldest first (latest 200). */
conversationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const uid = uidOf(res);

    // only the latest FEED_LIMIT (newest first, then turned round below): a long conversation is not read whole every time.
    // Needs the index messages(connectionId, time desc) in firestore.indexes.json
    const feed = messageCol(uid).where("connectionId", "==", connection.id);
    let docs: FirebaseFirestore.QueryDocumentSnapshot[];
    try {
      docs = (await feed.orderBy("time", "desc").limit(FEED_LIMIT).select("text", "fromUid", "read", "time", "editedAt", "hidden", "inBox", "media", "link", "enc").get()).docs;
    } catch (err) {
      if (!missingIndex(err)) throw err;
      console.warn("The index messages(connectionId, time) is not there yet: reading the whole feed", err); // works, only slower, until the index is built
      docs = (await feed.get()).docs;
    }
    const messages: ChatMessage[] = docs
      .map((d) => {
        const m = d.data();
        return { id: d.id, text: m.text as string, mine: m.fromUid === uid, read: Boolean(m.read), time: iso(m.time), edited: Boolean(m.editedAt), hidden: Boolean(m.hidden), inBox: Boolean(m.inBox) || (!m.text && !m.media && !m.link), media: (m.media as MediaRef | undefined) ?? null, link: (m.link as MessageLink | undefined) ?? null, ...(m.enc ? { enc: m.enc as MessageEnc } : {}) };
      })
      .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))
      .slice(-FEED_LIMIT);
    const conversation: Conversation = { friend: { id: connection.id, name: connection.name }, messages };
    res.json(conversation);
  }),
);

/** The file of a message I am sending: I must have uploaded it (`POST /api/sf-cache`) and not sent it yet. Answers with an error and returns null otherwise. */
async function attachedMedia(uid: string, body: NewMedia, res: Response, lockedMedia: MessageEncMedia | null = null): Promise<MediaRef | null> {
  const info = isObjectId(body?.objectId) ? await objectInfo(uid, body.objectId) : null;
  if (!info || !(info.kind === "image" || info.kind === "video" || info.kind === "audio")) {
    res.status(400).json({ error: "Upload the file first" });
    return null;
  }
  // a locked file was uploaded with `locked=1` (stored as binary data) and goes with a locked message; a plain file never does
  if ((info.mime === LOCKED_MIME) !== Boolean(lockedMedia)) {
    res.status(400).json({ error: lockedMedia ? "That file was not uploaded locked" : "That file is locked: send it in a locked message" });
    return null;
  }
  if ((await messageCol(uid).doc(body.objectId).get()).exists) {
    res.status(409).json({ error: "That file has been sent already" });
    return null;
  }
  const hasThumb = Boolean(await objectInfo(uid, `${body.objectId}.thumb`));
  if (lockedMedia) {
    if (hasThumb !== (lockedMedia.thumbIv !== null)) {
      res.status(400).json({ error: "The locked preview does not fit the file" });
      return null;
    }
    // the name, type and size are locked inside the message: the server knows only the kind and how many bytes
    return { ownerId: uid, objectId: body.objectId, kind: info.kind as MediaRef["kind"], mime: LOCKED_MIME, name: null, bytes: info.bytes, width: null, height: null, durationMs: null, hasThumb };
  }
  const whole = (v: unknown, max: number) => (Number.isInteger(v) && (v as number) >= 1 && (v as number) <= max ? (v as number) : null);
  return {
    ownerId: uid,
    objectId: body.objectId,
    kind: info.kind,
    mime: info.mime,
    name: info.fileName,
    bytes: info.bytes,
    width: whole(body.width, 20_000),
    height: whole(body.height, 20_000),
    durationMs: whole(body.durationMs, 86_400_000),
    hasThumb,
  };
}

/**
 * A locked text (design: docs/design/message-encryption.md): the body of a send or an edit may carry `enc` next to `text`, and then `text` is the locked text.
 * Answers with an error and returns null when it is not valid or when a key of me or my friend was added or retired while the person was sending (the
 * app then asks again for the keys and locks the text anew). Returns undefined when the body has no `enc`: a plain text, as before.
 */
async function lockedText(body: unknown, myUid: string, peerUids: string[], res: Response): Promise<{ text: string; enc: MessageEnc } | null | undefined> {
  const raw = body as { text?: unknown; enc?: unknown } | undefined;
  if (raw?.enc === undefined) return undefined;
  const parsed = parseMessageEnc(raw.text, raw.enc);
  if ("error" in parsed) {
    const refused = parsed as Refused;
    res.status(refused.status).json({ error: refused.error });
    return null;
  }
  const people = await Promise.all([myUid, ...peerUids].map(async (uid) => ({ uid, keys: await publishedKeysOf(uid) })));
  if (!wrapsCover(parsed.enc, people)) {
    res.status(409).json({ error: "The encryption keys changed while the message was sent. Try again." });
    return null;
  }
  return parsed;
}

/**
 * True when one of the other people of the connection (my friend; every member of a group) has ME on their sleep list (`asleep` on THEIR entry of the connection): what I write to them then arrives silently
 * (no push, no sound, no desktop notice; it is still unread) unless it is a poke. Best effort: when their entry cannot be read the answer is false (they are told).
 */
export async function peerSleeps(connection: { id: string }, peer: Peer): Promise<boolean> {
  try {
    return (await peerEntryRef(connection, peer).get()).data()?.asleep === true;
  } catch {
    return false;
  }
}

/** Send a message: { text?, media?, poke? }, a text, a file you uploaded (the text is then its caption) or both. Both people get a copy. */
conversationRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const token = res.locals.token as DecodedIdToken;

    // `enc` = the text is locked on the sender's device (then `text` is the locked text and the server never reads it)
    const locked = await lockedText(req.body, token.uid, connection.peers.map((p) => p.uid), res);
    if (locked === null) return;
    const text = locked ? locked.text : typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text && !req.body?.media) {
      res.status(400).json({ error: "Write a message first" });
      return;
    }
    if (!locked && text.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `A message can be at most ${MAX_MESSAGE_LENGTH} characters` });
      return;
    }
    if (Boolean(locked?.enc.media) !== Boolean(locked && req.body?.media)) {
      res.status(400).json({ error: "A locked file goes with a locked message, and the other way round" });
      return;
    }
    const media = req.body?.media ? await attachedMedia(token.uid, req.body.media, res, locked?.enc.media ?? null) : null;
    if (req.body?.media && !media) return;

    // the other side of the connection must still be there and confirmed (the page of a link and my name are looked up at the same time: nothing waits for the others)
    const [peerEntries, link, fromName] = await Promise.all([
      Promise.all(connection.peers.map((peer) => findPeerEntry(token.uid, connection.circleId, connection.id, { linkedUid: peer.uid, peerCircleId: peer.circleId }))),
      locked ? null : linkOf(text), // the page of the link may be shown in a frame (checked once, here); a locked text cannot be read, so it has none
      nameOf(token.uid, token, connection.circleId), // the name I have in this circle
    ]);
    connection.peers.forEach((peer, i) => {
      peer.circleId = peerEntries[i]?.ref.parent.parent?.id ?? peer.circleId; // where their side really is
    });
    if (connection.peers[0]) connection.peerCircleId = connection.peers[0].circleId;
    if (peerEntries.some((entry) => entry?.data()?.status !== "confirmed")) {
      res.status(409).json({ error: "This connection is not confirmed on both sides" });
      return;
    }

    const poke = req.body?.poke === true; // "poke anyway": the friend is told with a sound even when they have me on their sleep list
    const muted = peerEntries.map((entry) => entry?.data()?.asleep === true && !poke); // one for each of the other people
    const mine = media ? messageCol(token.uid).doc(media.objectId) : messageCol(token.uid).doc(); // a message with a file has the id of the file: that is how the receiver is let in
    const sentAt = Timestamp.now(); // known here, so the answer needs no second read of the message
    const common = {
      connectionId: connection.id,
      fromUid: token.uid,
      fromName,
      ...(connection.group ? {} : { toUid: connection.peerUid }), // a group has no single receiver
      text,
      ...(media ? { media } : {}),
      ...(link ? { link } : {}),
      time: sentAt,
    };
    const batch = getFirestore().batch();
    // each copy says which circle it belongs to FOR ITS OWNER: mine in my circle, the friend's in theirs
    // a locked message keeps in each copy only that person's copies of the message key
    batch.set(mine, { ...common, ...(locked ? { enc: wrapsFor(locked.enc, token.uid) } : {}), circleId: connection.circleId, read: true }); // my own message needs no reading
    for (const peer of connection.peers) {
      // the same message id in every copy
      batch.set(messageCol(peer.uid).doc(mine.id), { ...common, ...(locked ? { enc: wrapsFor(locked.enc, peer.uid) } : {}), ...(poke ? { poke: true } : {}), circleId: peer.circleId, read: false });
    }
    // "last spoken to": both sides of the friendship remember when the last message was written
    const myEntry = (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);
    batch.update(myEntry, { lastMessageAt: FieldValue.serverTimestamp() });
    touchFeed(batch, myEntry); // my other devices reload this feed
    for (const peer of connection.peers) batch.update(peerEntryRef(connection, peer), { lastMessageAt: FieldValue.serverTimestamp() });
    await batch.commit();

    const created: ChatMessage = { id: mine.id, text, media, mine: true, read: true, time: iso(sentAt), edited: false, hidden: false, link, ...(locked ? { enc: wrapsFor(locked.enc, token.uid) } : {}) };
    // wake the other person's devices (before the answer: the function may stop right after it)
    for (const [i, peer] of connection.peers.entries()) {
      if (!muted[i]) await sendPush(peer.uid, { circleId: peer.circleId, id: `message-${mine.id}`, title: connection.group ? `${fromName} · ${connection.name}` : fromName, body: locked ? "🔒 New message" : text || mediaLabel(media!.kind), url: `/friends/${connection.id}`, kind: "message" });
    }
    res.status(201).json(created);
  }),
);

const DAY_MS = 86_400_000;
const DELETE_CHUNK = 200; // messages per batch: two deletes each, a batch holds 500 writes

/**
 * Delete several messages of the conversation at once: `{ whose?, olderThanDays?, contains?, dryRun? }` (see
 * MessageDeleteCriteria; whose = mine (default) or both, never the friend's alone; nothing else given = all of them). Always both people's copies go. `dryRun` only counts, so the app can say how many will go.
 */
conversationRouter.post(
  "/delete",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const uid = uidOf(res);
    const body = (req.body ?? {}) as MessageDeleteCriteria;

    const whose = body.whose ?? "mine";
    if (whose !== "mine" && whose !== "both") {
      res.status(400).json({ error: "whose must be mine or both" });
      return;
    }
    const days = body.olderThanDays ?? null;
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) {
      res.status(400).json({ error: "olderThanDays must be a whole number of days (1-3650)" });
      return;
    }
    const contains = typeof body.contains === "string" ? body.contains.trim().toLowerCase().slice(0, 100) : "";
    const cutoff = days === null ? null : Date.now() - days * DAY_MS;

    const snap = await messageCol(uid).where("connectionId", "==", connection.id).select("fromUid", "time", "text", "media", "enc").get();
    const matching = snap.docs.filter((d) => {
      const m = d.data();
      if (whose === "mine" && m.fromUid !== uid) return false;
      if (cutoff !== null && !(m.time instanceof Timestamp && m.time.toMillis() < cutoff)) return false;
      return !contains || (!m.enc && String(m.text).toLowerCase().includes(contains)); // a locked text cannot be searched on the server
    });

    let deleted = 0;
    if (body.dryRun !== true && matching.length) {
      const files = matching.flatMap((d) => (d.data().media as MediaRef | undefined) ?? []);
      await deleteObjects(files); // the files go FIRST: if the database delete fails they are wiped anyway
      for (let i = 0; i < matching.length; i += DELETE_CHUNK) {
        const batch = getFirestore().batch();
        for (const d of matching.slice(i, i + DELETE_CHUNK)) {
          batch.delete(d.ref);
          for (const peer of connection.peers) batch.delete(messageCol(peer.uid).doc(d.id));
        }
        deleted += Math.min(DELETE_CHUNK, matching.length - i);
        if (i + DELETE_CHUNK >= matching.length) {
          for (const peer of connection.peers) await touchFeedIfExists(batch, peerEntryRef(connection, peer));
          touchFeed(batch, (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(connection.id)); // my other devices reload the feed
        }
        await batch.commit();
      }
    }
    const result: MessageDeleteResult = { matched: matching.length, deleted };
    res.json(result);
  }),
);

/**
 * My message of this connection (both copies), or null after answering 404 / 403. With `allowMoved`, the note of a picture or video
 * that was moved to the safebox (`inBox`) counts as mine even when my friend sent it: it holds nothing any more, and either friend may remove it.
 */
async function ownMessage(req: Request, res: Response, allowMoved = false) {
  const connection = await connectionOf(req, res);
  if (!connection) return null;
  const uid = uidOf(res);
  const mine = messageCol(uid).doc(req.params.messageId);
  const data = (await mine.get()).data();
  if (!data || data.connectionId !== connection.id) {
    res.status(404).json({ error: "Message not found" });
    return null;
  }
  if (data.fromUid !== uid && !(allowMoved && data.inBox)) {
    res.status(403).json({ error: "You can only change your own messages" });
    return null;
  }
  const myEntry = (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);
  return { mine, peers: connection.peers, theirs: connection.peers.map((peer) => ({ peer, ref: messageCol(peer.uid).doc(mine.id) })), peerEntries: connection.peers.map((peer) => peerEntryRef(connection, peer)), myEntry, media: (data.media as MediaRef | undefined) ?? null, hidden: Boolean(data.hidden), enc: (data.enc as MessageEnc | undefined) ?? null, };
}

/** Edit one of my messages: { text } (the caption, for a message with a file). Both copies change; the message is marked as edited. */
conversationRouter.put(
  "/:messageId",
  asyncHandler(async (req, res) => {
    const own = await ownMessage(req, res);
    if (!own) return;
    const uid = uidOf(res);
    // a message that is locked stays locked, with the SAME key: the app locks the new text with the key the message has and sends only the text and its new iv (the copies of the key stay as they are)
    if (own.enc) {
      const again = parseRelock(req.body?.text, req.body?.iv);
      if ("error" in again) {
        res.status(again.status).json({ error: again.error });
        return;
      }
      const theirCopies = await Promise.all(own.theirs.map(async (their) => ({ ref: their.ref, copy: await their.ref.get() })));
      const batch = getFirestore().batch();
      batch.update(own.mine, { text: again.text, enc: { ...own.enc, iv: again.iv }, editedAt: FieldValue.serverTimestamp() });
      for (const { ref, copy } of theirCopies) if (copy.exists) batch.update(ref, { text: again.text, enc: { ...(copy.data()!.enc as MessageEnc), iv: again.iv }, editedAt: FieldValue.serverTimestamp() });
      for (const entry of own.peerEntries) await touchFeedIfExists(batch, entry);
      touchFeed(batch, own.myEntry); // my other devices reload the feed
      await batch.commit();
      const saved = (await own.mine.get()).data()!;
      const edited: ChatMessage = { id: own.mine.id, text: again.text, media: own.media, mine: true, read: true, time: iso(saved.time), edited: true, hidden: own.hidden, link: null, enc: { ...own.enc, iv: again.iv } };
      res.json(edited);
      return;
    }
    const locked = await lockedText(req.body, uid, own.peers.map((p) => p.uid), res); // a plain message may become a locked one: its text is locked with a new key
    if (locked === null) return;
    if (locked?.enc.media) {
      res.status(400).json({ error: "A file can be locked only when the message is sent" });
      return;
    }
    const text = locked ? locked.text : typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text && !own.media) {
      res.status(400).json({ error: "Write a message first" });
      return;
    }
    if (!locked && text.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `A message can be at most ${MAX_MESSAGE_LENGTH} characters` });
      return;
    }
    const link = locked ? null : await linkOf(text);
    const change = { text, editedAt: FieldValue.serverTimestamp(), link: link ?? FieldValue.delete() }; // the link follows the new text
    const enc = (person: string) => (locked ? wrapsFor(locked.enc, person) : FieldValue.delete()); // each copy keeps only its owner's copies of the key
    const batch = getFirestore().batch();
    batch.update(own.mine, { ...change, enc: enc(uid) });
    for (const their of own.theirs) if ((await their.ref.get()).exists) batch.update(their.ref, { ...change, enc: enc(their.peer.uid) });
    for (const entry of own.peerEntries) await touchFeedIfExists(batch, entry);
    touchFeed(batch, own.myEntry); // my other devices reload the feed
    await batch.commit();
    const saved = (await own.mine.get()).data()!;
    const edited: ChatMessage = { id: own.mine.id, text, media: own.media, mine: true, read: true, time: iso(saved.time), edited: true, hidden: own.hidden, link, ...(locked ? { enc: wrapsFor(locked.enc, uid) } : {}) };
    res.json(edited);
  }),
);

/** Delete one of my messages (or the note of a file moved to the safebox, whoever sent it): it disappears for both people, and so does its file. The file in the safebox stays. */
conversationRouter.delete(
  "/:messageId",
  asyncHandler(async (req, res) => {
    const own = await ownMessage(req, res, true);
    if (!own) return;
    if (own.media) await deleteObject(own.media.ownerId, own.media.objectId); // the file goes FIRST: if the database delete fails it is wiped anyway
    const batch = getFirestore().batch();
    batch.delete(own.mine);
    for (const their of own.theirs) batch.delete(their.ref); // deleting a copy that is not there is fine
    for (const entry of own.peerEntries) await touchFeedIfExists(batch, entry);
    touchFeed(batch, own.myEntry); // my other devices reload the feed
    await batch.commit();
    res.status(204).end();
  }),
);

/** Hide / show a picture or video in MY feed: { hidden }. Only my copy of the message changes (mine or the friend's). */
conversationRouter.put(
  "/:messageId/hidden",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    if (typeof req.body?.hidden !== "boolean") {
      res.status(400).json({ error: "hidden must be true or false" });
      return;
    }
    const ref = messageCol(uidOf(res)).doc(req.params.messageId);
    const data = (await ref.get()).data();
    if (!data || data.connectionId !== connection.id) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    await ref.update({ hidden: req.body.hidden });
    res.json({ id: ref.id, hidden: req.body.hidden });
  }),
);

/** I opened the feed: mark everything the other person sent as read. */
conversationRouter.post(
  "/read",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;

    const unread = await messageCol(uidOf(res))
      .where("connectionId", "==", connection.id)
      .where("read", "==", false)
      .select() // only the documents' names are needed
      .get();
    const batch = getFirestore().batch();
    unread.docs.forEach((d) => batch.update(d.ref, { read: true, readAt: FieldValue.serverTimestamp() }));
    await batch.commit();
    res.json({ ok: true, marked: unread.size });
  }),
);
