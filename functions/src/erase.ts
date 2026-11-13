import { getAuth } from "firebase-admin/auth";
import { DocumentReference, Transaction, getFirestore } from "firebase-admin/firestore";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAIL_COLLECTION, OWN_REQUEST_REMINDERS } from "./constants";
import { circleCol, friendRequestCol, keyBackupCol, keyCol, messageCol, profilePictureDoc, pushDeviceCol, signalCol, userDoc } from "./paths";
import { leaveGroup } from "./groups";
import { MediaRef } from "./models";
import { deleteBox } from "./safebox";
import { deleteFolder, deleteObjects } from "./sf-cache";
import { signalRefsOf } from "./signals";
import { phoneKey } from "./validation";

/** The other side of one connection. */
type Peer = { uid: string | null; circleId: string | null; signaled: string[] };

/**
 * Erases a person from the system: the account, the profile, every friend entry and request on both
 * sides, every message they sent or received (and the files of those messages), the pings, and finally the login itself (Firebase Auth).
 *
 * A connection lives in several places that all share its id, so each one is removed with the same
 * rules as deleting a friend (friends.ts), for every connection the person has:
 *   - their own entry, the request they received, the messages in their feed
 *   - the other person's entry, the request that person received, the other person's copy of the feed
 *   - the pings (incoming-signal) that connection sent
 * Invitations they sent by email (the `mail` outbox), their push devices and their uploaded picture and everything else in their media cache folder go too.
 * Entries other people wrote for this person but that were never found (the person never opened the
 * app after being added) are removed too: they hold the person's name, email and phone number.
 *
 * The media goes FIRST: a read-only pass finds the files of every message that will go, they are deleted together with the
 * whole media cache folder of the person, and only then the transaction starts. If the database part fails, the files are
 * wiped anyway (the request can be repeated). Files of messages that arrived in between are swept once more after the commit.
 *
 * Everything in Firestore happens in ONE transaction: all the reading first, then all the deleting,
 * committed together. Either the person is gone from every list, or nothing changed at all (and the
 * transaction runs again if somebody wrote to something it read). Only the login (Firebase Auth) is
 * outside, because it is not part of Firestore: it is removed right after the commit. If that step fails
 * the data is already gone and the request can simply be repeated (safe to run twice).
 */
export async function eraseUser(uid: string): Promise<void> {
  await leaveGroups(uid); // first: the groups go on without me (the last one out deletes the group), and nothing below treats a group as a friendship
  const files = new Map<string, MediaRef>(); // the files of the messages that go (they may be in the friends' folders)
  const boxes = new Set<string>(); // the connections of the person: each has a safebox
  await getFirestore().runTransaction((tx) => eraseInTransaction(tx, uid, files, false, boxes)); // read only: which files will go
  await deleteObjects([...files.values()]);
  for (const id of boxes) await deleteBox(id);
  await deleteFolder(uid); // everything I have in the media cache: pictures, anything not sent yet

  const late = new Map<string, MediaRef>();
  await getFirestore().runTransaction((tx) => eraseInTransaction(tx, uid, late, true, boxes));
  await deleteObjects([...late.values()]); // messages that arrived while the first pass ran
  for (const id of boxes) await deleteBox(id);
  await deleteFolder(uid);

  try {
    await getAuth().deleteUser(uid);
  } catch (err: any) {
    if (err?.code !== "auth/user-not-found") throw err; // "not found" is fine (a repeated erase)
  }
}

/** Leave every group the person is in: their entry, their copies of the messages and their items in its box go, the others keep the group. */
async function leaveGroups(uid: string): Promise<void> {
  for (const circle of (await circleCol(uid).get()).docs) {
    for (const entry of (await circle.ref.collection(FRIENDS_SUBCOLLECTION).where("kind", "==", "group").get()).docs) await leaveGroup(uid, entry.ref, entry.id);
  }
}

async function eraseInTransaction(tx: Transaction, uid: string, files: Map<string, MediaRef>, write: boolean, boxes: Set<string>): Promise<void> {
  const db = getFirestore();
  const account = (await tx.get(userDoc(uid))).data() ?? {};

  const doomed = new Map<string, DocumentReference>(); // path → document
  const drop = (ref: DocumentReference) => doomed.set(ref.path, ref);
  const dropMessage = (d: FirebaseFirestore.QueryDocumentSnapshot) => {
    drop(d.ref);
    const file = d.data().media as MediaRef | undefined;
    if (file) files.set(file.objectId, file);
  };
  const peers = new Map<string, Peer>(); // connection id → the other side
  const note = (id: string, peer: Partial<Peer>) => {
    const known = peers.get(id) ?? { uid: null, circleId: null, signaled: [] };
    peers.set(id, {
      uid: peer.uid ?? known.uid,
      circleId: peer.circleId ?? known.circleId,
      signaled: [...known.signaled, ...(peer.signaled ?? [])],
    });
  };

  // ---- reads (a transaction must read everything before it deletes anything) ----

  // 1. my own circles and entries
  for (const circle of (await tx.get(circleCol(uid))).docs) {
    drop(circle.ref);
    for (const entry of (await tx.get(circle.ref.collection(FRIENDS_SUBCOLLECTION))).docs) {
      drop(entry.ref);
      const data = entry.data();
      if (data.kind === "group") continue; // left before (`leaveGroups`); a group is never wiped for the others here
      note(entry.id, { uid: data.linkedUid, circleId: data.peerCircleId, signaled: data.signaledUids });
    }
  }

  // 2. the requests I received
  for (const request of (await tx.get(friendRequestCol(uid))).docs) {
    drop(request.ref);
    note(request.id, { uid: request.data().fromUid, circleId: request.data().circleId });
  }

  // 3. entries in other people's lists that point at me, or that were written for my email / phone
  const probes: [string, string][] = [["linkedUid", uid]];
  const emails = [account.emailLower, typeof account.email === "string" ? account.email.toLowerCase() : null];
  const phones = [account.phoneKey, phoneKey(account.phone), phoneKey(account.verifiedPhone)];
  emails.filter(Boolean).forEach((e) => probes.push(["email", e]));
  phones.filter(Boolean).forEach((p) => probes.push(["phoneKey", p]));
  for (const [field, value] of probes) {
    for (const entry of (await tx.get(db.collectionGroup(FRIENDS_SUBCOLLECTION).where(field, "==", value))).docs) {
      const [, owner, , circleId] = entry.ref.path.split("/");
      if (owner === uid) continue;
      const data = entry.data();
      if (data.linkedUid && data.linkedUid !== uid) continue; // meant for somebody else
      drop(entry.ref);
      note(entry.id, { uid: owner, circleId, signaled: data.signaledUids });
    }
  }

  // 4. everything of every connection, on the other side too
  for (const [id, peer] of peers) {
    boxes.add(id);
    drop(signalCol(uid).doc(id));
    signalRefsOf(id, peer.signaled).forEach(drop);
    if (!peer.uid) continue;
    drop(friendRequestCol(peer.uid).doc(id)); // a request I sent
    drop(circleCol(peer.uid).doc(peer.circleId ?? DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).doc(id));
    drop(signalCol(peer.uid).doc(id));
    (await tx.get(messageCol(peer.uid).where("connectionId", "==", id))).docs.forEach(dropMessage);
  }

  // 5. what is still under my account: my messages (also any whose connection was gone already), pings
  (await tx.get(messageCol(uid))).docs.forEach(dropMessage);
  (await tx.get(signalCol(uid))).docs.forEach((d) => drop(d.ref));
  for (const field of ["fromUid", "toUid"]) {
    (await tx.get(db.collectionGroup("messages").where(field, "==", uid))).docs.forEach(dropMessage);
  }

  // 6. invitation emails I sent (they carry my name and my message)
  (await tx.get(db.collection(MAIL_COLLECTION).where("fromUid", "==", uid))).docs.forEach((d) => drop(d.ref));

  // 7. the devices registered for push
  (await tx.get(pushDeviceCol(uid))).docs.forEach((d) => drop(d.ref));

  // 7b. my public keys and the backup of my private key
  (await tx.get(keyCol(uid))).docs.forEach((d) => drop(d.ref));
  (await tx.get(keyBackupCol(uid))).docs.forEach((d) => drop(d.ref)); // one backup per key, and the older "current"
  (await tx.get(db.collection(OWN_REQUEST_REMINDERS).where("uid", "==", uid))).docs.forEach((d) => drop(d.ref));

  // 8. a picture saved before the media cache existed (the new one is in the cache folder, deleted after the commit)
  drop(profilePictureDoc(uid));

  // 8b. the "something changed" stamp for my other devices
  drop(userDoc(uid).collection("sync").doc("state"));

  // 9. the account itself
  drop(userDoc(uid));

  // ---- writes ----
  if (write) doomed.forEach((ref) => tx.delete(ref));
}
