import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { ensureDefaultCircle } from "./circles";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION } from "./constants";
import { AcceptOutcome, FriendRequest } from "./models";
import { circleCol, friendRequestCol, userDoc, userFields } from "./paths";
import { ensureSeat } from "./seats";
import { nameOf, sendPush } from "./push";
import { unverifiedDetails } from "./validation";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

export const friendRequestsRouter = Router();
friendRequestsRouter.use(requireAuth);

/** Pending requests from people who added *me* as a friend. */
export async function listPendingRequests(uid: string): Promise<FriendRequest[]> {
  const snap = await friendRequestCol(uid).where("status", "==", "pending").get();
  const requests = await Promise.all(
    snap.docs.map(async (d): Promise<FriendRequest> => {
      const data = d.data();
      const sender = await userFields(data.fromUid as string, "emailLower", "emailVerified", "phoneKey", "verifiedPhone");
      return {
        id: d.id,
        fromName: data.fromName as string,
        fromEmail: (data.fromEmail as string | null) ?? null,
        message: (data.message as string | null) ?? null,
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : null,
        seated: Boolean(data.seatFriendId),
        fromUnverified: sender ? unverifiedDetails(sender) : [],
      };
    }),
  );
  return requests.sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));
}

/**
 * Confirm a request.
 *  - The requester's entry becomes "confirmed".
 *  - The requester is also in MY circle as a confirmed friend. Both entries (and the request)
 *    share the same id: one connection, one id.
 *  - If my circle has no free seat, nothing changes: the request stays pending until I free a seat.
 */
friendRequestsRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    await ensureDefaultCircle(uid);

    const requestRef = friendRequestCol(uid).doc(req.params.id);
    const myFriends = circleCol(uid).doc(DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION);

    let requester: { uid: string; friendId: string } | null = null; // who is told about the answer
    const result = await getFirestore().runTransaction<AcceptOutcome>(async (tx) => {
      requester = null;
      // ---- reads first ----
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) return "not-found";
      const request = requestSnap.data()!;
      if (request.status !== "pending") return request.status === "accepted" ? "confirmed" : "not-found";

      const requesterFriendRef = circleCol(request.fromUid)
        .doc(request.circleId)
        .collection(FRIENDS_SUBCOLLECTION)
        .doc(request.friendId);
      const requesterFriendSnap = await tx.get(requesterFriendRef);
      const requesterSnap = await tx.get(userDoc(request.fromUid));
      const mySnap = await tx.get(myFriends);

      if (!requesterFriendSnap.exists) {
        tx.delete(requestRef); // the requester deleted the connection in the meantime
        return "not-found";
      }

      // ---- writes ----
      const seat = ensureSeat(tx, {
        myFriends,
        requestId: requestRef.id,
        request,
        mySnap,
        requester: requesterSnap.data() ?? {},
        confirmed: true,
      });
      if (seat === "full") return "no-seats";

      tx.update(requesterFriendRef, {
        status: "confirmed",
        waitingForSeat: false,
        confirmedAt: FieldValue.serverTimestamp(),
      });
      tx.update(requestRef, { status: "accepted", seatFriendId: requestRef.id, acceptedAt: FieldValue.serverTimestamp() });
      requester = { uid: request.fromUid as string, friendId: request.friendId as string };
      return "confirmed";
    });

    if (result === "not-found") {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (result === "confirmed" && requester) {
      const { uid: to, friendId } = requester as { uid: string; friendId: string };
      const name = await nameOf(uid, res.locals.token as DecodedIdToken);
      await sendPush(to, { id: `answer-${friendId}-confirmed`, title: `${name} accepted your friend request`, body: "", url: "/friends", kind: "answer" });
    }
    res.json({ ok: true, result });
  }),
);

/**
 * Reject a request. The requester sees their entry as "rejected" and can delete it
 * (deleting removes the connection from both lists). My pending seat is freed.
 */
friendRequestsRouter.post(
  "/:id/reject",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    await ensureDefaultCircle(uid);

    const requestRef = friendRequestCol(uid).doc(req.params.id);
    const mySeatRef = circleCol(uid).doc(DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).doc(req.params.id);

    let requester: { uid: string; friendId: string } | null = null; // who is told about the answer
    const result = await getFirestore().runTransaction(async (tx) => {
      requester = null;
      const requestSnap = await tx.get(requestRef);
      if (!requestSnap.exists) return "not-found" as const;
      const request = requestSnap.data()!;
      if (request.status === "accepted") return "already-confirmed" as const;

      const requesterFriendRef = circleCol(request.fromUid)
        .doc(request.circleId)
        .collection(FRIENDS_SUBCOLLECTION)
        .doc(request.friendId);
      const requesterFriendSnap = await tx.get(requesterFriendRef);
      const seatSnap = await tx.get(mySeatRef);

      if (requesterFriendSnap.exists) {
        requester = { uid: request.fromUid as string, friendId: request.friendId as string };
        tx.update(requesterFriendRef, {
          status: "rejected",
          waitingForSeat: false,
          rejectedAt: FieldValue.serverTimestamp(),
        });
        }
      tx.update(requestRef, { status: "rejected", rejectedAt: FieldValue.serverTimestamp() });
      const seat = seatSnap.data();
      if (seat && seat.incomingRequestId === requestRef.id && seat.status !== "confirmed") {
        tx.delete(mySeatRef); // frees the seat
      }
      return "rejected" as const;
    });

    if (result === "not-found") {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (result === "already-confirmed") {
      res.status(409).json({ error: "This request is already confirmed" });
      return;
    }
    if (requester) {
      const { uid: to, friendId } = requester as { uid: string; friendId: string };
      const name = await nameOf(uid, res.locals.token as DecodedIdToken);
      await sendPush(to, { id: `answer-${friendId}-rejected`, title: `${name} rejected your friend request`, body: "", url: "/friends", kind: "answer" });
    }
    res.json({ ok: true });
  }),
);
