import { SocialKey, Socials } from "./models";

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^[+0-9()\-\s.]{5,25}$/;

/** Trimmed string, or null when empty / not a string. */
export function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** Phone number reduced to its last 8 digits, so "+47 926 55 195" and "92655195" match. */
export function phoneKey(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 8 ? digits.slice(-8) : null;
}

/** Social media networks a person can add (one shared list: friends, profile). */
export const SOCIAL_NETWORKS: readonly SocialKey[] = [
  "facebook",
  "instagram",
  "tiktok",
  "snapchat",
  "twitter", // X
  "linkedin",
  "telegram",
];

/** Reads every social media field from a request body. Handles lose a leading "@". */
export function parseSocials(body: Record<string, unknown>): Socials {
  const out = {} as Socials;
  for (const n of SOCIAL_NETWORKS) {
    const v = text(body[n], 100);
    out[n] = v && n !== "facebook" && n !== "linkedin" ? v.replace(/^@/, "") || null : v;
  }
  return out;
}

/**
 * Who is this person, as far as the LOGIN proves it? Only these two identifiers may be used to find
 * people, because the login provider has verified them:
 *  - an email, only when the token says it is verified (Google, an email link, or a confirmed address)
 *  - a phone number, only when it was confirmed with an SMS code (the token then has `phone_number`)
 * Anything the user types on the profile (phone, social accounts) is contact info, never an identity.
 */
export function verifiedIdentity(token: { email?: string; email_verified?: boolean; phone_number?: string }) {
  return {
    email: token.email && token.email_verified === true ? token.email.toLowerCase() : null,
    phone: token.phone_number ?? null,
    phoneKey: phoneKey(token.phone_number),
  };
}
