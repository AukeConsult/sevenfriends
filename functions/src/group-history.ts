import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentData, DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { MAX_WRAPS, wrapValid } from "./box-encryption";
import { FRIENDS_SUBCOLLECTION } from "./constants";
import { connectionOf } from "./conversation";
import { publishedKeysOf } from "./keys";
import { GroupHistoryItem, GroupHistoryTodo, SafeboxWrap } from "./models";
import { circleCol, messageCol } from "./paths";

/**
 * The history of the messages of a group (design: docs/design/groups.md, "History of the messages"; fixed rule in docs/design/recovery-rules.md, section 8):
 * every member has the whole conversation, also what was written before they joined. A message exists as one copy for each member (made at send time), so a member who joined
 * later has none. A member's device that HAS a copy gives the others theirs: a text that is not locked is copied by the server, a locked one is opened by the device and
 * locked again for the keys of the member that lacks a copy (the content is never touched: the same locked text and the same iv, only the copies of the message key are new).
 * Quiet and safe to repeat: a copy that exists is never replaced, nothing is ever taken away, and the copies are read (not unread) so nobody is flooded.
 */
export const groupHistoryRouter = Router({ mergeParams: true });
groupHistoryRouter.use(requireAuth);

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;
// messages looked at in one request, and the most items one POST takes: the same number, so everything the app gets in a page it can send in one go. A transaction holds at most 500
// writes and a group has up to 6 other members: 50 items make at most 300 copies.
const PAGE = 50;
const MAX_ITEMS_IN = PAGE;
const cursorOf = (t: unknown): string | null => (t instanceof Timestamp ? `${t.seconds}.${t.nanoseconds}` : null);
const timeOf = (cursor: string): Timestamp | null => {
  const m = /^(\d{1,12})\.(\d{1,9})$/.exec(cursor);
  return m ? new Timestamp(Number(m[1]), Number(m[2])) : null;
};

/** The connection when it is a group, or null after answering 404. */
async function groupOf(req: Parameters<typeof connectionOf>[0], res: Parameters<typeof connectionOf>[1]) {
  const connection = await connectionOf(req, res);
  if (!connection) return null;
  if (!connection.group) {
    res.status(404).json({ error: "Only a group shares its messages this way" });
    return null;
  }
  return connection;
}

/** The next messages of MY copy that some other member has no copy of. */
groupHistoryRouter.get(
  "/todo",
  asyncHandler(async (req, res) => {
    const connection = await groupOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const peers = connection.peers;
    let query = messageCol(me).where("connectionId", "==", connection.id).orderBy("time", "desc");
    const after = typeof req.query.after === "string" ? timeOf(req.query.after) : null;
    if (after) query = query.startAfter(after);
    const page = (await query.select("enc", "fromUid", "time").limit(PAGE).get()).docs;
    const refs = page.flatMap((d) => peers.map((p) => messageCol(p.uid).doc(d.id)));
    const copies = refs.length ? await getFirestore().getAll(...refs, { fieldMask: ["connectionId"] }) : [];
    const keys = new Map(await Promise.all(peers.map(async (p) => [p.uid, (await publishedKeysOf(p.uid)).map((k) => k.id)] as const)));
    const items: GroupHistoryItem[] = [];
    page.forEach((d, n) => {
      const data = d.data();
      // a member who wrote the message and has no copy of it deleted their own copy: they do not get it back
      const lacking = peers.filter((p, i) => !copies[n * peers.length + i].exists && p.uid !== data.fromUid);
      if (!lacking.length) return;
      if (!data.enc) {
        items.push({ id: d.id, wraps: [], missing: [], plain: lacking.map((p) => p.uid) });
        return;
      }
      const missing = lacking.flatMap((p) => (keys.get(p.uid) ?? []).map((keyId) => ({ uid: p.uid, keyId }))); // a member with no key yet gets theirs when they have one
      if (missing.length) items.push({ id: d.id, wraps: Array.isArray(data.enc.wraps) ? data.enc.wraps : [], missing, plain: [] });
    });
    const next = page.length === PAGE ? cursorOf(page[page.length - 1].data().time) : null;
    res.json({ items, next } satisfies GroupHistoryTodo);
  }),
);

/**
 * `{ items: [{ id, plain?: [uid], wraps?: [wrap] }] }`: the copies. A text that is not locked is copied to the members in `plain`; a locked one gets, for each member that has wraps,
 * a copy of MY message with the same locked text and iv and only those wraps (accepted only for a member and one of their keys in use). Only members, never me, never a member who
 * has a copy already, never the one who wrote it. Answers how many copies were made.
 */
groupHistoryRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await groupOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const circles = new Map(connection.peers.map((p) => [p.uid, p.circleId]));
    const given: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!given.length || given.length > MAX_ITEMS_IN) {
      res.status(400).json({ error: `Send between 1 and ${MAX_ITEMS_IN} items` });
      return;
    }
    const keys = new Map(await Promise.all(connection.peers.map(async (p) => [p.uid, (await publishedKeysOf(p.uid)).map((k) => k.id)] as const)));
    const items = given as { id?: unknown; plain?: unknown; wraps?: unknown }[];
    for (const i of items) {
      const plain = Array.isArray(i?.plain) ? (i.plain as unknown[]) : [];
      const wraps = Array.isArray(i?.wraps) ? (i.wraps as unknown[]) : [];
      const fits =
        plain.every((u) => typeof u === "string" && circles.has(u)) &&
        wraps.length <= MAX_WRAPS * circles.size &&
        wraps.every((w) => wrapValid(w) && circles.has(w.uid) && (keys.get(w.uid) ?? []).includes(w.keyId));
      if (typeof i?.id !== "string" || !i.id || i.id.includes("/") || !(plain.length || wraps.length) || !fits) {
        res.status(400).json({ error: "That is not a copy of a message for a member of the group" });
        return;
      }
    }
    const told = new Set<string>();
    const copied = await getFirestore().runTransaction(async (tx) => {
      told.clear(); // a retried transaction starts again
      const refs = items.flatMap((i) => [messageCol(me).doc(i.id as string), ...connection.peers.map((p) => messageCol(p.uid).doc(i.id as string))]);
      const per = 1 + connection.peers.length;
      const snaps = await tx.getAll(...refs);
      let count = 0;
      items.forEach((item, n) => {
        const mine = snaps[n * per].data();
        if (!mine || mine.connectionId !== connection.id) return; // only a message of mine, in this group
        const locked = Boolean(mine.enc);
        const wraps = (Array.isArray(item.wraps) ? item.wraps : []) as SafeboxWrap[];
        const recipients = locked ? [...new Set(wraps.map((w) => w.uid))] : ((item.plain ?? []) as string[]);
        connection.peers.forEach((peer, i) => {
          if (!recipients.includes(peer.uid) || peer.uid === mine.fromUid || snaps[n * per + 1 + i].exists) return;
          const copy: DocumentData = {
            connectionId: connection.id,
            fromUid: mine.fromUid,
            fromName: mine.fromName,
            text: mine.text,
            time: mine.time,
            version: mine.version ?? 1,
            ...(mine.media ? { media: mine.media } : {}), // the file stays under its sender: a copy that names it lets the member read it
            ...(mine.link ? { link: mine.link } : {}),
            ...(mine.editedAt ? { editedAt: mine.editedAt } : {}),
            circleId: peer.circleId,
            read: true, // history is not news
          };
          if (locked) {
            const own = wraps.filter((w) => w.uid === peer.uid).map((w) => ({ uid: w.uid, keyId: w.keyId, wrappedKey: w.wrappedKey }));
            if (!own.length || own.length > MAX_WRAPS) return;
            copy.enc = { v: 1, iv: mine.enc.iv, ...(mine.enc.media ? { media: mine.enc.media } : {}), wraps: own };
          }
          tx.create(messageCol(peer.uid).doc(item.id as string), copy);
          told.add(peer.uid);
          count++;
        });
      });
      return count;
    });
    if (copied) {
      // the feed of each member that got messages reloads (their own entry of the group; it may be gone if they left meanwhile)
      const batch = getFirestore().batch();
      for (const uid of told) {
        const ref: DocumentReference = circleCol(uid).doc(circles.get(uid) as string).collection(FRIENDS_SUBCOLLECTION).doc(connection.id);
        if ((await ref.get()).exists) batch.update(ref, { messagesChangedAt: FieldValue.serverTimestamp() });
      }
      await batch.commit();
    }
    res.json({ copied });
  }),
);
