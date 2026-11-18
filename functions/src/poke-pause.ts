import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import { USER_ACCOUNT_COLLECTION } from "./constants";
import { touchFriends } from "./circle-profile";
import { touchSync } from "./sync";

/** The time a person's pause on pokes ends (ms), or null when pokes are on (not paused, or the pause is over). `data`: the user account fields with `pokePausedUntil`. */
export function pokePausedUntil(data: { pokePausedUntil?: unknown } | undefined | null): number | null {
  const until = data?.pokePausedUntil;
  const ms = until instanceof Timestamp ? until.toMillis() : null;
  return ms !== null && ms > Date.now() ? ms : null;
}

/** True while the person's pokes are paused: a poke then arrives as an ordinary message (no alarm), and friends see the mood "Silent". */
export const isPokePaused = (data: { pokePausedUntil?: unknown } | undefined | null): boolean => pokePausedUntil(data) !== null;

/**
 * A pause that ends by time changes what friends see (the mood "Silent" goes away) and what the person's other devices show, but nothing is written at that moment. The scheduled
 * function runs this every few minutes: for each pause that is over it tells the person's other devices and the apps of their friends to reload (the same touches as when the pause
 * is ended by hand), and removes the finished pause from the account, so it is told once. Returns how many pauses were finished. Never raises.
 */
export async function endFinishedPokePauses(now: Date = new Date()): Promise<number> {
  let ended = 0;
  try {
    const over = await getFirestore().collection(USER_ACCOUNT_COLLECTION).where("pokePausedUntil", "<=", Timestamp.fromMillis(now.getTime())).limit(200).get();
    for (const doc of over.docs) {
      try {
        await doc.ref.update({ pokePausedUntil: FieldValue.delete() }); // first: a failing touch is lost rather than repeated every few minutes
        await touchFriends(doc.id);
        await touchSync(doc.id, "profileAt");
        ended++;
      } catch (error) {
        console.error("Could not finish the poke pause of one account:", error);
      }
    }
  } catch (error) {
    console.error("Could not look for finished poke pauses:", error);
  }
  return ended;
}
