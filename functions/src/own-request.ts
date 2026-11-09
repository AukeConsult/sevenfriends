import { DocumentData, FieldValue, Timestamp } from "firebase-admin/firestore";
import { OwnRecoveryRequest } from "./models";
import { ownRequestCol } from "./paths";
import { sendPush } from "./push";
import { touchSync } from "./sync";

/**
 * The request of one of my devices to open my old messages and files for its key (design: docs/design/recovery-own-devices.md):
 * `user-account/{uid}/own-recovery-request/{keyId}`: { label, fingerprint, status: asked | working | declined | done, total, added, createdAt }.
 * `declined` and `done` are only news on its way (the asking device shows them and deletes the request); an old request is deleted when it is looked at.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const madeAt = (d: DocumentData): number => (d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now());
const isStale = (d: DocumentData): boolean => Date.now() - madeAt(d) > (d.status === "done" ? DAY_MS : 7 * DAY_MS);

export function requestOf(id: string, d: DocumentData): OwnRecoveryRequest {
  return {
    keyId: id,
    label: (d.label as string | undefined) ?? "",
    fingerprint: (d.fingerprint as string | undefined) ?? "",
    status: d.status,
    total: d.total ?? 0,
    added: d.added ?? 0,
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate().toISOString() : null,
  };
}

/** The request of this key, or undefined (a request that is too old is deleted here). */
export async function liveRequest(uid: string, keyId: string): Promise<DocumentData | undefined> {
  const ref = ownRequestCol(uid).doc(keyId);
  const data = (await ref.get()).data();
  if (data && isStale(data)) {
    await ref.delete();
    return undefined;
  }
  return data;
}

/** All my requests that are still live. */
export async function liveRequests(uid: string): Promise<{ id: string; data: DocumentData }[]> {
  const out: { id: string; data: DocumentData }[] = [];
  for (const doc of (await ownRequestCol(uid).get()).docs) {
    if (isStale(doc.data())) await doc.ref.delete();
    else out.push({ id: doc.id, data: doc.data() });
  }
  return out;
}

/** A device asks: the request (a new one replaces any earlier one), a push to my devices and a stamp so the open apps look again. */
export async function openRequest(uid: string, key: { id: string; label: string; fingerprint: string }, counts?: { messages: number; files: number }): Promise<void> {
  await ownRequestCol(uid).doc(key.id).set({ label: key.label, fingerprint: key.fingerprint, status: "asked", total: counts ? counts.messages + counts.files : 0, added: 0, createdAt: FieldValue.serverTimestamp() });
  await sendPush(uid, {
    id: `own-recovery-${key.id}`,
    title: `${key.label || "A new device"} wants to open your old messages`,
    body: "Open the app on a device that opens them, and tap Allow.",
    url: "/",
    kind: "request",
  });
  await touchSync(uid, "keysAt");
}

/** The work is finished: the asking device is told (a push and a stamp) and shows it, then deletes the request. */
export async function tellDone(uid: string, key: { id: string; label: string }): Promise<void> {
  await sendPush(uid, {
    id: `own-recovery-done-${key.id}`,
    title: `Your history is open on ${key.label || "your new device"}`,
    body: "",
    url: "/",
    kind: "answer",
  });
  await touchSync(uid, "keysAt");
}
