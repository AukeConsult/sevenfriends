import { Socials } from "./social";

/** My profile as the profile page edits it: name, phone number and social accounts. */
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
  /** true = the person uploaded a picture (GET /profile/picture returns it) */
  hasPicture: boolean;
  /** the country (a two-letter ISO code such as "NO") the person lives in; null = not set */
  country: string | null;
  /** the mood (1-4) stuck to the profile, which confirmed friends see; null = none */
  mood: number | null;
  /** a short mood message (at most 60 characters), which confirmed friends see; null = none */
  moodMessage: string | null;
} & Socials;

/** What GET /profile/picture returns: the uploaded picture as a data URL (a small JPEG / PNG / WebP), or null. */
export interface ProfilePicture {
  image: string | null;
}
