import { Router } from "express";
import { DecodedIdToken } from "firebase-admin/auth";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { asyncHandler, requireAuth } from "./auth";
import { touchSync } from "./sync";
import { avatarOf, parsePicture, readAvatar, removeAvatar, saveAvatar } from "./avatar";
import { DEFAULT_CIRCLE_ID, MAX_FRIENDS, MAX_MOOD_MESSAGE, MAX_NAME_LENGTH, MOOD_COUNT } from "./constants";
import { ProfileDetails, ProfilePicture, profileColorKey, pronounKey } from "./models";
import { circleCol, userDoc } from "./paths";
import { activeCircleOf, circleProfileOf, saveCircleProfile, touchFriends } from "./circle-profile";
import { isLanguage } from "./models/shared/languages";
import { PHONE_RE, isCountry, phoneKey, presenceOf, text } from "./validation";

const uidOf = (res: { locals: Record<string, unknown> }) => (res.locals.token as DecodedIdToken).uid;

export const profileRouter = Router();
profileRouter.use(requireAuth);

/** My profile (name, phone number), stored on the user-account document. */
function detailsOf(data: Record<string, unknown>): ProfileDetails {
  return {
    name: (data.displayName as string | null | undefined) ?? null,
    phone: (data.verifiedPhone as string | null | undefined) ?? (data.phone as string | null | undefined) ?? null,
    phoneVerified: Boolean(data.verifiedPhone),
    emailVerified: data.emailVerified === true,
    icon: Number.isInteger(data.profileIcon) ? (data.profileIcon as number) : null,
    color: profileColorKey(data.profileColor),
    hasPicture: Boolean(data.profilePictureAt),
    country: (data.country as string | null | undefined) ?? null,
    language: (data.language as string | null | undefined) ?? null,
    mood: Number.isInteger(data.mood) ? (data.mood as number) : null,
    moodMessage: (data.moodMessage as string | null | undefined) ?? null,
    pronoun: pronounKey(data.pronoun),
  };
}

/**
 * My details as I show them in the circle the app is in: the name, colour, icon, mood and mood message are that circle's (the first circle keeps them on
 * the account); the phone, country, language, pronoun and picture are the same in every circle.
 */
async function detailsIn(uid: string, circleId: string, account: Record<string, unknown>): Promise<ProfileDetails> {
  const details = detailsOf(account);
  if (circleId === DEFAULT_CIRCLE_ID) return details;
  const mine = circleProfileOf(circleId, (await circleCol(uid).doc(circleId).get()).data(), account);
  const picture = await avatarOf(uid, circleId);
  return { ...details, name: mine.name ?? details.name, color: mine.color, icon: mine.icon, mood: mine.mood, moodMessage: mine.moodMessage, hasPicture: Boolean(picture.id) };
}

profileRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const uid = uidOf(res);
    res.json(await detailsIn(uid, activeCircleOf(req), (await userDoc(uid).get()).data() ?? {}));
  }),
);

/**
 * Save my profile (the page autosaves, so this is called often with the whole form).
 * An empty phone value removes it. `name` is optional (left out = unchanged) but can never be empty.
 */
profileRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const phoneGiven = "phone" in body;
    const phone = text(body.phone, 25);

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
    const colorGiven = "color" in body;
    if (colorGiven && body.color !== null && !profileColorKey(body.color)) {
      res.status(400).json({ error: "That is not one of the colours" });
      return;
    }
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

    // the language of the app: one of the codes in LANGUAGES ("nb"); left out = unchanged, null / empty = not chosen
    const languageGiven = "language" in body;
    const language = typeof body.language === "string" && body.language.trim() ? body.language.trim() : null;
    if (languageGiven && body.language !== null && typeof body.language !== "string") {
      res.status(400).json({ error: "The language must be a language code such as nb" });
      return;
    }
    if (language && !isLanguage(language)) {
      res.status(400).json({ error: "The language must be a language code such as nb" });
      return;
    }

    // he or she (what friends read in a sentence about me); left out = unchanged, null = not chosen
    const pronounGiven = "pronoun" in body;
    if (pronounGiven && body.pronoun !== null && !pronounKey(body.pronoun)) {
      res.status(400).json({ error: "The pronoun must be he or she" });
      return;
    }

    const circleId = activeCircleOf(req);
    const first = circleId === DEFAULT_CIRCLE_ID; // the first circle keeps name, colour and icon on the account; another circle on itself
    const ref = userDoc(uidOf(res));
    const before = (await ref.get()).data();
    const verifiedPhone = (before?.verifiedPhone as string | null | undefined) ?? null;
    // The phone number is CONTACT INFO for friends: nothing typed here is ever used to find people.
    // (A verified phone number is the contact number and cannot be changed here.)
    // set+merge so it also works if the account document does not exist yet
    await ref.set(
      {
        ...(nameGiven && first ? { displayName: name } : {}),
        ...(iconGiven && first ? { profileIcon: body.icon } : {}),
        ...(colorGiven && first ? { profileColor: body.color } : {}),
        ...(countryGiven ? { country } : {}),
        ...(languageGiven ? { language } : {}),
        ...(pronounGiven ? { pronoun: body.pronoun } : {}),
        // only what the request carries is changed: a save that leaves the phone out keeps it
        ...(phoneGiven || verifiedPhone
          ? { phone: verifiedPhone ?? phone, phoneKey: phoneKey(verifiedPhone ?? phone) } // reachable by this number, verified or not
          : {}),
        profileUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    if (!first && (nameGiven || iconGiven || colorGiven)) {
      await saveCircleProfile(uidOf(res), circleId, {
        ...(nameGiven ? { name } : {}),
        ...(iconGiven ? { icon: body.icon as number | null } : {}),
        ...(colorGiven ? { color: body.color === null ? null : profileColorKey(body.color) } : {}),
      });
      await touchFriends(uidOf(res), circleId); // only the friends in this circle see it
    }
    // confirmed friends see my icon: tell their apps
    const changed = (given: boolean, now: unknown, was: unknown) => given && (now ?? null) !== (was ?? null);
    if (changed(pronounGiven, body.pronoun, before?.pronoun) || (first && (changed(iconGiven, body.icon, before?.profileIcon) || changed(colorGiven, body.color, before?.profileColor)))) await touchFriends(uidOf(res));
    await touchSync(uidOf(res), "profileAt");
    res.json(await detailsIn(uidOf(res), circleId, (await ref.get()).data() ?? {}));
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

    const circleId = activeCircleOf(req);
    const ref = userDoc(uidOf(res));
    if (circleId !== DEFAULT_CIRCLE_ID) {
      // another circle keeps its own mood: only the friends in that circle see it
      await saveCircleProfile(uidOf(res), circleId, { ...(moodGiven ? { mood: body.mood as number | null } : {}), ...(moodMessageGiven ? { moodMessage } : {}) });
      await touchFriends(uidOf(res), circleId);
    } else {
      const before = (await ref.get()).data();
      await ref.set(
        {
          ...(moodGiven ? { mood: body.mood } : {}),
          ...(moodMessageGiven ? { moodMessage } : {}),
          profileUpdatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
      const after = (await ref.get()).data() ?? {};
      // confirmed friends see the mood: tell their apps (it changes their copy of the friendship, which they listen to)
      if ((after.mood ?? null) !== (before?.mood ?? null) || (after.moodMessage ?? null) !== (before?.moodMessage ?? null)) await touchFriends(uidOf(res));
    }
    await touchSync(uidOf(res), "profileAt");
    res.json(await detailsIn(uidOf(res), circleId, (await ref.get()).data() ?? {}));
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

// ---------------------------------------------------------------- my picture

/** My uploaded picture, as a data URL (or null). It is an object in the media cache, not part of my account document. */
profileRouter.get(
  "/picture",
  asyncHandler(async (req, res) => {
    res.json({ image: await readAvatar(uidOf(res), activeCircleOf(req)) } satisfies ProfilePicture);
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
    const circleId = activeCircleOf(req);
    await saveAvatar(uidOf(res), picture.bytes, true, circleId);
    await touchFriends(uidOf(res), circleId === DEFAULT_CIRCLE_ID ? undefined : circleId); // confirmed friends (of this circle) see my picture: tell their apps
    await touchSync(uidOf(res), "profileAt");
    res.json({ image: req.body.image } satisfies ProfilePicture);
  }),
);

/** Remove my picture. */
profileRouter.delete(
  "/picture",
  asyncHandler(async (req, res) => {
    const circleId = activeCircleOf(req);
    await removeAvatar(uidOf(res), circleId);
    await touchFriends(uidOf(res), circleId === DEFAULT_CIRCLE_ID ? undefined : circleId);
    await touchSync(uidOf(res), "profileAt");
    res.status(204).end();
  }),
);
