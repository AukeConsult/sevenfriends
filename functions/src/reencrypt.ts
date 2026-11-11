import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentData, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { parseMessageEnc, wrapsCover, wrapsFor } from "./box-encryption";
import { SAFEBOX_OBJECT_TYPES } from "./models";
import { ReencryptItem, ReencryptTodo } from "./models";
import { publishedKeysOf } from "./keys";
import { circleCol, keyCol, messageCol, safeboxItems } from "./paths";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION } from "./constants";
import { isObjectId } from "./sf-cache";

/**
 * Re-locking old items (design: docs/design/default-key.md, step 5b). After a key was retired, the items still locked for it are listed here; a device that can open
 * them locks each one anew (a fresh content key, the copies only for the keys in use) and sends it back. The server only checks shapes and who the copies are for.
 * This covers my copy of a text message (without a file) and the objects of the box; files come later.
 */
export const reencryptRouter = Router();
reencryptRouter.use(requireAuth);

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;
const PAGE = 100;
const MAX_ITEMS_OUT = 20;
const cursorOf = (t: unknown): string | null => (t instanceof Timestamp ? `${t.seconds}.${t.nanoseconds}` : null);
const timeOf = (cursor: string): Timestamp | null => {
  const m = /^(\d{1,12})\.(\d{1,9})$/.exec(cursor);
  return m ? new Timestamp(Number(m[1]), Number(m[2])) : null;
};

/** The ids of my retired keys. */
async function retiredKeys(uid: string): Promise<Set<string>> {
  return new Set((await keyCol(uid).where("revoked", "==", true).get()).docs.map((d) => d.id));
}

/** True when one of MY copies of the key is for a retired key. */
export const staleFor = (enc: DocumentData | undefined, uid: string, retired: Set<string>): boolean =>
  Array.isArray(enc?.wraps) && enc.wraps.some((w: { uid: string; keyId: string }) => w.uid === uid && retired.has(w.keyId));

/** The confirmed friendships of mine, with the circle each one is in (its id is the id of the box). */
async function myConnections(uid: string): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  for (const circle of (await circleCol(uid).get()).docs) {
    for (const f of (await circle.ref.collection(FRIENDS_SUBCOLLECTION).select("status").get()).docs) if (f.data().status === "confirmed") found.set(f.id, circle.id);
  }
  return found;
}

reencryptRouter.get(
  "/todo",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const part = req.query.part === "box" ? "box" : req.query.part === "messages" ? "messages" : null;
    if (!part) {
      res.status(400).json({ error: "Say which part: messages or box" });
      return;
    }
    const after = typeof req.query.after === "string" ? req.query.after : "";
    const retired = await retiredKeys(uid);
    const items: ReencryptItem[] = [];
    let next: string | null = null;
    if (!retired.size) {
      res.json({ part, items, next } satisfies ReencryptTodo);
      return;
    }
    if (part === "messages") {
      let query = messageCol(uid).orderBy("time", "desc");
      const cursor = after ? timeOf(after) : null;
      if (cursor) query = query.startAfter(cursor);
      const docs = (await query.select("text", "enc", "time", "connectionId").limit(PAGE).get()).docs;
      for (const d of docs) {
        const data = d.data();
        if (data.enc && !data.enc.media && staleFor(data.enc, uid, retired)) items.push({ id: d.id, connectionId: data.connectionId as string, circleId: (data.circleId as string | undefined) ?? DEFAULT_CIRCLE_ID, text: data.text as string, enc: data.enc });
      }
      next = docs.length === PAGE ? cursorOf(docs[docs.length - 1].data().time) : null;
      res.json({ part, items, next } satisfies ReencryptTodo);
      return;
    }
    // the box: every object of my friendships that is stale, in order of `<connection>/<item>`; the cursor is the last one given
    const stale: ReencryptItem[] = [];
    for (const [connectionId, circleId] of await myConnections(uid)) {
      for (const d of (await safeboxItems(connectionId).select("type", "enc", "revision").get()).docs) {
        const data = d.data();
        if (SAFEBOX_OBJECT_TYPES.includes(data.type) && staleFor(data.enc, uid, retired)) {
          stale.push({ id: d.id, connectionId, circleId, revision: (data.revision as number | undefined) ?? 1, enc: { ...data.enc, wraps: data.enc.wraps.filter((w: { uid: string }) => w.uid === uid) } });
        }
      }
    }
    const key = (i: ReencryptItem) => `${i.connectionId}/${i.id}`;
    const rest = stale.sort((x, y) => key(x).localeCompare(key(y))).filter((i) => !after || key(i) > after);
    items.push(...rest.slice(0, MAX_ITEMS_OUT));
    next = rest.length > MAX_ITEMS_OUT ? key(items[items.length - 1]) : null;
    res.json({ part, items, next } satisfies ReencryptTodo);
  }),
);

/**
 * `PUT .../reencrypt/messages/:messageId` `{ was, text, enc }`: my copy of a text message locked anew. `was` = the iv of the text it started from (somebody else changed it
 * in between: 409). The copies must be only mine and one for each of my keys in use.
 */
reencryptRouter.put(
  "/messages/:messageId",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const id = req.params.messageId;
    const parsed = parseMessageEnc(req.body?.text, req.body?.enc);
    if ("error" in parsed || !isObjectId(id) || typeof req.body?.was !== "string" || parsed.enc.media) {
      res.status(400).json({ error: "The locked message is not valid" });
      return;
    }
    if (!wrapsCover(parsed.enc, [{ uid, keys: await publishedKeysOf(uid) }])) {
      res.status(409).json({ error: "The encryption keys changed. Try again." });
      return;
    }
    const ref = messageCol(uid).doc(id);
    let done = false;
    await getFirestore().runTransaction(async (tx) => {
      const data = (await tx.get(ref)).data();
      if (!data?.enc || data.enc.media || data.enc.iv !== req.body.was) return;
      tx.update(ref, { text: parsed.text, enc: wrapsFor(parsed.enc, uid) });
      done = true;
    });
    if (!done) {
      res.status(409).json({ error: "This message changed. Try again." });
      return;
    }
    res.status(204).end();
  }),
);
