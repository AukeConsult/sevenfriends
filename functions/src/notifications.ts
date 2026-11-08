import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { asyncHandler, requireAuth } from "./auth";
import { activeCircleOf } from "./circle-profile";
import { listPendingRequests } from "./friend-requests";
import { syncIncomingInvites } from "./invites";
import { listUnreadMessages } from "./messages";
import { CheckResult } from "./models";
import { placeWaitingRequests } from "./seats";
import { deleteRefs, readSignals } from "./signals";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * Fired when the user opens Home:
 *  1. check whether someone has invited me (matching my VERIFIED email or phone number),
 *  2. collect my pending (unread) messages.
 */
notificationsRouter.post(
  "/check",
  asyncHandler(async (req, res) => {
    const circleId = activeCircleOf(req); // the app is in ONE circle: only what belongs to it is looked at and answered
    const token = res.locals.token as DecodedIdToken;

    const signals = await readSignals(token.uid, circleId); // only the pings that are here now; later ones stay for the next check
    let handled = true;
    try {
      await syncIncomingInvites(token);
      await placeWaitingRequests(token.uid, circleId); // free seat -> pending friend in my circle, else it keeps waiting
    } catch (err) {
      handled = false;
      console.error("Invite check failed", err); // still return what we have
    }
    if (handled) await deleteRefs(signals);

    const [requests, messages] = await Promise.all([
      listPendingRequests(token.uid, circleId),
      listUnreadMessages(token.uid, circleId),
    ]);
    const result: CheckResult = { requests, messages };
    res.json(result);
  }),
);
