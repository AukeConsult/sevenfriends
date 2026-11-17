import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentData, DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { MAX_WRAPS, relockedWraps, wrapValid } from "./box-encryption";
import { shownNameOf } from "./circle-profile";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, RECOVERY_COLLECTION } from "./constants";
import { connectionOf } from "./conversation";
import { publishedKeysOf } from "./keys";
import { RecoveryItem, RecoveryState, RecoveryTodo, RecoveryTodoItem, SafeboxWrap } from "./models";
import { circleCol, messageCol, recoveryDoc, safeboxItems } from "./paths";
import { touchSync } from "./sync";
import { nameOf, sendPush } from "./push";
import { setting } from "./settings";

/**
 * Recovery (design: docs/design/message-encryption.md): somebody with a NEW key (the one who asks, the requester) asks their friend (the helper) to open the old
 * messages and safebox files again. The helper's device opens each message key with its own key and locks it again for EVERY key in use of the requester (their new
 * key, and any other device of theirs that lacks a copy); the server only files those new copies in the requester's messages and in the shared safebox items. No key and no text ever pass through the server in a readable form.
 *
 * recovery-request/{connectionId}: { requesterUid, helperUid, keyId, fingerprint, status: asked | approved | done, total, added, circleId (the helper's) }
 */
export const recoveryRouter = Router({ mergeParams: true });
recoveryRouter.use(requireAuth);

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;
const PAGE = 100; // messages looked at in one request
const MAX_WRAPS_IN = 100;

const hasCopyFor = (enc: DocumentData | undefined, keyId: string): boolean => Array.isArray(enc?.wraps) && enc.wraps.some((w: SafeboxWrap) => w.keyId === keyId);
/** The keys in use of the asker (every device of theirs) that have no copy of this message's or file's key yet. */
const missingKeys = (enc: DocumentData | undefined, inUse: string[]): string[] => (enc ? inUse.filter((id) => !hasCopyFor(enc, id)) : []);
const cursorOf = (t: unknown): string | null => (t instanceof Timestamp ? `${t.seconds}.${t.nanoseconds}` : null);
const timeOf = (cursor: string): Timestamp | null => {
  const m = /^(\d{1,12})\.(\d{1,9})$/.exec(cursor);
  return m ? new Timestamp(Number(m[1]), Number(m[2])) : null;
};

const DAY_MS = 24 * 60 * 60 * 1000;
/** A request that nobody answered or finished is gone after this long (design: docs/design/recovery-by-friend.md). */
const REQUEST_LIFE_MS = 7 * DAY_MS;
/** `done` is only the news "your friend opened your history" on its way: kept at most this long if the asker's app never shows it. */
const DONE_LIFE_MS = DAY_MS;
/** How many times one person can ask in a day: the setting RECOVERY_ASKS_PER_DAY (0 = no limit, which is the default for now). */
const asksPerDay = (): number => Math.max(0, Math.floor(Number(setting("RECOVERY_ASKS_PER_DAY")) || 0));
const LIMIT_COLLECTION = "recovery-limit";

const madeAt = (data: DocumentData): number => (data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now());
const isStale = (data: DocumentData): boolean => Date.now() - madeAt(data) > (data.status === "done" ? DONE_LIFE_MS : REQUEST_LIFE_MS);
const isoOf = (t: unknown): string | null => (t instanceof Timestamp ? t.toDate().toISOString() : null);

/** The request of this friendship, or undefined: a request that is too old is deleted here (nothing is kept). */
async function liveRequest(connectionId: string): Promise<DocumentData | undefined> {
  const ref = recoveryDoc(connectionId);
  const data = (await ref.get()).data();
  if (data && isStale(data)) {
    await ref.delete();
    return undefined;
  }
  return data;
}

/** Counts this ask against the day's limit; false = the limit is used up. */
async function countAsk(uid: string): Promise<boolean> {
  const limit = asksPerDay();
  if (!limit) return true; // no limit
  const ref = getFirestore().collection(LIMIT_COLLECTION).doc(uid);
  const day = new Date().toISOString().slice(0, 10);
  return getFirestore().runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    const count = data?.day === day ? (data.count as number) : 0;
    if (count >= limit) return false;
    tx.set(ref, { day, count: count + 1 });
    return true;
  });
}

/** Both people's apps look again (the friend's Home has a card, the asker's own other devices follow). */
async function touchBoth(a: string, b: string): Promise<void> {
  await Promise.all([touchSync(a, "requestsAt"), touchSync(b, "requestsAt")]);
}

function stateOf(data: DocumentData | undefined, me: string, friendName: string): RecoveryState {
  if (!data) return { role: "none", status: "none", keyId: null, fingerprint: null, total: 0, added: 0, skipped: 0, friendName };
  return {
    role: data.requesterUid === me ? "requester" : "helper",
    status: data.status,
    keyId: data.keyId,
    fingerprint: data.fingerprint,
    total: data.total ?? 0,
    added: data.added ?? 0,
    skipped: data.skipped ?? 0,
    friendName,
  };
}

/** My request or the request of my friend for this friendship, and nothing else. */
recoveryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    res.json(stateOf(await liveRequest(connection.id), uidOf(res), connection.name));
  }),
);

/** I have a new key: ask my friend to open the old messages and files for it. Asking again replaces an earlier request. */
recoveryRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const [mine, friend] = await Promise.all([publishedKeysOf(me), publishedKeysOf(connection.peerUid)]);
    if (!mine.length) {
      res.status(409).json({ error: "You need a key first. Make one in Settings, Keys." });
      return;
    }
    if (!friend.length) {
      res.status(409).json({ error: `${connection.name} has no key, so there is nothing to open for you.` });
      return;
    }
    if (!(await countAsk(me))) {
      res.status(429).json({ error: `You can ask at most ${asksPerDay()} times a day. Try again tomorrow.` });
      return;
    }
    const target = mine[mine.length - 1]; // the newest key in use
    const data = {
      requesterUid: me,
      helperUid: connection.peerUid,
      keyId: target.id,
      fingerprint: target.fingerprint,
      status: "asked",
      total: 0,
      added: 0,
      circleId: connection.peerCircleId, // the helper's circle
      requesterCircleId: connection.circleId, // my circle
      createdAt: FieldValue.serverTimestamp(),
    }; // a new request always replaces what is there, also a finished or declined one
    await recoveryDoc(connection.id).set(data);
    await touchBoth(connection.peerUid, me);
    const fromName = await nameOf(me, res.locals.token as DecodedIdToken, connection.circleId);
    await sendPush(connection.peerUid, {
      circleId: connection.peerCircleId,
      id: `recovery-${connection.id}`,
      title: `${fromName} needs your help`,
      body: "Open the app to unlock their old messages again.",
      url: `/friends/${connection.id}/recovery`,
      kind: "request",
    });
    res.status(201).json(stateOf(await liveRequest(connection.id), me, connection.name));
  }),
);

/** Tells the one who asked how it went (a push with the sound of an answer; another circle of theirs gets "Activity in ..." from sendPush). */
async function tellRequester(data: DocumentData, connection: { id: string; name: string; circleId: string }, res: { locals: Record<string, unknown> }, what: "declined" | "done"): Promise<void> {
  const fromName = await nameOf(uidOf(res), res.locals.token as DecodedIdToken, connection.circleId);
  await sendPush(data.requesterUid as string, {
    circleId: (data.requesterCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID,
    id: `recovery-${what}-${connection.id}`,
    title: what === "done" ? `${fromName} opened your history` : `${fromName} declined your request`,
    body: what === "done" ? "Your old messages and files can be opened on your devices again." : "They did not open your old messages. You can ask again.",
    url: `/friends/${connection.id}/recovery`,
    kind: "answer",
  });
}

/** Stop: the one who asked takes the request back (it is gone). A friend who calls this declines (the older way of declining). */
recoveryRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const data = await liveRequest(connection.id);
    if (data?.helperUid === uidOf(res)) {
      await declineRequest(connection, data, res);
    } else {
      await recoveryDoc(connection.id).delete();
      await touchBoth(connection.peerUid, uidOf(res));
    }
    res.json({ ok: true });
  }),
);

/** The friend says no: the request stays as `declined` until the asker has seen it (dismiss), and the asker is told. */
async function declineRequest(connection: { id: string; name: string; circleId: string; peerUid: string }, data: DocumentData, res: { locals: Record<string, unknown> }): Promise<void> {
  if (data.status === "declined" || data.status === "done") return;
  await recoveryDoc(connection.id).update({ status: "declined", declinedAt: FieldValue.serverTimestamp() });
  await tellRequester(data, connection, res, "declined");
  await touchBoth(connection.peerUid, uidOf(res));
}

recoveryRouter.post(
  "/decline",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const data = await liveRequest(connection.id);
    if (!data || data.helperUid !== me) {
      res.status(404).json({ error: "There is no request from your friend" });
      return;
    }
    await declineRequest(connection, data, res);
    res.json(stateOf(await liveRequest(connection.id), me, connection.name));
  }),
);

/** The asker's app has shown a declined or finished request: it is deleted (a finished recovery leaves nothing behind). */
recoveryRouter.post(
  "/dismiss",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const data = await liveRequest(connection.id);
    if (data && data.requesterUid === me && (data.status === "declined" || data.status === "done")) {
      await recoveryDoc(connection.id).delete();
      await touchSync(me, "requestsAt"); // my other devices drop it too
    }
    res.json(stateOf(await liveRequest(connection.id), me, connection.name));
  }),
);

/** The keys in use of the two people of a friendship: every item must have a copy of its key for each of them. */
interface ActiveKeys {
  requester: string[];
  helper: string[];
}
const activeOf = async (requester: string, helper: string): Promise<ActiveKeys> => {
  const [r, h] = await Promise.all([publishedKeysOf(requester), publishedKeysOf(helper)]);
  return { requester: r.map((k) => k.id), helper: h.map((k) => k.id) };
};

/** What one message or file lacks: the keys of the requester and the keys of the helper that have no copy of its key, and the helper's own copies (what the helper can open). */
interface Need {
  id: string;
  /** the helper's own copies of the key */
  wraps: SafeboxWrap[];
  missing: string[];
  missingOwn: string[];
}

/** The messages of one page (the requester's copy is `docs`) with what each copy of it lacks; the helper's own copy is read with it. Only those that lack something. */
async function messageNeeds(docs: { id: string; data(): DocumentData }[], me: string, active: ActiveKeys): Promise<Need[]> {
  const own = docs.length ? await getFirestore().getAll(...docs.map((d) => messageCol(me).doc(d.id)), { fieldMask: ["enc"] }) : [];
  const needs: Need[] = [];
  docs.forEach((d, n) => {
    const mine = own[n].data()?.enc;
    const missing = missingKeys(d.data().enc, active.requester);
    const missingOwn = mine ? missingKeys(mine, active.helper) : []; // a message the helper no longer has is not theirs to lock
    if (missing.length || missingOwn.length) needs.push({ id: d.id, wraps: Array.isArray(mine?.wraps) ? mine.wraps : [], missing, missingOwn });
  });
  return needs;
}

/** The safebox items (shared by both people: one list of copies) that lack a copy for a key in use of either person. */
async function boxNeeds(connectionId: string, me: string, active: ActiveKeys): Promise<Need[]> {
  const needs: Need[] = [];
  for (const d of (await safeboxItems(connectionId).select("enc").get()).docs) {
    const enc = d.data().enc;
    if (!Array.isArray(enc?.wraps)) continue;
    const missing = missingKeys(enc, active.requester);
    const missingOwn = missingKeys(enc, active.helper);
    if (missing.length || missingOwn.length) needs.push({ id: d.id, wraps: enc.wraps.filter((w: SafeboxWrap) => w.uid === me), missing, missingOwn });
  }
  return needs;
}

/** How many messages and files still lack a copy for a key in use of either person. */
async function countMissing(connectionId: string, requester: string, me: string, active: ActiveKeys): Promise<number> {
  let count = (await boxNeeds(connectionId, me, active)).length;
  let after: Timestamp | null = null;
  for (;;) {
    let query = messageCol(requester).where("connectionId", "==", connectionId).orderBy("time", "desc");
    if (after) query = query.startAfter(after);
    const page = (await query.select("enc", "time").limit(PAGE).get()).docs;
    count += (await messageNeeds(page, me, active)).length;
    if (page.length < PAGE) return count;
    after = page[page.length - 1].data().time as Timestamp;
  }
}

/** The friend says yes: from now on the friend's app may send the new copies. Only the friend who was asked. */
recoveryRouter.post(
  "/approve",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const ref = recoveryDoc(connection.id);
    const data = await liveRequest(connection.id);
    if (!data || data.helperUid !== me) {
      res.status(404).json({ error: "There is no request from your friend" });
      return;
    }
    if (data.status === "declined" || data.status === "done") {
      res.status(409).json({ error: "This request is over. Your friend can ask again." });
      return;
    }
    if (data.status === "asked") {
      const total = await countMissing(connection.id, data.requesterUid, me, await activeOf(data.requesterUid, me));
      await ref.update({ status: "approved", total, added: 0, skipped: 0, approvedAt: FieldValue.serverTimestamp() });
      await touchBoth(connection.peerUid, me); // the asker's page shows that it has started
    }
    res.json(stateOf((await ref.get()).data(), me, connection.name));
  }),
);

/** What the approved request is for: the requester must still have a key in use, and I must be the helper. `active` = the keys in use of both, read now (a device added meanwhile counts). */
async function approvedRequest(connectionId: string, me: string): Promise<{ ref: DocumentReference; data: DocumentData; active: ActiveKeys } | { error: string; status: number }> {
  const ref = recoveryDoc(connectionId);
  const data = await liveRequest(connectionId);
  if (!data || data.helperUid !== me) return { status: 404, error: "There is no request from your friend" };
  if (data.status !== "approved") return { status: 409, error: "Approve the request first" };
  const active = await activeOf(data.requesterUid, me);
  if (!active.requester.length) return { status: 409, error: "Your friend has no key in use any more. Ask them to ask again." };
  return { ref, data, active };
}

/**
 * The next messages (`part=messages`, newest first, continue with `after=<next>`) or safebox files (`part=box`) that need a copy of the key for the new key,
 * each with the helper's own copies of its key (the helper can open those).
 */
recoveryRouter.get(
  "/todo",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const request = await approvedRequest(connection.id, me);
    if ("error" in request) {
      res.status(request.status).json({ error: request.error });
      return;
    }
    const { requesterUid } = request.data;
    let items: RecoveryTodoItem[] = [];
    let next: string | null = null;
    const part = req.query.part === "box" ? "box" : "messages";

    if (part === "messages") {
      let query = messageCol(requesterUid).where("connectionId", "==", connection.id).orderBy("time", "desc");
      const after = typeof req.query.after === "string" ? timeOf(req.query.after) : null;
      if (after) query = query.startAfter(after);
      const page = (await query.select("enc", "time").limit(PAGE).get()).docs;
      items = await messageNeeds(page, me, request.active);
      next = page.length === PAGE ? cursorOf(page[page.length - 1].data().time) : null;
    } else {
      items = await boxNeeds(connection.id, me, request.active);
    }
    res.json({ part, items, next } satisfies RecoveryTodo);
  }),
);

/**
 * The new copies: `{ part: "messages" | "box", items: [{ id, wraps: [wrap] }] }`. A wrap is accepted only when it is for the requester and for one of their keys in use;
 * it is added to the requester's copy of the message (or to the shared safebox item) if that has no copy for this key yet. `added` counts the messages and files that got something.
 */
recoveryRouter.post(
  "/wraps",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const request = await approvedRequest(connection.id, uidOf(res));
    if ("error" in request) {
      res.status(request.status).json({ error: request.error });
      return;
    }
    const { requesterUid } = request.data;
    const me = uidOf(res);
    const { active } = request;
    const part = req.body?.part === "box" ? "box" : "messages";
    const given: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!given.length || given.length > MAX_WRAPS_IN) {
      res.status(400).json({ error: `Send between 1 and ${MAX_WRAPS_IN} items` });
      return;
    }
    const items = given as { id?: unknown; wraps?: unknown }[];
    // a copy is for the one who asked and one of their keys in use, or for me (the helper) and one of my keys in use: nobody else
    const meant = (w: SafeboxWrap) => (w.uid === requesterUid && active.requester.includes(w.keyId)) || (w.uid === me && active.helper.includes(w.keyId));
    for (const i of items) {
      const wraps = Array.isArray(i?.wraps) ? (i.wraps as unknown[]) : [];
      if (typeof i?.id !== "string" || !i.id || !wraps.length || wraps.length > MAX_WRAPS || !wraps.every((w) => wrapValid(w) && meant(w))) {
        res.status(400).json({ error: "That is not a copy of a key for a key in use of you or your friend" });
        return;
      }
    }
    // a message has one copy for each person (each with the copies of its owner only); a safebox item is one list of copies for both
    const refsOf = (id: string) => (part === "box" ? [safeboxItems(connection.id).doc(id)] : [messageCol(requesterUid).doc(id), messageCol(me).doc(id)]);
    const added = await getFirestore().runTransaction(async (tx) => {
      const snaps = await tx.getAll(...items.flatMap((i) => refsOf(i.id as string)), { fieldMask: ["enc", "connectionId"] });
      const owners = [{ uid: requesterUid, active: active.requester }, { uid: me, active: active.helper }];
      const per = part === "box" ? 1 : 2;
      let count = 0;
      items.forEach((item, n) => {
        const fresh = item.wraps as SafeboxWrap[];
        const changes: { ref: DocumentReference; wraps: unknown[] }[] = [];
        snaps.slice(n * per, n * per + per).forEach((snap, copy) => {
          const data = snap.data();
          if (!data?.enc || !Array.isArray(data.enc.wraps)) return;
          if (part === "messages" && data.connectionId !== connection.id) return;
          const wraps = relockedWraps(data.enc.wraps, fresh, part === "box" ? owners : [owners[copy]]); // a message copy holds the copies of its owner only
          if (wraps && wraps.length > 0 && wraps.length <= MAX_WRAPS) changes.push({ ref: snap.ref, wraps });
        });
        for (const c of changes) tx.update(c.ref, { "enc.wraps": c.wraps });
        if (changes.length) count++;
      });
      if (count) tx.update(request.ref, { added: FieldValue.increment(count) });
      return count;
    });
    res.json({ added });
  }),
);

/** The helper's app has been through everything: the request is done. */
recoveryRouter.post(
  "/finish",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const request = await approvedRequest(connection.id, me);
    if ("error" in request) {
      res.status(request.status).json({ error: request.error });
      return;
    }
    // done only when nothing lacks a copy for a key in use now (a device added meanwhile counts); what the helper's device could not open is told and counted
    const remaining = await countMissing(connection.id, request.data.requesterUid, me, request.active);
    const skipped = Math.max(0, Math.floor(Number(req.body?.skipped) || 0));
    if (remaining > skipped) {
      res.status(409).json({ error: "Some messages and files still need a copy for a key in use. Run it again." });
      return;
    }
    await request.ref.update({ status: "done", skipped: remaining, finishedAt: FieldValue.serverTimestamp() });
    await tellRequester(request.data, connection, res, "done");
    await touchBoth(connection.peerUid, me);
    res.json(stateOf((await request.ref.get()).data(), me, connection.name));
  }),
);

/**
 * My requests in ALL my circles, for Home: those I was asked (`helper`) and those I made (`requester`). A request whose friendship is gone, or that is too old,
 * is deleted here. `declined` and `done` only show to the one who asked (the friend has nothing more to do).
 */
export const recoveryListRouter = Router();
recoveryListRouter.use(requireAuth);

recoveryListRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const me = uidOf(res);
    const col = getFirestore().collection(RECOVERY_COLLECTION);
    const [asked, made] = await Promise.all([col.where("helperUid", "==", me).get(), col.where("requesterUid", "==", me).get()]);
    const items: RecoveryItem[] = [];
    for (const doc of [...asked.docs, ...made.docs]) {
      const data = doc.data();
      if (isStale(data)) {
        await doc.ref.delete();
        continue;
      }
      const role = data.requesterUid === me ? "requester" : "helper";
      if (role === "helper" && (data.status === "declined" || data.status === "done")) continue;
      const circleId = (role === "helper" ? data.circleId : data.requesterCircleId) ?? DEFAULT_CIRCLE_ID;
      const entry = (await circleCol(me).doc(circleId).collection(FRIENDS_SUBCOLLECTION).doc(doc.id).get()).data();
      if (!entry || entry.status !== "confirmed") {
        await doc.ref.delete(); // the friendship is gone: nothing to help with
        continue;
      }
      items.push({ id: doc.id, circleId, role, status: data.status, friendName: await shownNameOf(entry), total: data.total ?? 0, added: data.added ?? 0, createdAt: isoOf(data.createdAt) });
    }
    res.json({ requests: items });
  }),
);
