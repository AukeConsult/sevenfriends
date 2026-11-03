/**
 * The sounds a person has chosen, kept on their account so they follow them to every device.
 * Each of the three is a built-in sound ("none", "ding", "chime", "bell", "pop", "marimba", "soft") or a music jingle
 * from the app's sounds folder written as "file:<file name>". `volume` is 0-100.
 */
export interface SoundPreferences {
  message: string;
  request: string;
  answer: string;
  volume: number;
}

/** What GET /preferences returns: null while the person has not chosen anything. */
export interface Preferences {
  sounds: SoundPreferences | null;
}
