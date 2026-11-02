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

/** Social media networks a person can add (one shared list: friends, profile, matching). */
export const SOCIAL_NETWORKS = [
  "facebook",
  "instagram",
  "tiktok",
  "snapchat",
  "twitter", // X
  "linkedin",
  "telegram",
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export type Socials = Record<SocialNetwork, string | null>;
export type SocialKeys = Record<`${SocialNetwork}Key`, string | null>;

/** Social media id/link reduced to a comparable key ("https://instagram.com/John.Doe/" -> "john.doe"). */
export function socialKey(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  v = v.replace(/^https?:\/\//, "").replace(/^(www\.|m\.|web\.|mobile\.)/, "");
  v = v.replace(
    /^(facebook\.com|fb\.com|fb\.me|tiktok\.com|instagram\.com|instagr\.am|snapchat\.com\/add|twitter\.com|x\.com|linkedin\.com\/in|t\.me|telegram\.me)\//,
    "",
  );
  const id = v.match(/profile\.php\?id=(\d+)/);
  if (id) return `id:${id[1]}`;
  v = v.split(/[?#]/)[0].replace(/\/+$/, "").replace(/^@/, "");
  return v || null;
}

/** Reads every social media field from a request body. Handles lose a leading "@". */
export function parseSocials(body: Record<string, unknown>): Socials {
  const out = {} as Socials;
  for (const n of SOCIAL_NETWORKS) {
    const v = text(body[n], 100);
    out[n] = v && n !== "facebook" && n !== "linkedin" ? v.replace(/^@/, "") || null : v;
  }
  return out;
}

/** Comparable keys (facebookKey, instagramKey, ...) used to match invitations. */
export function socialKeys(socials: Partial<Socials>): SocialKeys {
  const out = {} as SocialKeys;
  for (const n of SOCIAL_NETWORKS) out[`${n}Key`] = socialKey(socials[n]);
  return out;
}
