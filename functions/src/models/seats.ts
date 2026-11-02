import { CollectionReference, DocumentData, QuerySnapshot } from "firebase-admin/firestore";

/** What ensureSeat needs to give an incoming request a seat in my circle. */
export interface EnsureSeatArgs {
  myFriends: CollectionReference;
  requestId: string;
  request: DocumentData;
  mySnap: QuerySnapshot;
  requester: DocumentData;
  /** also mark the entry as confirmed */
  confirmed: boolean;
}
