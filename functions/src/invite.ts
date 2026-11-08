import { randomInt } from "node:crypto";
import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { USER_ACCOUNT_COLLECTION } from "./constants";
import { circleProfileOf, activeCircleOf } from "./circle-profile";
import { circleCol, friendRequestCol, readFields, userDoc } from "./paths";

/**
 * The invite link: `https://<the app>/?invite=<code>`. Whoever opens it, signs in and confirms sends me a friend request.
 * The code is mine alone (it hides my email and phone number in the link) and can be replaced at any time: the old link stops working.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0 o 1 l i: easy to read and to type
export const CODE_LENGTH = 10;

/** A new random code (30^10 possibilities: it cannot be guessed). */
export function newCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
}

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

export const inviteRouter = Router();
inviteRouter.use(requireAuth);

/** My invite code (made the first time it is asked for). */
inviteRouter.get(
  "/code",
  asyncHandler(async (_req, res) => {
    const ref = userDoc(uidOf(res));
    const existing = (await ref.get()).data()?.inviteCode as string | undefined;
    if (existing) {
      res.json({ code: existing });
      return;
    }
    const code = newCode();
    await ref.set({ inviteCode: code }, { merge: true });
    res.json({ code });
  }),
);

/** A new code: the old link stops working. */
inviteRouter.post(
  "/code/reset",
  asyncHandler(async (_req, res) => {
    const code = newCode();
    await userDoc(uidOf(res)).set({ inviteCode: code }, { merge: true });
    res.json({ code });
  }),
);

/**
 * Whose code is this? The name and the contact details the friend request is sent to (the owner gave the link away to be contacted).
 * `self` = it is my own code (nothing else is returned then). `requestId` = the owner has already sent ME a request (answer that instead).
 */
inviteRouter.get(
  "/lookup/:code",
  asyncHandler(async (req, res) => {
    const code = String(req.params.code ?? "");
    if (code.length !== CODE_LENGTH || ![...code].every((c) => ALPHABET.includes(c))) {
      res.status(404).json({ error: "This invite link is not valid (any more)" });
      return;
    }
    const snap = await getFirestore().collection(USER_ACCOUNT_COLLECTION).where("inviteCode", "==", code).limit(1).select("displayName", "emailLower", "verifiedPhone", "phone").get();
    if (snap.empty) {
      res.status(404).json({ error: "This invite link is not valid (any more)" });
      return;
    }
    const owner = snap.docs[0];
    if (owner.id === uidOf(res)) {
      res.json({ self: true });
      return;
    }
    const data = owner.data();
    // has the owner already asked me to be their friend? (found by the check that runs when I open the app, see notifications.ts)
    const asked = await friendRequestCol(uidOf(res)).where("status", "==", "pending").where("fromUid", "==", owner.id).limit(1).select().get();
    // the name the owner has in the circle I open the link in (their circle profile, else their account name)
    const circleId = activeCircleOf(req);
    const name = circleProfileOf(circleId, await readFields(circleCol(owner.id).doc(circleId), "profile"), data).name ?? (data.displayName as string | null | undefined) ?? null;
    res.json({
      self: false,
      requestId: asked.empty ? null : asked.docs[0].id,
      name,
      email: (data.emailLower as string | null | undefined) ?? null,
      phone: (data.verifiedPhone as string | null | undefined) ?? (data.phone as string | null | undefined) ?? null,
    });
  }),
);
