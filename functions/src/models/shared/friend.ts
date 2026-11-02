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
}

/** What is sent when adding a friend. */
export type NewFriend = Pick<Friend, "name" | "email" | "phone"> & Socials;

/** A request from someone who added me. */
export interface FriendRequest {
  id: string;
  fromName: string;
  fromEmail: string | null;
  createdAt: string | null;
  /** true = shown as a pending seat in my circle; false = waiting for a free seat */
  seated: boolean;
}

/** What confirming a request leads to ('no-seats': the request stays pending). */
export type AcceptResult = "confirmed" | "no-seats";
