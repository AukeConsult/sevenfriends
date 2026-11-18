import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { ensureDefaultCircle } from "./circles";
import { EARLY_ADOPTER_OPEN, USER_ACCOUNT_COLLECTION } from "./constants";
import { randomUUID } from "node:crypto";
import { eraseUser } from "./erase";
import { stampKeys } from "./accounts";
import { keyCol } from "./paths";
import { verifiedIdentity, firstText } from "./validation";

export const usersRouter = Router();

/** Creates or updates the signed-in user in the `user-account` collection. */
usersRouter.post(
  "/sync",
  requireAuth,
  asyncHandler(async (_req, res) => {
    const token = res.locals.token as DecodedIdToken;
    const ref = getFirestore().collection(USER_ACCOUNT_COLLECTION).doc(token.uid);

    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const verified = verifiedIdentity(token); // only what the login proves may be used to find this person
      const profile = {
        uid: token.uid,
        email: token.email ?? null,
        // People are reachable by their email whether or not it is verified; their friends are told when it is not
        emailLower: token.email?.toLowerCase() ?? null,
        emailVerified: verified.email !== null, // Google, email link and confirmed passwords arrive verified
        verifiedPhone: verified.phone,
        // a confirmed number is the key; otherwise the number typed on the profile stays (set there)
        ...(verified.phoneKey ? { phoneKey: verified.phoneKey } : {}),
        ...(verified.phone ? { phone: verified.phone } : {}), // a verified number is the contact number
        // the name from the login is only the starting point: a name the user chose on the profile page stays
        displayName: firstText(snap.data()?.displayName, token.name), // a login without a name gives none: an account may have no name
        photoURL: token.picture ?? null,
        provider: token.firebase?.sign_in_provider ?? null,
        lastLoginAt: FieldValue.serverTimestamp(),
        loginCount: FieldValue.increment(1),
        // the stamp of the account: made with the account, in the same step, and never changed (an old account that has none gets it now)
        accountId: (snap.data()?.accountId as string | undefined) || randomUUID(),
        // the early-adopter medal: once marked, always marked; while the window is open (EARLY_ADOPTER_OPEN) every account is marked, new or old
        earlyAdopter: snap.data()?.earlyAdopter === true || EARLY_ADOPTER_OPEN,
      };
      if (snap.exists) {
        tx.update(ref, profile);
      } else {
        tx.set(ref, { ...profile, createdAt: FieldValue.serverTimestamp() });
      }
    });

    await ensureDefaultCircle(token.uid);
    const saved = await ref.get();
    const accountId = (saved.data()?.accountId as string | undefined) ?? ""; // set in the step above
    await stampKeys(accountId, (await keyCol(token.uid).get()).docs); // the keys of an old account get the stamp now, not only at the next look at the keys
    res.json({ ok: true, accountId, user: saved.data() });
  }),
);

/**
 * Erase me completely: account, profile, friendships (on both sides), messages and the login itself.
 * Needs the body { "confirm": "DELETE" } so it can never happen by accident.
 */
usersRouter.delete(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.body?.confirm !== "DELETE") {
      res.status(400).json({ error: 'Send { "confirm": "DELETE" } to erase your account' });
      return;
    }
    await eraseUser((res.locals.token as DecodedIdToken).uid);
    res.status(204).end();
  }),
);
