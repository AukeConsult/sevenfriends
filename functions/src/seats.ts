import {
  CollectionReference,
  DocumentData,
  FieldValue,
  QuerySnapshot,
  Timestamp,
  Transaction,
  getFirestore,
} from "firebase-admin/firestore";
import { ensureDefaultCircle } from "./circles";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAX_FRIENDS } from "./constants";
import { circleCol, friendRequestCol, userDoc } from "./paths";
import { SOCIAL_NETWORKS } from "./validation";

/** Friend entry data built from the requester's profile (name + contact details). */
export function entryFromRequester(requester: DocumentData, request: DocumentData) {
  const email = (requester.emailLower ?? requester.email?.toLowerCase?.() ?? null) as string | null;
  return {
    name: (requester.displayName ?? request.fromName ?? email ?? "Friend") as string,
    email,
    phone: requester.phone ?? null,
    phoneKey: requester.phoneKey ?? null,
    // every social media account + its match key
    ...Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, requester[n] ?? null])),
    ...Object.fromEntries(SOCIAL_NETWORKS.map((n) => [`${n}Key`, requester[`${n}Key`] ?? null])),
    linkedUid: request.fromUid as string,
  };
}

/** Does this friend entry of mine point at the requester (same email, phone or social account)? */
function pointsAt(entry: DocumentData, requester: DocumentData): boolean {
  if (entry.incomingRequestId) return false; // already a seat for an incoming request
  if (entry.status === "confirmed") return false; // an established connection is never rewritten
  if (entry.linkedUid && entry.linkedUid === requester.uid) return true;
  const email = (requester.emailLower ?? null) as string | null;
  if (email && entry.email === email) return true;
  if (requester.phoneKey && entry.phoneKey === requester.phoneKey) return true;
  return SOCIAL_NETWORKS.some((n) => requester[`${n}Key`] && entry[`${n}Key`] === requester[`${n}Key`]);
}

const millis = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : 0);

/**
 * Gives an incoming request a seat in MY circle. A connection has ONE id (the id of the
 * requester's friend entry = the request id); my entry uses that same id.
 *  - my entry with that id already exists  -> keep it
 *  - I had added them myself (other id)     -> merge into one connection with the shared id
 *  - otherwise a new entry, if there is room
 * `confirmed` = also mark the entry as confirmed. Writes nothing when it returns "full".
 */
export function ensureSeat(
  tx: Transaction,
  o: {
    myFriends: CollectionReference;
    requestId: string;
    request: DocumentData;
    mySnap: QuerySnapshot;
    requester: DocumentData;
    confirmed: boolean;
  },
): "ok" | "full" {
  const { myFriends, requestId, request, mySnap, requester, confirmed } = o;
  const confirmedFields = confirmed ? { status: "confirmed", confirmedAt: FieldValue.serverTimestamp() } : {};

  const existing = mySnap.docs.find((d) => d.id === requestId);
  if (existing) {
    tx.update(existing.ref, { incomingRequestId: requestId, ...confirmedFields });
    return "ok";
  }

  const mine = mySnap.docs.find((d) => pointsAt(d.data(), { ...requester, uid: request.fromUid }));
  if (mine) {
    tx.set(myFriends.doc(requestId), {
      ...mine.data(),
      // a new request replaces an old rejection / waiting flag: the merged connection starts as pending
      status: "pending",
      waitingForSeat: false,
      linkedUid: request.fromUid,
      connectionId: requestId,
      incomingRequestId: requestId,
      peerCircleId: request.circleId,
      ...confirmedFields,
    });
    tx.delete(mine.ref);
    tx.delete(friendRequestCol(request.fromUid).doc(mine.id)); // my own request to them is merged into theirs
    return "ok";
  }

  if (mySnap.size >= MAX_FRIENDS) return "full";

  tx.set(myFriends.doc(requestId), {
    ...entryFromRequester(requester, request),
    connectionId: requestId,
    peerCircleId: request.circleId,
    incomingRequestId: requestId,
    status: "pending",
    ...confirmedFields,
    createdAt: FieldValue.serverTimestamp(),
  });
  return "ok";
}

/**
 * Incoming requests that are still waiting for a seat get one as soon as a seat is free:
 * they appear as a pending friend in my regular circle (oldest first).
 *
 * With no free seat a request stays on my separate WAITING list (a request without `seatFriendId`,
 * shown only on the Pending page), and the requester is informed: their entry gets
 * `waitingForSeat: true`. When a seat frees up the flag is cleared again.
 */
export async function placeWaitingRequests(uid: string): Promise<void> {
  await ensureDefaultCircle(uid);
  const db = getFirestore();
  const myFriends = circleCol(uid).doc(DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION);

  const snap = await friendRequestCol(uid).where("status", "==", "pending").get();
  const waiting = snap.docs
    .filter((d) => !d.data().seatFriendId)
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
