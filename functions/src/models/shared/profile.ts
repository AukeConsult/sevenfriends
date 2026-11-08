import type { ProfileColorKey } from "./profile-color";

/**
 * How friends refer to a person in a sentence about them ("Has you on his sleep list"): chosen on the profile, shown to confirmed friends.
 * Not chosen (null) is the neutral "their".
 */
export const PRONOUNS = ["he", "she"] as const;
export type Pronoun = (typeof PRONOUNS)[number];

/** The stored value when it is one of PRONOUNS, otherwise null (not chosen). */
export function pronounKey(value: unknown): Pronoun | null {
  return PRONOUNS.find((p) => p === value) ?? null;
}

/** My profile as the profile page edits it: name and phone number. */
export type ProfileDetails = {
  name: string | null;
  /** the verified number when there is one (then it cannot be edited), otherwise the contact number typed in */
  phone: string | null;
  /** true = the phone number was confirmed with an SMS code, so it can be used to find this person */
  phoneVerified: boolean;
  /** true = the email was verified (Google, email link or a clicked verification mail), so it is used to find this person */
  emailVerified: boolean;
  /** the icon (1-7, the same seven as the seats) the person chose as their own picture; null = none chosen */
  icon: number | null;
  /** the colour the person chose for their profile (shown to their friends); null = none */
  color: ProfileColorKey | null;
  /** true = the person uploaded a picture (GET /profile/picture returns it) */
  hasPicture: boolean;
  /** the country (a two-letter ISO code such as "NO") the person lives in; null = not set */
  country: string | null;
  /** the language the person chose for the app (a code such as "nb"); null = not chosen: the language of the country is used */
  language: string | null;
  /** the mood (1-4) stuck to the profile, which confirmed friends see; null = none */
  mood: number | null;
  /** a short mood message (at most 60 characters), which confirmed friends see; null = none */
  moodMessage: string | null;
  /** he or she, which confirmed friends see in sentences about this person; null = not chosen (they say "their") */
  pronoun: Pronoun | null;
};

/** What GET /profile/picture returns: the uploaded picture as a data URL (a small JPEG / PNG / WebP), or null. */
export interface ProfilePicture {
  image: string | null;
}
