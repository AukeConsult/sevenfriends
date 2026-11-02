import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { DocumentReference, FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { conversationRouter, deleteConversation } from "./conversation";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAX_FRIENDS, USER_ACCOUNT_COLLECTION } from "./constants";
import { Friend, FriendStatus, NewFriend, Socials } from "./models";
import { circleCol, friendRequestCol } from "./paths";
import { findAccounts, signalRefsOf, writeSignal } from "./signals";
import {
  EMAIL_RE,
  PHONE_RE,
  SOCIAL_NETWORKS,
  parseSocials,
  phoneKey,
  text,
} from "./validation";

function parseFriend(body: Record<string, unknown>): { data?: NewFriend; error?: string } {
  const name = text(body.name, 100);
  const email = text(body.email, 200)?.toLowerCase() ?? null;
  const phone = text(body.phone, 25);
  const socials = parseSocials(body);

  if (!name) return { error: "Name is required" };
  if (email && !EMAIL_RE.test(email)) return { error: "Email is not valid" };
  if (phone && !PHONE_RE.test(phone)) return { error: "Phone number is not valid" };
  // Only an email or a phone number can find your friend (social accounts are extra contact info),
  // so one of them is needed for the request to ever arrive.
  if (!email && !phone) {
    return { error: "Add an email or a phone number, so your friend can be found" };
  }
  return { data: { name, email, phone, ...socials } };
}

function toJson(doc: FirebaseFirestore.DocumentSnapshot): Friend {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    name: data.name,
    email: data.email ?? null,
    phone: data.phone ?? null,
    ...(Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, data[n] ?? null])) as Socials),
    status: (["confirmed", "rejected"].includes(data.status) ? data.status : "pending") as FriendStatus,
    invited: Boolean(data.linkedUid), // true = the friend has a Seven Friends account and got a request
    waiting: Boolean(data.waitingForSeat), // true = their list is full: I am on their waiting list
    incoming: Boolean(data.incomingRequestId), // true = THEY invited ME; I can confirm
    requestId: (data.incomingRequestId as string | undefined) ?? null,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
  };
}

const friendCol = (res: { locals: Record<string, unknown> }) =>
  (res.locals.circleRef as DocumentReference).collection(FRIENDS_SUBCOLLECTION);

// Mounted by circles.ts under /:circleId/friends (auth + circle lookup already done)
export const friendsRouter = Router({ mergeParams: true });

// The message feed of a connection: /circles/:circleId/friends/:friendId/messages
friendsRouter.use("/:friendId/messages", conversationRouter);

/** List the friends in a circle. */
friendsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const snap = await friendCol(res).orderBy("createdAt", "asc").get();
    res.json({ friends: snap.docs.map(toJson), max: MAX_FRIENDS });
  }),
);

/** Add a friend to the circle (max 7 per circle). */
friendsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const { data, error } = parseFriend(req.body ?? {});
    if (!data) {
      res.status(400).json({ error });
      return;
    }

    // The request stays ONLY in my list. It reaches the other person when THEY run their check
    // (Home / Friends / Pending), which matches their VERIFIED email or phone number against it.
    const keys = { phoneKey: phoneKey(data.phone) };
    // Does the friend already have an account? Then their frontend gets a ping (a signal) to run its search.
    const accounts = await findAccounts(data.email, keys.phoneKey, (res.locals.token as DecodedIdToken).uid);

    const col = friendCol(res);
    const ref = col.doc();
    const added = await getFirestore().runTransaction(async (tx) => {
      const existing = await tx.get(col);
      if (existing.size >= MAX_FRIENDS) return false;
      tx.set(ref, {
        ...data,
        ...keys,
        connectionId: ref.id, // one id for the whole connection: both lists and the request use it
        peerCircleId: DEFAULT_CIRCLE_ID, // where the other person's entry will live
        status: "pending" as FriendStatus,
        linkedUid: null, // set when the other person's check finds this entry
        signaledUids: accounts, // who got a ping for this entry (removed again if the entry is deleted)
        createdAt: FieldValue.serverTimestamp(),
      });
      for (const account of accounts) writeSignal(tx, account, ref.id);
      return true;
    });

    if (!added) {
      res.status(409).json({ error: `This circle is full (max ${MAX_FRIENDS} friends)` });
      return;
    }
    res.status(201).json(toJson(await ref.get()));
  }),
);

/**
 * Delete a connection. It is removed from BOTH lists (mine and the other person's),
 * together with the request. Both entries share the same id, so the other one is easy to find.
 */
friendsRouter.delete(
  "/:friendId",
  asyncHandler(async (req, res) => {
    const uid = (res.locals.token as DecodedIdToken).uid;
    const id = req.params.friendId;
    const ref = friendCol(res).doc(id);
    const data = (await ref.get()).data();
    if (!data) {
      res.status(204).end();
      return;
    }

    const batch = getFirestore().batch();
    batch.delete(ref);
    batch.delete(friendRequestCol(uid).doc(id)); // a request I received for this connection
    signalRefsOf(id, data.signaledUids).forEach((ref) => batch.delete(ref)); // pings that were not handled yet
    if (data.linkedUid) {
      batch.delete(friendRequestCol(data.linkedUid).doc(id)); // a request I sent for it
      batch.delete(
        circleCol(data.linkedUid)
          .doc(data.peerCircleId ?? DEFAULT_CIRCLE_ID)
          .collection(FRIENDS_SUBCOLLECTION)
          .doc(id), // the other person's entry (same id)
      );
    }
    await batch.commit();
    await deleteConversation(data.linkedUid ? [uid, data.linkedUid] : [uid], id); // its message feed goes too
    res.status(204).end();
  }),
);
