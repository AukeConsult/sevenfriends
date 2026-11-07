/** The colour themes of the app (the names the frontend knows: see THEMES in core/ui-preferences.ts). */
export const LOOK_THEMES = ["light", "dark", "ocean", "forest", "rose"] as const;
export type LookTheme = (typeof LOOK_THEMES)[number];

/** The text sizes of the app. */
export const LOOK_TEXT_SIZES = ["tiny", "small", "normal", "big", "huge"] as const;
export type LookTextSize = (typeof LOOK_TEXT_SIZES)[number];

/** Ready-made messages: at most this many, each at most this long. */
export const ACCOUNT_QUICK_MAX = 10;
export const ACCOUNT_QUICK_LENGTH = 200;

/**
 * The choices a person makes in Settings that follow them to every device (kept on the account).
 * What is only about this screen or this device (the open tab, the last page, the microphone) stays on the device.
 */
export interface AccountSettings {
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
  /** the ready-made messages */
  quickMessages: string[];
}

const KEYS: readonly (keyof AccountSettings)[] = ["theme", "textSize", "chatOrder", "enterSends", "sleepList", "feedIcons", "quickMessages"];

/** One value checked; undefined = not valid. (The quick messages are trimmed and the empty ones dropped.) */
function valid(key: keyof AccountSettings, value: unknown): AccountSettings[keyof AccountSettings] | undefined {
  switch (key) {
    case "theme": return LOOK_THEMES.find((t) => t === value);
    case "textSize": return LOOK_TEXT_SIZES.find((t) => t === value);
    case "chatOrder": return value === "oldest" || value === "newest" ? value : undefined;
    case "enterSends":
    case "sleepList":
    case "feedIcons": return typeof value === "boolean" ? value : undefined;
    case "quickMessages": {
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) return undefined;
      const list = (value as string[]).map((v) => v.trim()).filter(Boolean);
      return list.length <= ACCOUNT_QUICK_MAX && list.every((v) => v.length <= ACCOUNT_QUICK_LENGTH) ? list : undefined;
    }
  }
}

/** A request's settings checked as a whole: null when it is not an object, has an unknown name or any value is wrong (nothing is then saved). */
export function parseSettings(value: unknown): Partial<AccountSettings> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!KEYS.includes(key as keyof AccountSettings)) return null;
    const ok = valid(key as keyof AccountSettings, v);
    if (ok === undefined) return null;
    out[key] = ok;
  }
  return out as Partial<AccountSettings>;
}

/** What is stored, read leniently: only the valid choices are kept. */
export function settingsOf(value: unknown): Partial<AccountSettings> {
  const out: Record<string, unknown> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of KEYS) {
      const ok = valid(key, (value as Record<string, unknown>)[key]);
      if (ok !== undefined) out[key] = ok;
    }
  }
  return out as Partial<AccountSettings>;
}
