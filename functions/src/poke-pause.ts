import { Timestamp } from "firebase-admin/firestore";

/** The time a person's pause on pokes ends (ms), or null when pokes are on (not paused, or the pause is over). `data`: the user account fields with `pokePausedUntil`. */
export function pokePausedUntil(data: { pokePausedUntil?: unknown } | undefined | null): number | null {
  const until = data?.pokePausedUntil;
  const ms = until instanceof Timestamp ? until.toMillis() : null;
  return ms !== null && ms > Date.now() ? ms : null;
}

/** True while the person's pokes are paused: a poke then arrives as an ordinary message (no alarm), and friends see the mood "Silent". */
export const isPokePaused = (data: { pokePausedUntil?: unknown } | undefined | null): boolean => pokePausedUntil(data) !== null;
