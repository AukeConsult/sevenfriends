import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { asyncHandler, requireAuth } from "./auth";
import { activeCircleOf } from "./circle-profile";
import { circleJson, ensureCircle, moveOldSettings } from "./circles";
import { friendColOf, listFriends } from "./friends";
import { HomeResult } from "./models";
import { runCheck } from "./notifications";
import { circleCol, userDoc } from "./paths";
import { detailsIn } from "./profile";

export const homeRouter = Router();
homeRouter.use(requireAuth);

/**
 * Opens Home in ONE call: the check (invitations, unread messages), the circle the app is in (made when it is not there yet), its friends
 * and my own details. The page draws once, complete. The separate calls (`/notifications/check`, `/circles`, the friends list, `/profile`) stay for the other pages.
 *
 * Two chains run at the same time, nothing waits for what it does not need:
 *  - the circle: it is made, old settings move into it, then the circle and my details (they read it) are read together;
 *  - the check, then the friends (the check may put a waiting request in a free seat, so the friends are read after it).
 */
homeRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const token = res.locals.token as DecodedIdToken;
    const uid = token.uid;
    const circleId = activeCircleOf(req);

    const circleChain = async () => {
      await ensureCircle(uid, circleId);
      await moveOldSettings(uid);
      const [circleDoc, account] = await Promise.all([circleCol(uid).doc(circleId).get(), userDoc(uid).get()]);
      const accountData = account.data() ?? {};
      return { circle: circleJson(circleDoc, accountData), profile: await detailsIn(uid, circleId, accountData) };
    };
    const friendsChain = async () => {
      const check = await runCheck(token, circleId);
      return { ...check, friends: await listFriends(friendColOf(uid, circleId), uid) };
    };

    const [mine, theirs] = await Promise.all([circleChain(), friendsChain()]);
    const result: HomeResult = { ...theirs, ...mine };
    res.json(result);
  }),
);
