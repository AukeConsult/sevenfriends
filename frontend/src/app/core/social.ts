/** Social media networks a person can add. One list used by the profile, the friend form and the friend cards. */
export const SOCIAL_NETWORKS = [
  { key: 'facebook', label: 'Facebook', hint: 'name, id or link' },
  { key: 'instagram', label: 'Instagram', hint: 'username' },
  { key: 'tiktok', label: 'TikTok', hint: 'username' },
  { key: 'snapchat', label: 'Snapchat', hint: 'username' },
  { key: 'twitter', label: 'X (Twitter)', hint: 'username' },
  { key: 'linkedin', label: 'LinkedIn', hint: 'profile name or link' },
  { key: 'telegram', label: 'Telegram', hint: 'username' },
] as const;

export type SocialKey = (typeof SOCIAL_NETWORKS)[number]['key'];
export type Socials = Record<SocialKey, string | null>;
export type SocialDraft = Record<SocialKey, string>;

export const emptySocialDraft = (): SocialDraft =>
  Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, ''])) as SocialDraft;

/** Form text -> value to send ('' becomes null). */
export const socialsFromDraft = (draft: SocialDraft): Socials =>
  Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, draft[n.key] || null])) as Socials;

/** Server value -> form text (null becomes ''). */
export const draftFromSocials = (socials: Partial<Socials>): SocialDraft =>
  Object.fromEntries(SOCIAL_NETWORKS.map((n) => [n.key, socials[n.key] ?? ''])) as SocialDraft;
