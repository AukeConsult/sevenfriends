import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentData, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { MAX_WRAPS, wrapValid } from "./box-encryption";
import { FRIENDS_SUBCOLLECTION } from "./constants";
import { isShared, publishedOf } from "./keys";
import { OwnRecoveryRequest, PublishedKey, RecoveryTodoItem, SafeboxWrap } from "./models";
import { liveRequest, liveRequests, openRequest, requestOf, tellDone } from "./own-request";
import { circleCol, keyCol, keyListCol, messageCol, ownRequestCol, safeboxItems } from "./paths";
import { touchSync } from "./sync";

/**
 * Recovery from my own other device (design: docs/design/message-encryption.md): a device of mine whose key can open my messages and files gives the keys of my
 * OTHER devices their copies, for every friend at once. The person allows it once per key on the working device; after that it is silent work in small batches.
 *
 * A key is `shared` when it has (or needs no) copies: the first key of a person, a key that was allowed, or (keys made before this existed, no flag) the oldest key in use.
 * Every other key in use is waiting. Only a shared key is asked to help. The server cannot check that a copy is a real one, it checks the shape and who it is for, and
 * only marks a key allowed when no message or file of mine lacks a copy for it any more.
 */
export const ownRecoveryRouter = Router();
ownRecoveryRouter.use(requireAuth);

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;
const PAGE = 100;
const MAX_ITEMS_IN = 100;

const hasCopyFor = (enc: DocumentData | undefined, keyId: string): boolean => Array.isArray(enc?.wraps) && enc.wraps.some((w: SafeboxWrap) => w.keyId === keyId);
const cursorOf = (t: unknown): string | null => (t instanceof Timestamp ? `${t.seconds}.${t.nanoseconds}` : null);
const timeOf = (cursor: string): Timestamp | null => {
  const m = /^(\d{1,12})\.(\d{1,9})$/.exec(cursor);
  return m ? new Timestamp(Number(m[1]), Number(m[2])) : null;
};

/**
 * My keys in use, oldest first, with whether each one is shared (see above) and whether it can help: a shared key, or a key in my newest signed device list (a listed
 * device was approved by me, and can add the new key to the list; what it cannot open it skips).
 */
async function myKeys(uid: string): Promise<{ key: PublishedKey; shared: boolean; helps: boolean }[]> {
  const [snap, newest] = await Promise.all([keyCol(uid).get(), keyListCol(uid).orderBy("version", "desc").limit(1).get()]);
  const listed = new Set<string>(((newest.docs[0]?.data().devices ?? []) as { keyId: string }[]).map((d) => d.keyId));
  const keys = snap.docs
    .filter((d) => d.data().revoked !== true)
    .map((d) => ({ key: publishedOf(d.id, d.data()), flag: d.data().ownShared as boolean | undefined }))
    .sort((a, b) => (a.key.createdAt ?? "").localeCompare(b.key.createdAt ?? ""));
  return keys.map((k, i) => {
    const shared = isShared(k.flag, i === 0);
    return { key: k.key, shared, helps: shared || listed.has(k.key.id) };
  });
}

/** The confirmed friendships of mine (their ids are the ids of the safeboxes). */
async function myConnections(uid: string): Promise<string[]> {
  const ids = new Set<string>();
  for (const circle of (await circleCol(uid).get()).docs) {
    for (const f of (await circle.ref.collection(FRIENDS_SUBCOLLECTION).select("status").get()).docs) if (f.data().status === "confirmed") ids.add(f.id);
  }
  return [...ids];
}

/**
 * `?me=<my key id>`: the requests of my other devices that this device may allow (when the key of this device is a shared one). A key that waits (added next to
 * the others) has a request made for it here if it had none, so every waiting key is a request. `keys` are the keys of the live requests (asked or working).
 */
ownRecoveryRouter.get(
  "/pending",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const keys = await myKeys(uid);
    const me = typeof req.query.me === "string" ? req.query.me : "";
    const eligible = keys.some((k) => k.key.id === me && k.helps);
    if (!eligible) {
      res.json({ eligible, keys: [], requests: [] });
      return;
    }
    for (const k of keys.filter((k) => !k.shared)) if (!(await liveRequest(uid, k.key.id))) await openRequest(uid, k.key);
    const open = (await liveRequests(uid)).filter((r) => r.id !== me && (r.data.status === "asked" || r.data.status === "working") && keys.some((k) => k.key.id === r.id));
    res.json({ eligible, keys: open.map((r) => keys.find((k) => k.key.id === r.id)!.key), requests: open.map((r) => requestOf(r.id, r.data)) });
  }),
);

/** `?key=<my key id>`: the request that THIS device made (or the one made for it), so it can show how far it is. Null when there is none. */
ownRecoveryRouter.get(
  "/request",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const id = typeof req.query.key === "string" ? req.query.key : "";
    const data = id ? await liveRequest(uid, id) : undefined;
    res.json({ request: data ? requestOf(id, data) : null } satisfies { request: OwnRecoveryRequest | null });
  }),
);

/**
 * `{ key }`: the person asks (again) for this device's key, at any time, also when everything works. Needs another key of mine that opens everything. A new request
 * replaces the old one; it shows on my other devices.
 */
ownRecoveryRouter.post(
  "/ask",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const keys = await myKeys(uid);
    const target = keys.find((k) => k.key.id === req.body?.key);
    if (!target) {
      res.status(409).json({ error: "That key is not in use" });
      return;
    }
    if (!keys.some((k) => k.helps && k.key.id !== target.key.id)) {
      res.status(409).json({ error: "No other device of yours is approved to help. Use your 24 recovery words, or ask a friend." });
      return;
    }
    await openRequest(uid, target.key, await countLacking(uid, target.key.id));
    res.status(201).json({ request: requestOf(target.key.id, (await ownRequestCol(uid).doc(target.key.id).get()).data() ?? {}) });
  }),
);

/** The key `me` of a device of mine that may allow others (shared), other than the one asking. */
const helperOk = (keys: { key: PublishedKey; helps: boolean }[], me: unknown, target: string): boolean => keys.some((k) => k.key.id === me && k.helps && k.key.id !== target);

/** `{ key, me }`: a device begins the work: the request is `working`, with how many messages and files need a copy. */
ownRecoveryRouter.post(
  "/start",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const target = await waitingKey(uid, req.body?.key);
    if (!target || !helperOk(await myKeys(uid), req.body?.me, target.id)) {
      res.status(409).json({ error: "That key is not waiting for access" });
      return;
    }
    const counts = await countLacking(uid, target.id);
    const ref = ownRequestCol(uid).doc(target.id);
    if ((await ref.get()).exists) await ref.update({ status: "working", total: counts.messages + counts.files, added: 0 });
    else await openRequest(uid, target, counts);
    await touchSync(uid, "keysAt");
    res.json({ ok: true });
  }),
);

/** `{ key, me }`: "Not me": the key that asked is removed at once, and the device that asked is told (the request stays `declined` until it has shown it). */
ownRecoveryRouter.post(
  "/decline",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const target = await waitingKey(uid, req.body?.key);
    if (!target || !helperOk(await myKeys(uid), req.body?.me, target.id)) {
      res.status(409).json({ error: "That key is not waiting for access" });
      return;
    }
    await keyCol(uid).doc(target.id).set({ revoked: true, revokedAt: FieldValue.serverTimestamp() }, { merge: true });
    const ref = ownRequestCol(uid).doc(target.id);
    if ((await ref.get()).exists) await ref.update({ status: "declined" });
    await touchSync(uid, "keysAt");
    res.json({ ok: true });
  }),
);

/** `{ key }`: the asking device has shown a declined or finished request: it is deleted (nothing is kept). */
ownRecoveryRouter.post(
  "/dismiss",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    const id = typeof req.body?.key === "string" ? req.body.key : "";
    const data = id ? await liveRequest(uid, id) : undefined;
    if (data && (data.status === "declined" || data.status === "done")) {
      await ownRequestCol(uid).doc(id).delete();
      await touchSync(uid, "keysAt");
    }
    res.json({ ok: true });
  }),
);

/** A key of mine that is waiting (added next to the others), or one that has a live request (asked again, also when it was allowed before). */
async function waitingKey(uid: string, id: unknown): Promise<PublishedKey | null> {
  const k = (await myKeys(uid)).find((k) => k.key.id === id);
  if (!k) return null;
  if (!k.shared) return k.key;
  const r = await liveRequest(uid, k.key.id);
  return r && (r.status === "asked" || r.status === "working") ? k.key : null;
}

/**
 * `?key=<waiting key id>&part=messages|box&after=<cursor>`: my own messages (newest first, 100 at a time) or safebox files that have no copy for that key yet,
 * with my own copies of their keys. A message is `connectionId`-free (it is mine); a file says which safebox it is in.
 */
ownRecoveryRouter.get(
  "/todo",
  asyncHandler(async (req, res) => {
    const me = uidOf(res);
    const target = await waitingKey(me, req.query.key);
    if (!target) {
      res.status(409).json({ error: "That key is not waiting for access" });
      return;
    }
    const part = req.query.part === "box" ? "box" : "messages";
    const items: (RecoveryTodoItem & { connectionId?: string })[] = [];
    let next: string | null = null;
    if (part === "messages") {
      let query = messageCol(me).orderBy("time", "desc");
      const after = typeof req.query.after === "string" ? timeOf(req.query.after) : null;
      if (after) query = query.startAfter(after);
      const page = (await query.select("enc", "time").limit(PAGE).get()).docs;
      for (const d of page) {
        const enc = d.data().enc;
        if (!enc || hasCopyFor(enc, target.id)) continue;
        const wraps = (enc.wraps as SafeboxWrap[]).filter((w) => w.uid === me);
        if (wraps.length) items.push({ id: d.id, wraps, missing: [target.id] });
      }
      next = page.length === PAGE ? cursorOf(page[page.length - 1].data().time) : null;
    } else {
      for (const connectionId of await myConnections(me)) {
        for (const d of (await safeboxItems(connectionId).select("enc").get()).docs) {
          const enc = d.data().enc;
          if (!enc || hasCopyFor(enc, target.id)) continue;
          const wraps = (enc.wraps as SafeboxWrap[]).filter((w) => w.uid === me);
          if (wraps.length) items.push({ id: d.id, connectionId, wraps, missing: [target.id] });
        }
      }
    }
    res.json({ part, items, next });
  }),
);

/** `{ key, part, items: [{ id, connectionId?, wrap }] }`: the copies for the waiting key. Only for me, only for that key, only on my own messages and on the files of my friendships. */
ownRecoveryRouter.post(
  "/wraps",
  asyncHandler(async (req, res) => {
    const me = uidOf(res);
    const target = await waitingKey(me, req.body?.key);
    if (!target) {
      res.status(409).json({ error: "That key is not waiting for access" });
      return;
    }
    const part = req.body?.part === "box" ? "box" : "messages";
    const given: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!given.length || given.length > MAX_ITEMS_IN) {
      res.status(400).json({ error: `Send between 1 and ${MAX_ITEMS_IN} items` });
      return;
    }
    const items = given as { id?: unknown; connectionId?: unknown; wrap?: unknown }[];
    const mine = part === "box" ? new Set(await myConnections(me)) : null;
    for (const i of items) {
      const placeOk = part === "messages" || (typeof i?.connectionId === "string" && mine!.has(i.connectionId));
      if (typeof i?.id !== "string" || !i.id || !placeOk || !wrapValid(i.wrap) || i.wrap.uid !== me || i.wrap.keyId !== target.id) {
        res.status(400).json({ error: "That is not a copy of a key for your other device" });
        return;
      }
    }
    const refs = items.map((i) => (part === "box" ? safeboxItems(i.connectionId as string).doc(i.id as string) : messageCol(me).doc(i.id as string)));
    const snaps = await getFirestore().getAll(...refs, { fieldMask: ["enc"] });
    const batch = getFirestore().batch();
    let added = 0;
    snaps.forEach((snap, n) => {
      const enc = snap.data()?.enc;
      // only what is mine: the message is in my records, and a file has a copy for me
      if (!enc || !Array.isArray(enc.wraps) || hasCopyFor(enc, target.id) || !enc.wraps.some((w: SafeboxWrap) => w.uid === me)) return;
      const { uid, keyId, wrappedKey } = items[n].wrap as SafeboxWrap;
      if (enc.wraps.length >= MAX_WRAPS) return;
      batch.update(snap.ref, { "enc.wraps": [...enc.wraps, { uid, keyId, wrappedKey }] });
      added++;
    });
    if (added) {
      await batch.commit();
      const ref = ownRequestCol(me).doc(target.id);
      const request = (await ref.get()).data();
      if (request) await ref.update({ added: (request.added ?? 0) + added });
      await touchSync(me, "keysAt"); // the asking device shows the progress
    }
    res.json({ added });
  }),
);

/** How many of my messages and files have no copy for a key. */
async function countLacking(uid: string, keyId: string): Promise<{ messages: number; files: number }> {
  const lacking = (docs: FirebaseFirestore.QueryDocumentSnapshot[]) => docs.filter((d) => d.data().enc && !hasCopyFor(d.data().enc, keyId)).length;
  const messages = lacking((await messageCol(uid).select("enc").get()).docs);
  let files = 0;
  for (const connectionId of await myConnections(uid)) files += lacking((await safeboxItems(connectionId).select("enc").get()).docs);
  return { messages, files };
}

/** `?key=<one of my keys in use>`: how many messages and files are still locked for it (no copy of their key for it). */
ownRecoveryRouter.get(
  "/status",
  asyncHandler(async (req, res) => {
    const me = uidOf(res);
    const key = (await myKeys(me)).find((k) => k.key.id === req.query.key);
    if (!key) {
      res.status(409).json({ error: "That key is not in use" });
      return;
    }
    res.json(await countLacking(me, key.key.id));
  }),
);

/** `{ key }`: this device has been through everything. The key is marked allowed only when nothing of mine lacks a copy for it any more. */
ownRecoveryRouter.post(
  "/done",
  asyncHandler(async (req, res) => {
    const me = uidOf(res);
    const target = await waitingKey(me, req.body?.key);
    if (!target) {
      res.status(409).json({ error: "That key is not waiting for access" });
      return;
    }
    const { messages, files } = await countLacking(me, target.id);
    const missing = messages + files;
    if (missing) {
      res.status(409).json({ error: `${missing} messages or files still have no copy for that key.`, missing });
      return;
    }
    await keyCol(me).doc(target.id).update({ ownShared: true, ownSharedAt: FieldValue.serverTimestamp() });
    const request = await liveRequest(me, target.id);
    if (request) {
      await ownRequestCol(me).doc(target.id).update({ status: "done", added: request.total ?? 0 });
      await tellDone(me, { id: target.id, label: target.label });
    }
    res.json({ ok: true });
  }),
);

/**
 * `{ key }`: the person says this device's key opens their old messages and files (the automatic "oldest key" guess was wrong, for instance because that device was
 * reinstalled). This key becomes the shared one and every other key in use waits. Nothing is lost: a device that cannot open an item skips it, and a key is only
 * marked allowed when nothing lacks a copy.
 */
ownRecoveryRouter.post(
  "/trust",
  asyncHandler(async (req, res) => {
    const me = uidOf(res);
    const keys = await myKeys(me);
    if (!keys.some((k) => k.key.id === req.body?.key)) {
      res.status(409).json({ error: "That key is not in use" });
      return;
    }
    const batch = getFirestore().batch();
    for (const k of keys) batch.update(keyCol(me).doc(k.key.id), { ownShared: k.key.id === req.body.key });
    await batch.commit();
    res.json({ ok: true });
  }),
);
