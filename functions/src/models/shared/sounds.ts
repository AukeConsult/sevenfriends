/**
 * ALL the sounds of the app, in one list. The id is what is saved on the account (`SoundPreferences`) and what every part reads:
 * - `id`: the saved choice ("none", a built-in sound, or "file:<file name>" for a jingle in `frontend/public/sounds`)
 * - `androidKey`: the end of the Android channel name `friends_<kind>_<androidKey>` (the push names it, `Channels.java` makes it)
 * - `kind`: `none` plays nothing; `builtin` is made in the browser (the phone plays its own sound for it); `jingle` is a sound file
 * Android (Java) cannot import this: `Channels.java` has the same jingle keys, and `docs/guide/live-and-notifications.md` names both.
 */
export type SoundKind = "none" | "builtin" | "jingle";

export interface SoundInfo {
  id: string;
  kind: SoundKind;
  androidKey: "silent" | "default" | "drill" | "hyper" | "acidbreaks";
  /** the English name (the apps translate or read it from the file list) */
  label: string;
}

export const SOUNDS: readonly SoundInfo[] = [
  { id: "none", kind: "none", androidKey: "silent", label: "No sound" },
  { id: "ding", kind: "builtin", androidKey: "default", label: "Ding" },
  { id: "chime", kind: "builtin", androidKey: "default", label: "Chime" },
  { id: "bell", kind: "builtin", androidKey: "default", label: "Bell" },
  { id: "pop", kind: "builtin", androidKey: "default", label: "Pop" },
  { id: "marimba", kind: "builtin", androidKey: "default", label: "Marimba" },
  { id: "soft", kind: "builtin", androidKey: "default", label: "Soft note" },
  { id: "file:SevenFriends_raw1_Drill.mp3", kind: "jingle", androidKey: "drill", label: "Drill" },
  { id: "file:SevenFriends_raw2_Hyper.mp3", kind: "jingle", androidKey: "hyper", label: "Hyper" },
  { id: "file:SevenFriends_raw3_AcidBreaks.mp3", kind: "jingle", androidKey: "acidbreaks", label: "Acid Breaks" },
];

/** The built-in sounds and "none": the ids that are not a file. */
export const BUILT_IN_SOUND_IDS: readonly string[] = SOUNDS.filter((s) => s.kind !== "jingle").map((s) => s.id);

/**
 * The Android channel key of a saved choice ("default" for anything that is not a known jingle). A choice saved under an older file name
 * ("file:Acid_Breaks.mp3") still finds its jingle by the name of the jingle in it, so no saved setting needs to be changed.
 */
export const androidKeyOf = (choice: string | null | undefined): SoundInfo["androidKey"] => {
  const exact = SOUNDS.find((s) => s.id === choice);
  if (exact) return exact.androidKey;
  if (typeof choice === "string" && choice.startsWith("file:")) {
    const plain = choice.toLowerCase().replace(/[^a-z]/g, "");
    return SOUNDS.find((s) => s.kind === "jingle" && plain.includes(s.androidKey))?.androidKey ?? "default";
  }
  return "default";
};
