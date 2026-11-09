import { DocumentReference, FieldValue, Transaction, WriteBatch } from "firebase-admin/firestore";
import { userDoc } from "./paths";

/**
 * ALL the "tell the other devices" code of the backend is here. Nothing is pushed: the app listens to its own Firestore
 * data (realtime.service.ts), so a change is announced by writing a stamp that the app can see change:
 *
 *   my profile / my sounds changed   user-account/<uid>/sync/state   (touchSync)
 *   my friend requests changed       user-account/<uid>/sync/state   (touchSync, `requestsAt`: a request that reached me is gone or was answered)
 *   a message feed changed           `messagesChangedAt` on the friendship entry (touchFeed, touchFeedIfExists)
 *   a friend put me to sleep         `theyAsleep` on my entry of the friendship (tellFriendAsleep)
 *
 * A new feature that must show on another device calls one of these, it never writes a stamp by hand.
 */

/**
 * The same person is signed in on several devices, or somebody else changed what I see: my profile (`profileAt`) or my sounds (`preferencesAt`) changed,
 * or the requests that reached me did (`requestsAt`: the person who asked deleted the request, or I answered it on another device).
 */
export async function touchSync(uid: string, field: "profileAt" | "preferencesAt" | "requestsAt"): Promise<void> {
  try {
    await userDoc(uid).collection("sync").doc("state").set({ [field]: FieldValue.serverTimestamp() }, { merge: true });
  } catch (err) {
    console.error(`Could not tell the other devices of ${uid} about a change of ${field}`, err); // the change itself is saved; other devices catch up when they reload
  }
}

/** The feed of this friendship changed: an open Chat page on that entry's owner's devices reloads. The entry must exist. */
export function touchFeed(batch: WriteBatch, entry: DocumentReference): void {
  batch.update(entry, { messagesChangedAt: FieldValue.serverTimestamp() });
}

/** Same, for the FRIEND's copy of the friendship, which may be gone (then nothing is written). */
export async function touchFeedIfExists(batch: WriteBatch, entry: DocumentReference): Promise<void> {
  if ((await entry.get()).exists) touchFeed(batch, entry);
}

/** I put this friend to sleep (or woke them): their entry of the friendship says so, and their app shows it at once. */
export function tellFriendAsleep(tx: Transaction, theirEntry: DocumentReference, asleep: boolean): void {
  tx.update(theirEntry, { theyAsleep: asleep });
}
