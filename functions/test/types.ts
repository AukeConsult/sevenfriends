import type { DocumentData } from "firebase-admin/firestore";

// Types used by the test helpers and the tests.

export interface Person {
  n: number;
  uid: string;
  name: string;
  email: string;
  phone: string; // "+47900000NN" (international format): the last 8 digits are unique
}

/** How I identify the person I add. */
export type Via =
  | "email"
  | "emailUpper"
  | "phone"
  | "phoneSpaced"
  | "phoneNoPrefix";

/** A friend entry as the API returns it. */
export interface Friend {
  id: string;
  name: string;
  status: "pending" | "confirmed" | "rejected";
  waiting: boolean;
  incoming: boolean;
  invited: boolean;
  requestId: string | null;
  email: string | null;
  phone: string | null;
}

/** An incoming friend request as the API returns it. */
export interface Incoming {
  id: string;
  fromName: string;
  seated: boolean;
}

/** A friend entry read straight from the database: whose circle it is in, plus its data. */
export interface Entry {
  uid: string;
  circle: string;
  id: string;
  data: DocumentData;
}

/** A request document read straight from the database: whose inbox it is in, plus its data. */
export interface Req {
  uid: string;
  id: string;
  data: DocumentData;
}

/** What the login proves about a person (the test token carries it). Both are true unless a test says otherwise. */
export interface Claims {
  emailVerified?: boolean;
  phoneVerified?: boolean;
}
