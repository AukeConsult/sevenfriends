import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, QueryDocumentSnapshot, getFirestore } from "firebase-admin/firestore";
import { FRIENDS_SUBCOLLECTION } from "./constants";
import { circleCol, friendRequestCol } from "./paths";
import { circleProfileOf } from "./circle-profile";
import { signalRefsOf } from "./signals";
import { readFields, userFields } from "./paths";
import { phoneKey } from "./validation";

/**
 * Has someone added me as a friend? Looks through every pending friend entry
 * (every "friends" subcollection of every circle) for my email or phone number,
 * and creates an incoming friend request for each one found.
 *
 * A person is reachable whether or not the email / phone is verified (social accounts never find anybody).
 * Whoever is connected to somebody who has verified nothing is told so (unverifiedDetails), because an
 * unverified address could be claimed by somebody else.
 */
export async function syncIncomingInvites(token: DecodedIdToken): Promise<void> {
  const uid = token.uid;
  const account = (await userFields(uid, "phoneKey")) ?? {};

  const probes: [string, string][] = [];
  const email = token.email?.toLowerCase();
  if (email) probes.push(["email", email]);
  // the number from the login (confirmed) and the one typed on the profile
  new Set([phoneKey(token.phone_number), account.phoneKey as string | null | undefined].filter(Boolean) as string[]).forEach((k) =>
    probes.push(["phoneKey", k]),
  );
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
      const batch = getFirestore().batch();
      batch.delete(doc.ref);
      signalRefsOf(doc.id, data.signaledUids).forEach((ref) => batch.delete(ref));
      await batch.commit();
      continue;
    }

    const owner = (await readFields(ownerRef, "displayName", "email")) ?? {};
    const shownAs = circleProfileOf(circleRef.id, (await circleRef.get()).data(), owner).name; // the name the sender has in that circle
    await requestRef.set({
      fromUid: ownerRef.id,
      fromName: shownAs ?? owner.displayName ?? owner.email ?? "Someone",
      fromEmail: owner.email ?? null,
      message: (data.message as string | null | undefined) ?? null, // what the sender wrote with the request
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
  const ownerLinked = await ownerCircle.collection(FRIENDS_SUBCOLLECTION).where("linkedUid", "==", myUid).select().get();
  if (ownerLinked.docs.some((d) => d.id !== entryId)) return true;

  const mineLinked = await circleCol(myUid)
    .doc(ownerCircle.id) // the circle of the same kind
    .collection(FRIENDS_SUBCOLLECTION)
    .where("linkedUid", "==", ownerUid)
    .select("status", "incomingRequestId")
    .get();
  return mineLinked.docs.some((d) => d.id !== entryId && (d.data().status === "confirmed" || d.data().incomingRequestId));
}
