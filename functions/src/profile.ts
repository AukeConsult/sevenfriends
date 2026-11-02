import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { MAX_NAME_LENGTH } from "./constants";
import { ProfileDetails, Socials } from "./models";
import { userDoc } from "./paths";
import { PHONE_RE, SOCIAL_NETWORKS, parseSocials, text } from "./validation";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

export const profileRouter = Router();
profileRouter.use(requireAuth);

/** My profile (name, phone number, social accounts), stored on the user-account document. */
function detailsOf(data: Record<string, unknown>): ProfileDetails {
  return {
    name: (data.displayName as string | null | undefined) ?? null,
    phone: (data.verifiedPhone as string | null | undefined) ?? (data.phone as string | null | undefined) ?? null,
    phoneVerified: Boolean(data.verifiedPhone),
    ...(Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, data[n] ?? null])) as Socials),
  };
}

profileRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    res.json(detailsOf((await userDoc(uidOf(res)).get()).data() ?? {}));
  }),
);

/**
 * Save my profile (the page autosaves, so this is called often with the whole form).
 * An empty phone / social value removes it. `name` is optional (left out = unchanged) but can never be empty.
 */
profileRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const phone = text(body.phone, 25);
    const socials = parseSocials(body);

    const nameGiven = "name" in body;
    const name = text(body.name, MAX_NAME_LENGTH);
    if (nameGiven && !name) {
      res.status(400).json({ error: "Name cannot be empty" });
      return;
    }
    if (typeof body.name === "string" && body.name.trim().length > MAX_NAME_LENGTH) {
      res.status(400).json({ error: `Name can be at most ${MAX_NAME_LENGTH} characters` });
      return;
    }
    if (phone && !PHONE_RE.test(phone)) {
      res.status(400).json({ error: "Phone number is not valid" });
      return;
    }

    const ref = userDoc(uidOf(res));
    const verifiedPhone = ((await ref.get()).data()?.verifiedPhone as string | null | undefined) ?? null;
    // Phone and social accounts are CONTACT INFO for friends: nothing typed here is ever used to find people.
    // (A verified phone number is the contact number and cannot be changed here.)
    // set+merge so it also works if the account document does not exist yet
    await ref.set(
      {
        ...(nameGiven ? { displayName: name } : {}),
        phone: verifiedPhone ?? phone,
        ...socials,
        profileUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    res.json(detailsOf((await ref.get()).data() ?? {}));
  }),
);
