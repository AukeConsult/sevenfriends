import { Request, Response, Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION } from "./constants";
import { ChatMessage, Conversation } from "./models";
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
        return { id: d.id, text: m.text as string, mine: m.fromUid === uid, read: Boolean(m.read), time: iso(m.time) };
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
    await batch.commit();

    const saved = (await mine.get()).data()!;
    const created: ChatMessage = { id: mine.id, text, mine: true, read: true, time: iso(saved.time) };
    // wake the other person's devices (before the answer: the function may stop right after it)
    await sendPush(connection.peerUid, { id: `message-${mine.id}`, title: common.fromName, body: text, url: `/friends/${connection.id}` });
    res.status(201).json(created);
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
