import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { userDoc } from "./paths";
import { PHONE_RE, SOCIAL_NETWORKS, parseSocials, phoneKey, socialKeys, text } from "./validation";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

export const profileRouter = Router();
profileRouter.use(requireAuth);

/** My contact details, stored on the user-account document. */
profileRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const data = (await userDoc(uidOf(res)).get()).data() ?? {};
    res.json({
      phone: data.phone ?? null,
      ...Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n, data[n] ?? null])),
    });
  }),
);

/** Save my phone number and social media accounts (empty value = remove). */
profileRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const phone = text(body.phone, 25);
    const socials = parseSocials(body);

    if (phone && !PHONE_RE.test(phone)) {
      res.status(400).json({ error: "Phone number is not valid" });
      return;
    }

    // set+merge so it also works if the account document does not exist yet
    await userDoc(uidOf(res)).set(
      {
        phone,
        ...socials,
        // normalised copies used to match invitations
        phoneKey: phoneKey(phone),
        ...socialKeys(socials),
        profileUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    res.json({ phone, ...socials });
  }),
);
