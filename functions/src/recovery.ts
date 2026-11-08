import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentData, DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { MAX_WRAPS, wrapValid } from "./box-encryption";
import { connectionOf } from "./conversation";
import { publishedKeysOf } from "./keys";
import { RecoveryState, RecoveryTodo, RecoveryTodoItem, SafeboxWrap } from "./models";
import { messageCol, recoveryDoc, safeboxItems } from "./paths";
import { nameOf, sendPush } from "./push";

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

function stateOf(data: DocumentData | undefined, me: string, friendName: string): RecoveryState {
  if (!data) return { role: "none", status: "none", keyId: null, fingerprint: null, total: 0, added: 0, friendName };
  return {
    role: data.requesterUid === me ? "requester" : "helper",
    status: data.status,
    keyId: data.keyId,
    fingerprint: data.fingerprint,
    total: data.total ?? 0,
    added: data.added ?? 0,
    friendName,
  };
}

/** My request or the request of my friend for this friendship, and nothing else. */
recoveryRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    res.json(stateOf((await recoveryDoc(connection.id).get()).data(), uidOf(res), connection.name));
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
    const target = mine[mine.length - 1]; // the newest key in use
    const data = {
      requesterUid: me,
      helperUid: connection.peerUid,
      keyId: target.id,
      fingerprint: target.fingerprint,
      status: "asked",
      total: 0,
      added: 0,
      circleId: connection.peerCircleId,
      createdAt: FieldValue.serverTimestamp(),
    };
    await recoveryDoc(connection.id).set(data);
    const fromName = await nameOf(me, res.locals.token as DecodedIdToken, connection.circleId);
    await sendPush(connection.peerUid, {
      circleId: connection.peerCircleId,
      id: `recovery-${connection.id}`,
      title: `${fromName} needs your help`,
      body: "Open the app to unlock their old messages again.",
      url: `/friends/${connection.id}/recovery`,
      kind: "request",
    });
    res.status(201).json(stateOf((await recoveryDoc(connection.id).get()).data(), me, connection.name));
  }),
);

/** Stop: the one who asked takes the request back, or the friend turns it down. */
recoveryRouter.delete(
  "/",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    await recoveryDoc(connection.id).delete();
    res.json({ ok: true });
  }),
);

/** The messages (of the requester's copy) and the safebox files that still need a copy of the key for the new key. */
async function countMissing(connectionId: string, requester: string, inUse: string[]): Promise<number> {
  const messages = await messageCol(requester).where("connectionId", "==", connectionId).select("enc").get();
  const box = await safeboxItems(connectionId).select("enc").get();
  return [...messages.docs, ...box.docs].filter((d) => missingKeys(d.data().enc, inUse).length).length;
}

/** The friend says yes: from now on the friend's app may send the new copies. Only the friend who was asked. */
recoveryRouter.post(
  "/approve",
  asyncHandler(async (req, res) => {
    const connection = await connectionOf(req, res);
    if (!connection) return;
    const me = uidOf(res);
    const ref = recoveryDoc(connection.id);
    const data = (await ref.get()).data();
    if (!data || data.helperUid !== me) {
      res.status(404).json({ error: "There is no request from your friend" });
      return;
    }
    if (data.status === "asked") {
      const total = await countMissing(connection.id, data.requesterUid, (await publishedKeysOf(data.requesterUid)).map((k) => k.id));
      await ref.update({ status: "approved", total, added: 0, approvedAt: FieldValue.serverTimestamp() });
    }
    res.json(stateOf((await ref.get()).data(), me, connection.name));
  }),
);

/** What the approved request is for: the requester must still have a key in use (`inUse`: all of them), and I must be the helper. */
async function approvedRequest(connectionId: string, me: string): Promise<{ ref: DocumentReference; data: DocumentData; inUse: string[] } | { error: string; status: number }> {
  const ref = recoveryDoc(connectionId);
  const data = (await ref.get()).data();
  if (!data || data.helperUid !== me) return { status: 404, error: "There is no request from your friend" };
  if (data.status !== "approved") return { status: 409, error: "Approve the request first" };
  const inUse = (await publishedKeysOf(data.requesterUid)).map((k) => k.id);
  if (!inUse.length) return { status: 409, error: "Your friend has no key in use any more. Ask them to ask again." };
  return { ref, data, inUse };
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
    const { inUse } = request;
    const items: RecoveryTodoItem[] = [];
    let next: string | null = null;
    const part = req.query.part === "box" ? "box" : "messages";

    if (part === "messages") {
      let query = messageCol(requesterUid).where("connectionId", "==", connection.id).orderBy("time", "desc");
      const after = typeof req.query.after === "string" ? timeOf(req.query.after) : null;
      if (after) query = query.startAfter(after);
      const page = (await query.select("enc", "time").limit(PAGE).get()).docs;
      const needing = page.filter((d) => missingKeys(d.data().enc, inUse).length);
      const missingOf = new Map(needing.map((d) => [d.id, missingKeys(d.data().enc, inUse)]));
      const mine = needing.length ? await getFirestore().getAll(...needing.map((d) => messageCol(me).doc(d.id)), { fieldMask: ["enc"] }) : [];
      for (const copy of mine) {
        const wraps = (copy.data()?.enc?.wraps ?? []) as SafeboxWrap[];
        if (wraps.length) items.push({ id: copy.id, wraps, missing: missingOf.get(copy.id) ?? [] });
      }
      next = page.length === PAGE ? cursorOf(page[page.length - 1].data().time) : null;
    } else {
      for (const d of (await safeboxItems(connection.id).select("enc").get()).docs) {
        const enc = d.data().enc;
        const missing = missingKeys(enc, inUse);
        if (!missing.length) continue;
        const wraps = (enc.wraps as SafeboxWrap[]).filter((w) => w.uid === me);
        if (wraps.length) items.push({ id: d.id, wraps, missing });
      }
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
    const part = req.body?.part === "box" ? "box" : "messages";
    const given: unknown[] = Array.isArray(req.body?.items) ? req.body.items : [];
    if (!given.length || given.length > MAX_WRAPS_IN) {
      res.status(400).json({ error: `Send between 1 and ${MAX_WRAPS_IN} items` });
      return;
    }
    const items = given as { id?: unknown; wraps?: unknown }[];
    for (const i of items) {
      const wraps = Array.isArray(i?.wraps) ? (i.wraps as unknown[]) : [];
      if (typeof i?.id !== "string" || !i.id || !wraps.length || wraps.length > MAX_WRAPS || !wraps.every((w) => wrapValid(w) && w.uid === requesterUid && request.inUse.includes(w.keyId))) {
        res.status(400).json({ error: "That is not a copy of a key for one of your friend's keys" });
        return;
      }
    }
    const refs = items.map((i) => (part === "box" ? safeboxItems(connection.id).doc(i.id as string) : messageCol(requesterUid).doc(i.id as string)));
    const snaps = await getFirestore().getAll(...refs, { fieldMask: ["enc", "connectionId"] });
    const batch = getFirestore().batch();
    let added = 0;
    snaps.forEach((snap, n) => {
      const data = snap.data();
      if (!data?.enc || !Array.isArray(data.enc.wraps)) return;
      if (part === "messages" && data.connectionId !== connection.id) return;
      const fresh = (items[n].wraps as SafeboxWrap[]).filter((w) => !hasCopyFor(data.enc, w.keyId)).map((w) => ({ uid: w.uid, keyId: w.keyId, wrappedKey: w.wrappedKey }));
      if (!fresh.length) return;
      batch.update(snap.ref, { "enc.wraps": [...data.enc.wraps, ...fresh] });
      added++;
    });
    if (added) {
      batch.update(request.ref, { added: (request.data.added ?? 0) + added });
      await batch.commit();
    }
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
    await request.ref.update({ status: "done", finishedAt: FieldValue.serverTimestamp() });
    res.json(stateOf((await request.ref.get()).data(), me, connection.name));
  }),
);
