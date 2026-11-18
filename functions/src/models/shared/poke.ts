/** Pause pokes: a person can stop their pokes from ringing for a limited time (docs/design/poke-alarm.md). Shared with the frontend. */
export interface PokePause {
  /** when the pause ends (ISO time); null = pokes are on */
  until: string | null;
}

/** The longest a pause can be, in minutes (24 hours): there is no "forever". */
export const POKE_PAUSE_MAX_MINUTES = 1440;

/**
 * The mood number friends see for a person whose pokes are paused: "Silent". It is NOT stored as a mood (a person's own mood, 1 to 4, is kept under it and comes back
 * when the pause is over): the server puts it in the friend's mood while the pause lasts, in every circle.
 */
export const MOOD_SILENT = 5;
