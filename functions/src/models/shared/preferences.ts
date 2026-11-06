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

/**
 * Which notifications I get when the app is closed or in the background (push), and what they show. One switch per kind of
 * event; `hideText` keeps the text of a message off the lock screen (the sender stays). Kept on the account: it holds for every device.
 */
export interface NoticePreferences {
  message: boolean;
  request: boolean;
  answer: boolean;
  removed: boolean;
  hideText: boolean;
}

/** What GET /preferences returns: `sounds` is null while the person has not chosen anything; `notices` always has a value (all on, text shown). */
export interface Preferences {
  sounds: SoundPreferences | null;
  notices: NoticePreferences;
}
