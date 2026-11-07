/** The colours a person can choose for their profile (`ink` = the text colour that reads best on it, white or dark, by contrast; `soft` = a very light tint of the same colour, the background of the conversation): their friends see it on the friend list and in the header of the conversation. */
export const PROFILE_COLORS = [
  { key: "red", label: "Red", hex: "#eb97a3", ink: "#111827", soft: "#fbecee" },
  { key: "orange", label: "Orange", hex: "#f29a59", ink: "#111827", soft: "#fdede1" },
  { key: "yellow", label: "Yellow", hex: "#e8b923", ink: "#111827", soft: "#fbf2d7" },
  { key: "green", label: "Green", hex: "#76c08b", ink: "#111827", soft: "#e6f4ea" },
  { key: "teal", label: "Teal", hex: "#65bdb9", ink: "#111827", soft: "#e3f3f2" },
  { key: "blue", label: "Blue", hex: "#8bb2e5", ink: "#111827", soft: "#eaf1fa" },
  { key: "purple", label: "Purple", hex: "#7a5ebc", ink: "#ffffff", soft: "#e7e2f3" },
  { key: "pink", label: "Pink", hex: "#e997c2", ink: "#111827", soft: "#fbecf4" },
  { key: "brown", label: "Brown", hex: "#8c6849", ink: "#ffffff", soft: "#eae4de" },
  { key: "grey", label: "Grey", hex: "#a8afbc", ink: "#111827", soft: "#eff1f3" },
] as const;

export type ProfileColorKey = (typeof PROFILE_COLORS)[number]["key"];

/** The colour of a key as CSS (#rrggbb), or null when it is not one of the colours. */
export function profileColorHex(key: string | null | undefined): string | null {
  return PROFILE_COLORS.find((c) => c.key === key)?.hex ?? null;
}

/** The text colour for text on a colour (#rrggbb), or null when it is not one of the colours. */
export function profileColorInk(key: string | null | undefined): string | null {
  return PROFILE_COLORS.find((c) => c.key === key)?.ink ?? null;
}

/** The very light tint of a colour (#rrggbb), or null when it is not one of the colours. */
export function profileColorSoft(key: string | null | undefined): string | null {
  return PROFILE_COLORS.find((c) => c.key === key)?.soft ?? null;
}

/** The key if it is one of the colours, otherwise null. */
export function profileColorKey(value: unknown): ProfileColorKey | null {
  return PROFILE_COLORS.find((c) => c.key === value)?.key ?? null;
}
