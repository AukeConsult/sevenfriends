import { DocumentData, FieldValue } from "firebase-admin/firestore";
import { DEFAULT_CIRCLE_ID, FRIENDS_SUBCOLLECTION, MAX_FRIENDS, MAX_MOOD_MESSAGE, MAX_NAME_LENGTH, MOOD_COUNT } from "./constants";
import { CircleProfile, profileColorKey } from "./models";
import { circleCol, userDoc } from "./paths";
import { text } from "./validation";

/**
 * How a person shows in one circle (name, colour, icon, mood, mood message). The `default` circle (friends) keeps them where they always were, on the account
 * document, so nothing had to move; every other circle keeps its own on the circle document (`profile`), copied from the account (name, colour) when it is made.
 */
const profileOfAccount = (account: DocumentData): CircleProfile => ({
  name: (account.displayName as string | null | undefined) ?? null,
  color: profileColorKey(account.profileColor),
  icon: Number.isInteger(account.profileIcon) ? (account.profileIcon as number) : null,
  mood: Number.isInteger(account.mood) ? (account.mood as number) : null,
  moodMessage: (account.moodMessage as string | null | undefined) ?? null,
});

/** What a circle has set for itself; whatever it has not set (the key is missing) is the one of the account. `null` set on purpose means "none here". */
const profileOfCircle = (data: DocumentData | undefined, account: DocumentData): CircleProfile => {
  const p = (data?.profile ?? {}) as Record<string, unknown>;
  const basic = profileOfAccount(account);
  return {
    name: typeof p.name === "string" ? p.name : "name" in p ? null : basic.name,
    color: "color" in p ? profileColorKey(p.color) : basic.color,
    icon: "icon" in p ? (Number.isInteger(p.icon) ? (p.icon as number) : null) : basic.icon,
    mood: "mood" in p ? (Number.isInteger(p.mood) ? (p.mood as number) : null) : basic.mood,
    moodMessage: "moodMessage" in p ? (typeof p.moodMessage === "string" ? p.moodMessage : null) : basic.moodMessage,
  };
};

/** The profile of a circle, from what was already read (the account document and the circle document). */
export function circleProfileOf(circleId: string, circle: DocumentData | undefined, account: DocumentData): CircleProfile {
  return circleId === DEFAULT_CIRCLE_ID ? profileOfAccount(account) : profileOfCircle(circle, account);
}

/** The first profile of a new circle: nothing of its own yet, so it shows the account's name, colour, icon and mood until something is changed here. */
export const startProfile = (): Record<string, unknown> => ({});

/** The circle a request is for: the app says it in the `X-Circle` header (it is bound to one circle); none or an unknown one is the first circle. */
export const activeCircleOf = (req: { header(name: string): string | undefined }): string => {
  const id = req.header("x-circle");
  return id === "buddies" || id === "work" || id === "family" ? id : DEFAULT_CIRCLE_ID;
};

/** What a request may change: any of these, the rest stays. `null` is allowed for the colour, the mood and the mood message (they are taken off). */
export type CircleProfilePatch = Partial<Record<keyof CircleProfile, unknown>>;

/** Checks a patch; the text is the error to show when it is not valid, else the clean values to save. */
export function parseProfilePatch(body: CircleProfilePatch): { error: string } | { values: Partial<CircleProfile> } {
  const values: Partial<CircleProfile> = {};
  if ("name" in body) {
    const name = text(body.name, MAX_NAME_LENGTH);
    if (!name) return { error: "Name cannot be empty" };
    if (typeof body.name === "string" && body.name.trim().length > MAX_NAME_LENGTH) return { error: `The name can be at most ${MAX_NAME_LENGTH} characters` };
    values.name = name;
  }
  if ("color" in body) {
    if (body.color !== null && !profileColorKey(body.color)) return { error: "That colour is not one of the colours" };
    values.color = body.color === null ? null : profileColorKey(body.color);
  }
  if ("icon" in body) {
    if (body.icon !== null && !(Number.isInteger(body.icon) && (body.icon as number) >= 1 && (body.icon as number) <= MAX_FRIENDS)) return { error: `The icon is a number from 1 to ${MAX_FRIENDS}` };
    values.icon = body.icon as number | null;
  }
  if ("mood" in body) {
    if (body.mood !== null && !(Number.isInteger(body.mood) && (body.mood as number) >= 1 && (body.mood as number) <= MOOD_COUNT)) return { error: `The mood is a number from 1 to ${MOOD_COUNT}` };
    values.mood = body.mood as number | null;
  }
  if ("moodMessage" in body) {
    if (body.moodMessage !== null && typeof body.moodMessage !== "string") return { error: "The mood message must be text" };
    if (typeof body.moodMessage === "string" && body.moodMessage.trim().length > MAX_MOOD_MESSAGE) return { error: `The mood message can be at most ${MAX_MOOD_MESSAGE} characters` };
    values.moodMessage = text(body.moodMessage, MAX_MOOD_MESSAGE);
  }
  return { values };
}

/** Saves a patch: on the account for the default circle (displayName, profileColor, mood, moodMessage), on the circle document for the others. */
export async function saveCircleProfile(uid: string, circleId: string, values: Partial<CircleProfile>): Promise<void> {
  if (circleId === DEFAULT_CIRCLE_ID) {
    await userDoc(uid).set(
      {
        ...("name" in values ? { displayName: values.name } : {}),
        ...("color" in values ? { profileColor: values.color } : {}),
        ...("icon" in values ? { profileIcon: values.icon } : {}),
        ...("mood" in values ? { mood: values.mood } : {}),
        ...("moodMessage" in values ? { moodMessage: values.moodMessage } : {}),
        profileUpdatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return;
  }
  const fields = Object.fromEntries(Object.entries(values).map(([key, value]) => [`profile.${key}`, value]));
  await circleCol(uid).doc(circleId).update({ ...fields, profileUpdatedAt: FieldValue.serverTimestamp() });
}

/**
 * A friend's mood, name and colour are read from my account or circle, so my friends' lists do not change when they do. Touching their copy of the
 * friendship makes their app (which listens to its friend list) reload at once. With a circle: only the friends in that circle; without one (my picture,
 * my presence: they are the same everywhere): the friends in all my circles.
 */
export async function touchFriends(uid: string, circleId?: string): Promise<void> {
  const circles = circleId ? [circleCol(uid).doc(circleId)] : (await circleCol(uid).get()).docs.map((d) => d.ref);
  for (const circle of circles) {
    const mine = await circle.collection(FRIENDS_SUBCOLLECTION).where("status", "==", "confirmed").select("linkedUid", "peerCircleId").get();
    for (const entry of mine.docs) {
      const data = entry.data();
      if (!data.linkedUid) continue;
      const theirs = circleCol(data.linkedUid as string).doc((data.peerCircleId as string | undefined) ?? DEFAULT_CIRCLE_ID).collection(FRIENDS_SUBCOLLECTION).doc(entry.id);
      if ((await theirs.get()).exists) await theirs.update({ moodChangedAt: FieldValue.serverTimestamp() });
    }
  }
}
