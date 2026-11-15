import { randomUUID } from "node:crypto";
import { Router } from "express";
import { FieldValue, QueryDocumentSnapshot, getFirestore } from "firebase-admin/firestore";
import { asyncHandler } from "./auth";
import { AccountStatus } from "./models";
import { userDoc } from "./paths";

/**
 * The stamp of an account (`accountId`): a random id made when the account is created and NEVER changed, besides the user id. A device that holds
 * data of an account remembers the pair (user id, stamp); when the account is deleted the stamp is gone with it, so a device that still holds the
 * old data finds out (`POST /accounts/check`) and wipes it. A new account with the same email or phone is a new account with a new stamp.
 *
 * Accounts from before the stamp existed get theirs the first time they are read here (the sign-in sync and every look at the keys), and so do
 * their keys. Returns "" when the account does not exist: a document is never made for an account that is not there (a deleted account stays deleted).
 */
export async function ensureAccountId(uid: string): Promise<string> {
  const ref = userDoc(uid);
  const known = (await ref.get()).data()?.accountId;
  if (typeof known === "string" && known) return known;
  return getFirestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return "";
    const again = snap.data()?.accountId; // another request may have stamped it meanwhile: that one stays
    if (typeof again === "string" && again) return again;
    const accountId = randomUUID();
    tx.update(ref, { accountId, accountIdAt: FieldValue.serverTimestamp() });
    return accountId;
  });
}

/** Puts the stamp on the key documents that do not have it yet (a key published before the stamp existed). */
export async function stampKeys(accountId: string, docs: QueryDocumentSnapshot[]): Promise<void> {
  if (!accountId) return;
  const unstamped = docs.filter((d) => d.data().accountId !== accountId);
  try {
    for (let i = 0; i < unstamped.length; i += 400) {
      const batch = getFirestore().batch();
      unstamped.slice(i, i + 400).forEach((d) => batch.update(d.ref, { accountId }));
      await batch.commit();
    }
  } catch (err) {
    // best effort: a key that was deleted meanwhile (an account being erased) must not make the read fail; it is stamped by the next look
    console.error("Could not stamp the keys", err);
  }
}

export const accountsRouter = Router();

/**
 * Is this account still there? `{ uid, accountId }` -> `{ status: "active" | "gone" }`. No sign-in is needed (a device asks about an account it can no
 * longer sign in to). "gone" = no such account, or the stamp does not belong to it. To get "active" a caller must know the user id AND the secret
 * stamp, so the answer tells a stranger nothing.
 */
accountsRouter.post(
  "/check",
  asyncHandler(async (req, res) => {
    const { uid, accountId } = (req.body ?? {}) as { uid?: unknown; accountId?: unknown };
    const valid = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 128;
    let status: AccountStatus = "gone";
    if (valid(uid) && valid(accountId)) {
      const stored = (await userDoc(uid).get()).data()?.accountId;
      if (typeof stored === "string" && stored === accountId) status = "active";
    }
    res.json({ status });
  }),
);
