import type { Pronoun } from "./profile";

/** pending until the other person confirms; rejected when they rejected the request. */
export type FriendStatus = "pending" | "confirmed" | "rejected";

/** A friend entry (a seat in my circle). Its id is the id of the connection, the same for both people. */
export interface Friend {
  id: string;
  /** the circle this friend is in (my circle): the friendship, its seat, its messages and its safebox belong to it */
  circleId: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: FriendStatus;
  /** true when the friend has an account and has been sent a request */
  invited: boolean;
  /** only in the answer to adding a friend: the person already has an account, so the request is with them (the link is not needed). `invited` follows when they open the app. */
  onApp?: boolean;
  /** true when their list is full and I am on their waiting list */
  waiting: boolean;
  /** true = on my sleep list: not in a seat any more, the conversation and its files are kept (I can wake them up again) */
  asleep: boolean;
  /** the number (1-7) of the seat this friend sits in; it stays when other seats become free or are taken. null = on the sleep list (no seat) */
  seat: number | null;
  /** true = this friend has put ME on THEIR sleep list (they may not see my messages soon) */
  sleepsMe: boolean;
  /** true when THEY invited ME: this seat can be confirmed by me */
  incoming: boolean;
  requestId: string | null;
  createdAt: string | null;
  /** when the two of you last wrote to each other (either way), for confirmed friends; null = never */
  lastSpokenAt: string | null;
  /** the friend's country (a two-letter code), shown for confirmed friends only; null = not set */
  country: string | null;
  /** the friend's mood (1-4), shown for confirmed friends only; null = none */
  mood: number | null;
  /** the friend's short mood message, shown for confirmed friends only; null = none */
  moodMessage: string | null;
  /** how the friend is referred to in a sentence (he / she), shown for confirmed friends only; null = not chosen ("their") */
  pronoun: Pronoun | null;
  /** the icon (1-7) the friend chose for themselves; null = none (then the seat icon is shown). Confirmed friends only. */
  icon: number | null;
  /** the colour the friend chose for their profile (a key of PROFILE_COLORS); null = none. Confirmed friends only. */
  color: string | null;
  /** when the friend last changed their uploaded picture; null = no picture. It tells the app when to fetch it again (`GET .../friends/:id/picture`). Confirmed friends only. */
  pictureAt: string | null;
  /** the object id of that picture in the media cache (`/api/sf-cache/<friend's user id>/<pictureId>`), null = no picture. Confirmed friends only. */
  pictureId: string | null;
  /** whether the friend is using the app right now (set by the system, confirmed friends only; 'offline' otherwise) */
  presence: Presence;
  /** the message I wrote with the request (the friend sees it with the request) */
  message: string | null;
  /**
   * Which of this friend's details are unverified ("email", "phone"): they have an account but have proven neither
   * a verified email nor a confirmed phone, so I cannot be sure it is really them. Empty when they are verified.
   */
  unverified: ("email" | "phone")[];
  /** set when nobody with this email or phone has an account yet: the friend can be invited by email */
  invite: FriendInvite | null;
  /** true = this "friend" is a group (several people, one conversation and one safebox); it sits in a seat like a friend */
  group?: boolean;
  /** a group: how many people are in it */
  members?: number;
  /** a group: what it is for (any member can change it) */
  description?: string;
}

/** Make a group (it is made as a friend entry of mine: a seat, the sleep list and delete work the same). */
export interface NewGroup {
  name: string;
}

/** An invitation to Seven Friends for somebody who has no account yet. */
export interface FriendInvite {
  /** the email address or phone number the invitation goes to */
  to: string;
  /** when it was sent; null = not sent yet (I still have to confirm the address) */
  sentAt: string | null;
}

/** What is sent when adding a friend. */
export type NewFriend = Pick<Friend, "name" | "email" | "phone"> & { message?: string | null };

/** A request from someone who added me. */
export interface FriendRequest {
  id: string;
  fromName: string;
  fromEmail: string | null;
  /** which of the sender's details are unverified ("email", "phone"): they have not proven who they are */
  fromUnverified: ("email" | "phone")[];
  /** the message the sender wrote with the request */
  message: string | null;
  createdAt: string | null;
  /** true = shown as a pending seat in my circle; false = waiting for a free seat */
  seated: boolean;
}

/** What confirming a request leads to ('no-seats': the request stays pending). */
export type AcceptResult = "confirmed" | "no-seats";

/**
 * What the system knows about a person using the app: 'active' = the app is open and the screen is on,
 * 'passive' = signed in but the screen is hidden or off, 'offline' = signed out or not heard from for a while.
 */
export type Presence = "active" | "passive" | "offline";

/** What a member changes of a group: the name, the description and the picture (a data URL, `null` = remove it). Every member can; what is left out stays. */
export interface GroupChange {
  name?: string;
  description?: string;
  picture?: string | null;
}

/** One member of a group, for its profile page. `friendId`: my own friend entry for this person (null = not my friend, or me). */
export interface GroupMember {
  uid: string;
  name: string;
  you: boolean;
  /** made the group: can remove the others */
  creator: boolean;
  friendId: string | null;
  /** who added this person (null: the maker, or not known) */
  invitedBy: string | null;
  /** I may remove this person (the maker removes anybody, and whoever added a member removes that member) */
  canRemove: boolean;
}
