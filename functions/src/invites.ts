import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, QueryDocumentSnapshot, getFirestore } from "firebase-admin/firestore";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION } from "./constants";
import { circleCol, friendRequestCol, userDoc } from "./paths";
import { SOCIAL_NETWORKS } from "./validation";

/**
 * Has someone added me as a friend? Looks through every pending friend entry
 * (every "friends" subcollection of every circle) for my email, phone number or
 * social media account, and creates an incoming friend request for each one found.
 */
export async function syncIncomingInvites(token: DecodedIdToken): Promise<void> {
  const uid = token.uid;
  const me = (await userDoc(uid).get()).data() ?? {};

  const probes: [string, string][] = [];
  const email = token.email?.toLowerCase();
  if (email) probes.push(["email", email]);
  if (me.phoneKey) probes.push(["phoneKey", me.phoneKey]);
  for (const n of SOCIAL_NETWORKS) {
    if (me[`${n}Key`]) probes.push([`${n}Key`, me[`${n}Key`]]);
  }
  if (!probes.length) return;

  const found = new Map<string, QueryDocumentSnapshot>();
  for (const [field, value] of probes) {
    const snap = await getFirestore().collectionGroup(FRIENDS_SUBCOLLECTION).where(field, "==", value).get();
    snap.docs.forEach((d) => found.set(d.ref.path, d));
  }

  for (const doc of found.values()) {
    const data = doc.data();
    const circleRef = doc.ref.parent.parent; // user-account/{owner}/friend-circle/{circle}
    const ownerRef = circleRef?.parent.parent; // user-account/{owner}
    if (!circleRef || !ownerRef) continue;
    if (ownerRef.id === uid) continue; // my own entries
    if ((data.status ?? "pending") !== "pending") continue;
    if (data.incomingRequestId) continue; // a seat created for an invitation I received, not an invitation
    if (data.linkedUid && data.linkedUid !== uid) continue; // meant for someone else

    const requestRef = friendRequestCol(uid).doc(doc.id);
    if ((await requestRef.get()).exists) continue; // already known (pending, accepted or rejected)

    // One connection per pair of people: if we are already connected (or already have a
    // request going), this entry is a duplicate and is dropped from the owner's list.
    if (await isDuplicateConnection(circleRef, ownerRef.id, doc.id, uid)) {
      await doc.ref.delete();
      continue;
    }

    const owner = (await ownerRef.get()).data() ?? {};
    await requestRef.set({
      fromUid: ownerRef.id,
      fromName: owner.displayName ?? owner.email ?? "Someone",
      fromEmail: owner.email ?? null,
      circleId: circleRef.id,
      friendId: doc.id,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });
    if (!data.linkedUid) await doc.ref.update({ linkedUid: uid }); // owner now sees "waiting for them"
  }
}

/**
 * `entryId` is an entry of `ownerUid` pointing at me (`myUid`). It is a duplicate when
 *  - the owner already has ANOTHER entry linked to me (pending, waiting, confirmed or rejected), or
 *  - I already have an established connection with the owner (a confirmed entry or a seat for their request).
 * A pending entry of mine that has not been linked yet is NOT a duplicate: that is the "added each
 * other" case, which is merged into one connection when the request is seated.
 */
async function isDuplicateConnection(
  ownerCircle: FirebaseFirestore.DocumentReference,
  ownerUid: string,
  entryId: string,
  myUid: string,
): Promise<boolean> {
  const ownerLinked = await ownerCircle.collection(FRIENDS_SUBCOLLECTION).where("linkedUid", "==", myUid).get();
  if (ownerLinked.docs.some((d) => d.id !== entryId)) return true;

  const mineLinked = await circleCol(myUid)
    .doc(DEFAULT_CIRCLE_ID)
    .collection(FRIENDS_SUBCOLLECTION)
    .where("linkedUid", "==", ownerUid)
    .get();
  return mineLinked.docs.some((d) => d.id !== entryId && (d.data().status === "confirmed" || d.data().incomingRequestId));
}
