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
 * The check of Home, for one circle:
 *  1. check whether someone has invited me (matching my VERIFIED email or phone number),
 *  2. collect my pending (unread) messages.
 * Used by `POST /notifications/check` and by `POST /home` (which adds everything else Home shows).
 */
export async function runCheck(token: DecodedIdToken, circleId: string): Promise<CheckResult> {
  // the unread messages do not depend on the invites: they are read while the invites are looked at
  const unread = listUnreadMessages(token.uid, circleId);
  unread.catch(() => undefined); // an early failure below must not leave this as an unhandled rejection (it is awaited at the end)
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

  const [requests, messages] = await Promise.all([listPendingRequests(token.uid, circleId), unread]);
  return { requests, messages };
}

/** Fired when the user opens Home (kept as it was; the app now opens Home with `POST /home`). */
notificationsRouter.post(
  "/check",
  asyncHandler(async (req, res) => {
    // the app is in ONE circle: only what belongs to it is looked at and answered
    res.json(await runCheck(res.locals.token as DecodedIdToken, activeCircleOf(req)));
  }),
);
