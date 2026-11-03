import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { ensureDefaultCircle } from "./circles";
import { USER_ACCOUNT_COLLECTION } from "./constants";
import { eraseUser } from "./erase";
import { verifiedIdentity } from "./validation";

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
        displayName: (snap.data()?.displayName as string | null | undefined) ?? token.name ?? null,
        photoURL: token.picture ?? null,
        provider: token.firebase?.sign_in_provider ?? null,
        lastLoginAt: FieldValue.serverTimestamp(),
        loginCount: FieldValue.increment(1),
      };
      if (snap.exists) {
        tx.update(ref, profile);
      } else {
        tx.set(ref, { ...profile, createdAt: FieldValue.serverTimestamp() });
      }
    });

    await ensureDefaultCircle(token.uid);

    const saved = await ref.get();
    res.json({ ok: true, user: saved.data() });
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
