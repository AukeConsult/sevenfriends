import { Socials } from "./social";

/** My profile as the profile page edits it: name, phone number and social accounts. */
export type ProfileDetails = {
  name: string | null;
  /** the verified number when there is one (then it cannot be edited), otherwise the contact number typed in */
  phone: string | null;
  /** true = the phone number was confirmed with an SMS code, so it can be used to find this person */
  phoneVerified: boolean;
} & Socials;
