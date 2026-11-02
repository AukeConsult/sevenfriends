import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { asyncHandler, requireAuth } from "./auth";
import { listPendingRequests } from "./friend-requests";
import { syncIncomingInvites } from "./invites";
import { listUnreadMessages } from "./messages";
import { placeWaitingRequests } from "./seats";

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

/**
 * Fired when the user opens Home:
 *  1. check whether someone has invited me (matching email, phone or social media),
 *  2. collect my pending (unread) messages.
 */
notificationsRouter.post(
  "/check",
  asyncHandler(async (_req, res) => {
    const token = res.locals.token as DecodedIdToken;

    try {
      await syncIncomingInvites(token);
      await placeWaitingRequests(token.uid); // free seat -> pending friend in my circle, else it keeps waiting
    } catch (err) {
      console.error("Invite check failed", err); // still return what we have
    }

    const [requests, messages] = await Promise.all([
      listPendingRequests(token.uid),
      listUnreadMessages(token.uid),
    ]);
    res.json({ requests, messages });
  }),
);
