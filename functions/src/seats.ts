import { CollectionReference, DocumentData, FieldValue, QueryDocumentSnapshot, Timestamp, Transaction, getFirestore } from "firebase-admin/firestore";
import { ensureCircle } from "./circles";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAX_FRIENDS, circleIdOf } from "./constants";
import { EnsureSeatArgs } from "./models";
import { circleCol, friendRequestCol, userDoc } from "./paths";
import { signalRefsOf } from "./signals";

/** The account a friend list belongs to: user-account/{uid}/friend-circle/{circleId}/friends -> uid. Written on every entry as `ownerUid`. */
export const ownerOf = (friends: CollectionReference): string => friends.parent?.parent?.parent?.id ?? "";

/**
 * Entries made before `ownerUid` existed get it now (the app listens to all of a person's entries with one query on that field).
 * Called whenever a list is read, so an old entry is stamped the first time its owner looks; nothing else about it changes.
 */
export async function stampOwner(docs: QueryDocumentSnapshot[], uid: string): Promise<void> {
  const missing = docs.filter((d) => d.data().ownerUid !== uid);
  if (!missing.length) return;
  const batch = getFirestore().batch();
  missing.forEach((d) => batch.update(d.ref, { ownerUid: uid }));
  await batch.commit();
}

/** Friend entry data built from the requester's profile (name + contact details). */
export function entryFromRequester(requester: DocumentData, request: DocumentData) {
  const email = (requester.emailLower ?? requester.email?.toLowerCase?.() ?? null) as string | null;
  return {
    // the name the sender has in that circle (the request carries it); the name of their account only when the request has none
    name: (request.fromName ?? requester.displayName ?? email ?? "Friend") as string,
    nameGiven: false, // not typed by me: the list shows the name they have now (see `withUnverified`)
    email,
    phone: requester.phone ?? null,
    phoneKey: requester.phoneKey ?? null,
    linkedUid: request.fromUid as string,
  };
}

/** Does this friend entry of mine point at the requester (same verified email or phone number)? */
function pointsAt(entry: DocumentData, requester: DocumentData): boolean {
  if (entry.incomingRequestId) return false; // already a seat for an incoming request
  if (entry.status === "confirmed") return false; // an established connection is never rewritten
  if (entry.linkedUid && entry.linkedUid === requester.uid) return true;
  const email = (requester.emailLower ?? null) as string | null;
  if (email && entry.email === email) return true;
  if (requester.phoneKey && entry.phoneKey === requester.phoneKey) return true;
  return false;
}

/** The seat number (1..MAX_FRIENDS) of an entry, or null when it has none (asleep, or not given yet). */
export const seatOf = (data: DocumentData): number | null =>
  data.asleep !== true && Number.isInteger(data.seat) && data.seat >= 1 && data.seat <= MAX_FRIENDS ? (data.seat as number) : null;

/** The lowest seat number that none of these entries holds (entries on the sleep list hold none). */
export function freeSeat(entries: { data(): DocumentData }[]): number | null {
  const taken = new Set(entries.map((e) => seatOf(e.data())));
  for (let n = 1; n <= MAX_FRIENDS; n++) if (!taken.has(n)) return n;
  return null;
}

/**
 * Gives every friend in a seat a seat number. Entries from before the numbers existed (and a number held twice) get the lowest free one,
 * oldest first, and it is stored: from then on the friend keeps it. Called before anything that adds, wakes or moves a friend, and by the list.
 * Returns the seat of every friend in a seat (entry id -> number).
 */
export async function assignMissingSeats(friends: CollectionReference): Promise<Map<string, number>> {
  const snap = await friends.orderBy("createdAt", "asc").get();
  const seats = new Map<string, number>();
  const held = new Set<number>();
  for (const d of snap.docs) {
    const n = seatOf(d.data());
    if (n && !held.has(n)) { held.add(n); seats.set(d.id, n); }
  }
  const batch = getFirestore().batch();
  let changed = false;
  for (const d of snap.docs) {
    if (d.data().asleep === true || seats.has(d.id)) continue;
    let n = 1;
    while (held.has(n)) n++;
    if (n > MAX_FRIENDS) continue; // more friends than seats cannot happen; such an entry stays without a number
    held.add(n);
    seats.set(d.id, n);
    batch.update(d.ref, { seat: n });
    changed = true;
  }
  if (changed) await batch.commit();
  return seats;
}

const millis = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : 0);

/**
 * Gives an incoming request a seat in MY circle. A connection has ONE id (the id of the
 * requester's friend entry = the request id); my entry uses that same id.
 *  - my entry with that id already exists  -> keep it
 *  - I had added them myself (other id)     -> merge into one connection with the shared id
 *  - otherwise a new entry, if there is room
 * `confirmed` = also mark the entry as confirmed. When every seat is taken, a confirmed friend is still added, on the sleep list (no seat): "asleep".
 * Without `confirmed`, nothing is written when it returns "full".
 */
export function ensureSeat(
  tx: Transaction,
  o: EnsureSeatArgs,
): "ok" | "full" | "asleep" {
  const { myFriends, requestId, request, mySnap, requester, confirmed } = o;
  const confirmedFields = confirmed ? { status: "confirmed", confirmedAt: FieldValue.serverTimestamp() } : {};

  const existing = mySnap.docs.find((d) => d.id === requestId);
  if (existing) {
    tx.update(existing.ref, { incomingRequestId: requestId, ...confirmedFields });
    return "ok";
  }

  const mine = mySnap.docs.find((d) => pointsAt(d.data(), { ...requester, uid: request.fromUid }));
  if (mine) {
    const mineSeat = seatOf(mine.data()) ?? freeSeat(mySnap.docs.filter((d) => d.id !== mine.id));
    const sleeps = Boolean(confirmed) && mineSeat === null; // no seat left for a friend who is confirmed now: the sleep list
    tx.set(myFriends.doc(requestId), {
      ...mine.data(),
      // a new request replaces an old rejection / waiting flag: the merged connection starts as pending
      status: "pending",
      waitingForSeat: false,
      linkedUid: request.fromUid,
      ownerUid: ownerOf(myFriends),
      circleId: myFriends.parent?.id ?? DEFAULT_CIRCLE_ID, // my circle
      connectionId: requestId,
      incomingRequestId: requestId,
      peerCircleId: request.circleId,
      seat: mineSeat,
      ...(sleeps ? { asleep: true } : {}),
      ...confirmedFields,
    });
    tx.delete(mine.ref);
    tx.delete(friendRequestCol(request.fromUid).doc(mine.id)); // my own request to them is merged into theirs
    signalRefsOf(mine.id, mine.data().signaledUids).forEach((ref) => tx.delete(ref)); // and so are its pings
    return sleeps ? "asleep" : "ok";
  }

  const full = mySnap.docs.filter((d) => d.data().asleep !== true).length >= MAX_FRIENDS; // friends on the sleep list have no seat
  if (full && !confirmed) return "full";

  tx.set(myFriends.doc(requestId), {
    ...entryFromRequester(requester, request),
    ownerUid: ownerOf(myFriends),
    circleId: myFriends.parent?.id ?? DEFAULT_CIRCLE_ID, // my circle
    connectionId: requestId,
    peerCircleId: request.circleId,
    incomingRequestId: requestId,
    status: "pending",
    seat: full ? null : freeSeat(mySnap.docs),
    ...(full ? { asleep: true } : {}),
    ...confirmedFields,
    createdAt: FieldValue.serverTimestamp(),
  });
  return full ? "asleep" : "ok";
}

/**
 * Incoming requests that are still waiting for a seat get one as soon as a seat is free:
 * they appear as a pending friend in my regular circle (oldest first).
 *
 * With no free seat a request stays on my separate WAITING list (a request without `seatFriendId`,
 * shown only on the Pending page), and the requester is informed: their entry gets
 * `waitingForSeat: true`. When a seat frees up the flag is cleared again.
 */
export async function placeWaitingRequests(uid: string, circleId: string = DEFAULT_CIRCLE_ID): Promise<void> {
  await ensureCircle(uid, circleId); // only the requests for this circle are placed: the app in it is blind to the others
  const db = getFirestore();
  const myFriends = circleCol(uid).doc(circleId).collection(FRIENDS_SUBCOLLECTION);

  await assignMissingSeats(myFriends); // friends from before the seat numbers get theirs first
  const snap = await friendRequestCol(uid).where("status", "==", "pending").select("seatFriendId", "createdAt", "circleId").get();
  const waiting = snap.docs
    .filter((d) => !d.data().seatFriendId && circleIdOf(d.data()) === circleId)
    .sort((a, b) => millis(a.data().createdAt) - millis(b.data().createdAt));

  for (const doc of waiting) {
    await db.runTransaction(async (tx) => {
      // ---- reads first ----
      const requestSnap = await tx.get(doc.ref);
      const request = requestSnap.data();
      if (!request || request.status !== "pending" || request.seatFriendId) return;

      const mySnap = await tx.get(myFriends);
      const requesterSnap = await tx.get(userDoc(request.fromUid));
      const requesterFriendRef = circleCol(request.fromUid)
        .doc(request.circleId)
        .collection(FRIENDS_SUBCOLLECTION)
        .doc(request.friendId);
      const requesterFriend = await tx.get(requesterFriendRef);
      const flagged = Boolean(requesterFriend.data()?.waitingForSeat);

      // ---- writes ----
      const seat = ensureSeat(tx, {
        myFriends,
        requestId: doc.id,
        request,
        mySnap,
        requester: requesterSnap.data() ?? {},
        confirmed: false,
      });

      if (seat === "full") {
        // keep it on my waiting list and tell the requester
        if (requesterFriend.exists && !flagged) {
          tx.update(requesterFriendRef, { waitingForSeat: true, waitingSince: FieldValue.serverTimestamp() });
        }
        return;
      }

      tx.update(doc.ref, { seatFriendId: doc.id });
      if (requesterFriend.exists && flagged) tx.update(requesterFriendRef, { waitingForSeat: false });
    });
  }
}
