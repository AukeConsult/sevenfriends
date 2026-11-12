/** The colour themes of the app (the names the frontend knows: see THEMES in core/ui-preferences.ts). */
export const LOOK_THEMES = ["light", "dark", "ocean", "forest", "rose", "white"] as const;
export type LookTheme = (typeof LOOK_THEMES)[number];

/** The text sizes of the app. */
export const LOOK_TEXT_SIZES = ["tiny", "small", "normal", "big", "huge"] as const;
export type LookTextSize = (typeof LOOK_TEXT_SIZES)[number];

/** Ready-made messages: at most this many, each at most this long. */

/**
 * The choices a person makes in Settings, kept PER CIRCLE (on the circle's own document), so they follow the person to every device and
 * each circle can have its own. What is only about this screen or this device (the open tab, the last page, the microphone) stays on the device.
 */
export interface CircleSettings {
  theme: LookTheme;
  textSize: LookTextSize;
  /** the order of a conversation: the oldest message first or the newest first */
  chatOrder: "oldest" | "newest";
  /** Enter sends the message (off = Enter is a new line and Ctrl+Enter sends) */
  enterSends: boolean;
  /** friends can be put on a sleep list instead of being deleted */
  sleepList: boolean;
  /** a picture next to every message in a conversation */
  feedIcons: boolean;
  /** when I add something to the safebox, a message tells my friend or group */
  boxTellNew: boolean;
}

const KEYS: readonly (keyof CircleSettings)[] = ["theme", "textSize", "chatOrder", "enterSends", "sleepList", "feedIcons", "boxTellNew"];

/** One value checked; undefined = not valid. */
function valid(key: keyof CircleSettings, value: unknown): CircleSettings[keyof CircleSettings] | undefined {
  switch (key) {
    case "theme": return LOOK_THEMES.find((t) => t === value);
    case "textSize": return LOOK_TEXT_SIZES.find((t) => t === value);
    case "chatOrder": return value === "oldest" || value === "newest" ? value : undefined;
    case "enterSends":
    case "sleepList":
    case "feedIcons":
    case "boxTellNew": return typeof value === "boolean" ? value : undefined;
  }
}

/** A request's settings checked as a whole: null when it is not an object, has an unknown name or any value is wrong (nothing is then saved). */
export function parseSettings(value: unknown): Partial<CircleSettings> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!KEYS.includes(key as keyof CircleSettings)) return null;
    const ok = valid(key as keyof CircleSettings, v);
    if (ok === undefined) return null;
    out[key] = ok;
  }
  return out as Partial<CircleSettings>;
}

/** What is stored, read leniently: only the valid choices are kept. */
export function settingsOf(value: unknown): Partial<CircleSettings> {
  const out: Record<string, unknown> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of KEYS) {
      const ok = valid(key, (value as Record<string, unknown>)[key]);
      if (ok !== undefined) out[key] = ok;
    }
  }
  return out as Partial<CircleSettings>;
}
