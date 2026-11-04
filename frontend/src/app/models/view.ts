import { Friend } from './shared';
import { SocialDraft } from './social';

// Small types that belong to one page / form.

/** One of the 7 seats on the Friends page: taken by a friend, or empty. */
export interface FriendSlot {
  position: number;
  friend: Friend | null;
}

/** The "add a friend" form. */
export type FriendDraft = { name: string; email: string; phone: string; message: string };

/** The profile form: name, phone and social accounts (autosaved). */
export type ProfileDraft = { name: string; phone: string; country: string; language: string } & SocialDraft;

/** Where the autosave of the profile page is: nothing yet / changed / being saved / saved / failed. */
export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/** A message that arrived live (the Chat page shows it at once when it is for its feed). */
export interface LiveMessage {
  connectionId: string;
  messageId: string;
  /** counts up, so the Chat page can tell a new message from one it has already seen */
  seq: number;
}

/** The message shown after Confirm / Reject on Home. */
export interface Notice {
  kind: 'success' | 'warning';
  text: string;
}

/** The phone page has two steps: write the number, then the code from the SMS. */
export type PhoneStep = 'number' | 'code';

/** The login form either signs in or creates an account. */
export type AuthMode = 'signin' | 'signup';
