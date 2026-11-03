import { DocumentReference, FieldValue, Transaction, getFirestore } from "firebase-admin/firestore";
import { USER_ACCOUNT_COLLECTION } from "./constants";
import { signalCol } from "./paths";

/**
 * Which accounts does a new friend entry point at? Matches the entry's email and phone number against the
 * email / phone of the accounts, verified or not (a person must be reachable; their friends are told when a detail
 * is not verified, see unverifiedDetails). The person adding is left out. Social accounts never find anybody.
 */
export async function findAccounts(email: string | null, phoneKey: string | null, excludeUid: string): Promise<string[]> {
  const probes: [string, string | null][] = [
    ["emailLower", email],
    ["phoneKey", phoneKey],
  ];
  const found = new Set<string>();
  for (const [field, value] of probes) {
    if (!value) continue;
    const snap = await getFirestore().collection(USER_ACCOUNT_COLLECTION).where(field, "==", value).limit(5).get();
    snap.docs.forEach((d) => {
      if (d.id !== excludeUid) found.add(d.id);
    });
  }
  return [...found];
}

/** Ping `uid`: somebody added them. Id = the connection id. No names, no details. */
export function writeSignal(tx: Transaction, uid: string, connectionId: string): void {
  tx.set(signalCol(uid).doc(connectionId), { connectionId, time: FieldValue.serverTimestamp() });
}

/** The pings waiting for `uid` right now (read at the start of a check, deleted when it has finished). */
export async function readSignals(uid: string): Promise<DocumentReference[]> {
  return (await signalCol(uid).get()).docs.map((d) => d.ref);
}

/** The pings an entry sent (it remembers whom in `signaledUids`), so they can be removed with it. */
export const signalRefsOf = (entryId: string, uids: string[] | undefined): DocumentReference[] =>
  (uids ?? []).map((uid) => signalCol(uid).doc(entryId));

export async function deleteRefs(refs: DocumentReference[]): Promise<void> {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = getFirestore().batch();
    refs.slice(i, i + 400).forEach((ref) => batch.delete(ref));
    await batch.commit();
  }
}
