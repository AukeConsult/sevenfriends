import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { touchSync } from "./sync";
import { parsePicture, readAvatar, removeAvatar, saveAvatar } from "./avatar";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAX_FRIENDS, MAX_MOOD_MESSAGE, MAX_NAME_LENGTH, MOOD_COUNT } from "./constants";
import { ProfileDetails, ProfilePicture, Socials } from "./models";
import { circleCol, userDoc } from "./paths";
import { PHONE_RE, isCountry, SOCIAL_NETWORKS, parseSocials, phoneKey, presenceOf, text } from "./validation";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

export const profileRouter = Router();
profileRouter.use(requireAuth);

/** My profile (name, phone number, social accounts), stored on the user-account document. */
function detailsOf(data: Record<string, unknown>): ProfileDetails {
  return {
    name: (data.displayName as string | null | undefined) ?? null,
    phone: (data.verifiedPhone as string | null | undefined) ?? (data.phone as string | null | undefined) ?? null,
    phoneVerified: Boolean(data.verifiedPhone),
    emailVerified: data.emailVerified === true,
    icon: Number.isInteger(data.profileIcon) ? (data.profileIcon as number) : null,
    hasPicture: Boolean(data.profilePictureAt),
    country: (data.country as string | null | undefined) ?? null,
    mood: Number.isInteger(data.mood) ? (data.mood as number) : null,
    moodMessage: (data.moodMessage as string | null | undefined) ?? null,
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
    const phoneGiven = "phone" in body;
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
    // the icon (one of the seven seat icons, friend1.svg ... friend7.svg): left out = unchanged, null = none
    const iconGiven = "icon" in body;
    if (iconGiven && body.icon !== null && !(Number.isInteger(body.icon) && body.icon >= 1 && body.icon <= MAX_FRIENDS)) {
      res.status(400).json({ error: `The icon is a number from 1 to ${MAX_FRIENDS}` });
      return;
    }

    // the country: a two-letter ISO code ("NO"); left out = unchanged, null / empty = not set
    const countryGiven = "country" in body;
    const country = typeof body.country === "string" && body.country.trim() ? body.country.trim() : null;
    if (countryGiven && body.country !== null && typeof body.country !== "string") {
      res.status(400).json({ error: "The country must be a country code such as NO" });
      return;
    }
    if (country && !isCountry(country)) {
      res.status(400).json({ error: "The country must be a country code such as NO" });
      return;
    }

    const ref = userDoc(uidOf(res));
    const before = (await ref.get()).data();
    const verifiedPhone = (before?.verifiedPhone as string | null | undefined) ?? null;
    // Phone and social accounts are CONTACT INFO for friends: nothing typed here is ever used to find people.
    // (A verified phone number is the contact number and cannot be changed here.)
    // set+merge so it also works if the account document does not exist yet
    await ref.set(
      {
        ...(nameGiven ? { displayName: name } : {}),
        ...(iconGiven ? { profileIcon: body.icon } : {}),
        ...(countryGiven ? { country } : {}),
        // only what the request carries is changed: a save that leaves the phone or an account out keeps it
        ...(phoneGiven || verifiedPhone
          ? { phone: verifiedPhone ?? phone, phoneKey: phoneKey(verifiedPhone ?? phone) } // reachable by this number, verified or not
          : {}),
        ...Object.fromEntries(Object.entries(socials).filter(([network]) => network in body)),
        profileUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    // confirmed friends see my icon: tell their apps
    if (iconGiven && (body.icon ?? null) !== (before?.profileIcon ?? null)) await touchFriends(uidOf(res));
    await touchSync(uidOf(res), "profileAt");
    res.json(detailsOf((await ref.get()).data() ?? {}));
  }),
);

/**
 * Save my mood (one of 4 icons) and its short message, on their own so that the Home page can change it without sending
 * the rest of the profile: { mood: 1-4 | null, moodMessage: text of at most 60 characters | null }. Each one left out is
 * unchanged, null or empty is none; anything wrong is refused and nothing is saved. My confirmed friends see it.
 */
profileRouter.put(
  "/mood",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const moodGiven = "mood" in body;
    if (moodGiven && body.mood !== null && !(Number.isInteger(body.mood) && body.mood >= 1 && body.mood <= MOOD_COUNT)) {
      res.status(400).json({ error: `The mood is a number from 1 to ${MOOD_COUNT}` });
      return;
    }
    const moodMessageGiven = "moodMessage" in body;
    if (moodMessageGiven && body.moodMessage !== null && typeof body.moodMessage !== "string") {
      res.status(400).json({ error: "The mood message must be text" });
      return;
    }
    if (typeof body.moodMessage === "string" && body.moodMessage.trim().length > MAX_MOOD_MESSAGE) {
      res.status(400).json({ error: `The mood message can be at most ${MAX_MOOD_MESSAGE} characters` });
      return;
    }
    const moodMessage = text(body.moodMessage, MAX_MOOD_MESSAGE);

    const ref = userDoc(uidOf(res));
    const before = (await ref.get()).data();
    await ref.set(
      {
        ...(moodGiven ? { mood: body.mood } : {}),
        ...(moodMessageGiven ? { moodMessage } : {}),
        profileUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    const saved = (await ref.get()).data() ?? {};
    // confirmed friends see the mood: tell their apps (it changes their copy of the friendship, which they listen to)
    if ((saved.mood ?? null) !== (before?.mood ?? null) || (saved.moodMessage ?? null) !== (before?.moodMessage ?? null)) await touchFriends(uidOf(res));
    await touchSync(uidOf(res), "profileAt");
    res.json(detailsOf(saved));
  }),
);

/**
 * The app reports what it is doing: { state: "active" | "passive" | "offline" } (screen on / hidden or off / signed out),
 * now and once a minute. Friends see it as a dot; an app that stops reporting counts as offline after a while.
 */
profileRouter.put(
  "/presence",
  asyncHandler(async (req, res) => {
    const state = req.body?.state;
    if (state !== "active" && state !== "passive" && state !== "offline") {
      res.status(400).json({ error: "state must be active, passive or offline" });
      return;
    }
    const ref = userDoc(uidOf(res));
    const before = presenceOf((await ref.get()).data() ?? {});
    await ref.set({ presence: state, lastSeenAt: FieldValue.serverTimestamp() }, { merge: true });
    if (before !== state) await touchFriends(uidOf(res)); // friends' apps reload at once and show the new dot
    res.json({ ok: true });
  }),
);

/**
 * A friend's mood is read from their account, so my friends' lists do not change when it does. Touching their copy of the
 * friendship makes their app (which listens to its friend list) reload at once and show the new mood.
 */
async function touchFriends(uid: string): Promise<void> {
  const mine = await circleCol(uid).doc(DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).where("status", "==", "confirmed").get();
  for (const entry of mine.docs) {
    const data = entry.data();
    if (!data.linkedUid) continue;
    const theirs = circleCol(data.linkedUid as string).doc((data.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).doc(entry.id);
    if ((await theirs.get()).exists) await theirs.update({ moodChangedAt: FieldValue.serverTimestamp() });
  }
}

// ---------------------------------------------------------------- my picture

/** My uploaded picture, as a data URL (or null). It is an object in the media cache, not part of my account document. */
profileRouter.get(
  "/picture",
  asyncHandler(async (_req, res) => {
    res.json({ image: await readAvatar(uidOf(res)) } satisfies ProfilePicture);
  }),
);

/** Save my picture: { image: "data:image/jpeg;base64,..." }, at most MAX_PICTURE_BYTES. It replaces the old one. */
profileRouter.put(
  "/picture",
  asyncHandler(async (req, res) => {
    const picture = parsePicture(req.body?.image);
    if ("error" in picture) {
      res.status(400).json({ error: picture.error });
      return;
    }
    await saveAvatar(uidOf(res), picture.bytes);
    await touchFriends(uidOf(res)); // confirmed friends see my picture: tell their apps
    await touchSync(uidOf(res), "profileAt");
    res.json({ image: req.body.image } satisfies ProfilePicture);
  }),
);

/** Remove my picture. */
profileRouter.delete(
  "/picture",
  asyncHandler(async (_req, res) => {
    await removeAvatar(uidOf(res));
    await touchFriends(uidOf(res));
    await touchSync(uidOf(res), "profileAt");
    res.status(204).end();
  }),
);
