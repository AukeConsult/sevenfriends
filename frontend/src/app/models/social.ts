import { SocialKey } from './shared';

/** How one network is shown in the forms and on the cards (the list is SOCIAL_NETWORKS in core/social.ts). */
export interface SocialNetworkInfo {
  key: SocialKey;
  label: string;
  hint: string;
}

/** The same accounts as text in a form ('' = none). */
export type SocialDraft = Record<SocialKey, string>;
