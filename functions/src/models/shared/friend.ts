import { Socials } from "./social";

/** pending until the other person confirms; rejected when they rejected the request. */
export type FriendStatus = "pending" | "confirmed" | "rejected";

/** A friend entry (a seat in my circle). Its id is the id of the connection, the same for both people. */
export interface Friend extends Socials {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: FriendStatus;
  /** true when the friend has an account and has been sent a request */
  invited: boolean;
  /** true when their list is full and I am on their waiting list */
  waiting: boolean;
  /** true when THEY invited ME: this seat can be confirmed by me */
  incoming: boolean;
  requestId: string | null;
  createdAt: string | null;
  /** the message I wrote with the request (the friend sees it with the request) */
  message: string | null;
  /**
   * Which of this friend's details are unverified ("email", "phone"): they have an account but have proven neither
   * a verified email nor a confirmed phone, so I cannot be sure it is really them. Empty when they are verified.
   */
  unverified: ("email" | "phone")[];
  /** set when nobody with this email or phone has an account yet: the friend can be invited by email */
  invite: FriendInvite | null;
}

/** An invitation to Seven Friends for somebody who has no account yet. */
export interface FriendInvite {
  /** the email address or phone number the invitation goes to */
  to: string;
  /** when it was sent; null = not sent yet (I still have to confirm the address) */
  sentAt: string | null;
}

/** What is sent when adding a friend. */
export type NewFriend = Pick<Friend, "name" | "email" | "phone"> & Socials & { message?: string | null };

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
