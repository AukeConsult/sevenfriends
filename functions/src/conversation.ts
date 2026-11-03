import { Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION } from "./constants";
import { ChatMessage, Conversation, MessageDeleteCriteria, MessageDeleteResult } from "./models";
import { circleCol, messageCol, userDoc } from "./paths";
import { sendPush } from "./push";

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

/** My confirmed connection for :friendId, or answers with an error and returns null. */
async function connectionOf(req: Request, res: Response) {
  const entry = await (res.locals.circleRef as DocumentReference)
    .collection(FRIENDS_SUBCOLLECTION)
    .doc(req.params.friendId)
    .get();
  const data = entry.data();
  if (!data) {
    res.status(404).json({ error: "Friend not found" });
    return null;
  }
  if (data.status !== "confirmed" || !data.linkedUid) {
    res.status(403).json({ error: "You can message a friend once the connection is confirmed" });
    return null;
  }
  return {
    id: entry.id,
    name: data.name as string,
    peerUid: data.linkedUid as string,
    peerCircleId: (data.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID,
  };
}

/** The conversation, oldest first (latest 200). */
conversationRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const uid = uidOf(res);

    const snap = await messageCol(uid).where("connectionId", "==", connection.id).get();
    const messages: ChatMessage[] = snap.docs
      .map((d) => {
        const m = d.data();
        return { id: d.id, text: m.text as string, mine: m.fromUid === uid, read: Boolean(m.read), time: iso(m.time), edited: Boolean(m.editedAt) };
      })
      .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""))
      .slice(-FEED_LIMIT);
    const conversation: Conversation = { friend: { id: connection.id, name: connection.name }, messages };
    res.json(conversation);
  }),
);

/** Send a message: { text }. Both people get a copy. */
conversationRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const token = res.locals.token as DecodedIdToken;

    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "Write a message first" });
      return;
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `A message can be at most ${MAX_MESSAGE_LENGTH} characters` });
      return;
    }

    // the other side of the connection must still be there and confirmed
    const peerEntry = await circleCol(connection.peerUid)
      .doc(connection.peerCircleId)
      .collection(FRIENDS_SUBCOLLECTION)
      .doc(connection.id)
      .get();
    if (peerEntry.data()?.status !== "confirmed") {
      res.status(409).json({ error: "This connection is not confirmed on both sides" });
      return;
    }

    const mine = messageCol(token.uid).doc();
    const theirs = messageCol(connection.peerUid).doc(mine.id); // same message id on both sides
    const common = {
      connectionId: connection.id,
      fromUid: token.uid,
      fromName: ((await userDoc(token.uid).get()).data()?.displayName as string | undefined) ?? token.name ?? token.email ?? "Someone",
      toUid: connection.peerUid,
      text,
      time: FieldValue.serverTimestamp(),
    };
    const batch = getFirestore().batch();
    batch.set(mine, { ...common, read: true }); // my own message needs no reading
    batch.set(theirs, { ...common, read: false });
    // "last spoken to": both sides of the friendship remember when the last message was written
    batch.update((res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION).doc(connection.id), { lastMessageAt: FieldValue.serverTimestamp() });
    batch.update(circleCol(connection.peerUid).doc(connection.peerCircleId).collection(FRIENDS_SUBCOLLECTION).doc(connection.id), { lastMessageAt: FieldValue.serverTimestamp() });
    await batch.commit();

    const saved = (await mine.get()).data()!;
    const created: ChatMessage = { id: mine.id, text, mine: true, read: true, time: iso(saved.time), edited: false };
    // wake the other person's devices (before the answer: the function may stop right after it)
    await sendPush(connection.peerUid, { id: `message-${mine.id}`, title: common.fromName, body: text, url: `/friends/${connection.id}` });
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

    const snap = await messageCol(uid).where("connectionId", "==", connection.id).get();
    const matching = snap.docs.filter((d) => {
      const m = d.data();
      if (whose === "mine" && m.fromUid !== uid) return false;
      if (cutoff !== null && !(m.time instanceof Timestamp && m.time.toMillis() < cutoff)) return false;
      return !contains || String(m.text).toLowerCase().includes(contains);
    });

    let deleted = 0;
    if (body.dryRun !== true && matching.length) {
      for (let i = 0; i < matching.length; i += DELETE_CHUNK) {
        const batch = getFirestore().batch();
        for (const d of matching.slice(i, i + DELETE_CHUNK)) {
          batch.delete(d.ref);
          batch.delete(messageCol(connection.peerUid).doc(d.id));
        }
        deleted += Math.min(DELETE_CHUNK, matching.length - i);
        if (i + DELETE_CHUNK >= matching.length) await tellPeer(batch, peerEntryOf(connection));
        await batch.commit();
      }
    }
    const result: MessageDeleteResult = { matched: matching.length, deleted };
    res.json(result);
  }),
);

/** My message of this connection (both copies), or null after answering 404 / 403. */
async function ownMessage(req: Request, res: Response) {
  const connection = await connectionOf(req, res);
  if (!connection) return null;
  const uid = uidOf(res);
  const mine = messageCol(uid).doc(req.params.messageId);
  const data = (await mine.get()).data();
  if (!data || data.connectionId !== connection.id) {
    res.status(404).json({ error: "Message not found" });
    return null;
  }
  if (data.fromUid !== uid) {
    res.status(403).json({ error: "You can only change your own messages" });
    return null;
  }
  return { mine, theirs: messageCol(connection.peerUid).doc(mine.id), peerEntry: peerEntryOf(connection) };
}

/** The friend's copy of the friendship. */
function peerEntryOf(connection: { id: string; peerUid: string; peerCircleId: string }): DocumentReference {
  return circleCol(connection.peerUid).doc(connection.peerCircleId).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);
}

/** The friend's app listens to its copy of the friendship: touching it makes an open feed reload at once. */
async function tellPeer(batch: FirebaseFirestore.WriteBatch, peerEntry: DocumentReference): Promise<void> {
  if ((await peerEntry.get()).exists) batch.update(peerEntry, { messagesChangedAt: FieldValue.serverTimestamp() });
}

/** Edit one of my messages: { text }. Both copies change; the message is marked as edited. */
conversationRouter.put(
  "/:messageId",
  asyncHandler(async (req, res) => {
    const own = await ownMessage(req, res);
    if (!own) return;
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) {
      res.status(400).json({ error: "Write a message first" });
      return;
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `A message can be at most ${MAX_MESSAGE_LENGTH} characters` });
      return;
    }
    const change = { text, editedAt: FieldValue.serverTimestamp() };
    const batch = getFirestore().batch();
    batch.update(own.mine, change);
    if ((await own.theirs.get()).exists) batch.update(own.theirs, change);
    await tellPeer(batch, own.peerEntry);
    await batch.commit();
    const saved = (await own.mine.get()).data()!;
    const edited: ChatMessage = { id: own.mine.id, text, mine: true, read: true, time: iso(saved.time), edited: true };
    res.json(edited);
  }),
);

/** Delete one of my messages: it disappears for both people. */
conversationRouter.delete(
  "/:messageId",
  asyncHandler(async (req, res) => {
    const own = await ownMessage(req, res);
    if (!own) return;
    const batch = getFirestore().batch();
    batch.delete(own.mine);
    batch.delete(own.theirs); // deleting a copy that is not there is fine
    await tellPeer(batch, own.peerEntry);
    await batch.commit();
    res.status(204).end();
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
      .get();
    const batch = getFirestore().batch();
    unread.docs.forEach((d) => batch.update(d.ref, { read: true, readAt: FieldValue.serverTimestamp() }));
    await batch.commit();
    res.json({ ok: true, marked: unread.size });
  }),
);
