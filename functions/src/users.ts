import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { ensureDefaultCircle } from "./circles";
import { USER_ACCOUNT_COLLECTION } from "./constants";
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
        emailLower: verified.email, // null while the email is not verified
        verifiedPhone: verified.phone,
        phoneKey: verified.phoneKey, // from the login, never from what is typed on the profile
        ...(verified.phone ? { phone: verified.phone } : {}), // a verified number is the contact number
        emailVerified: token.email_verified ?? false,
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
