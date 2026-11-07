/** The colours a person can choose for their profile (`ink` = the text colour that reads best on it, white or dark, by contrast; `soft` = a very light tint of the same colour, the background of the conversation): their friends see it on the friend list and in the header of the conversation. */
export const PROFILE_COLORS = [
  { key: "red", label: "Red", hex: "#e05d6f", ink: "#1f2937", soft: "#f9e2e5" },
  { key: "orange", label: "Orange", hex: "#f08c42", ink: "#1f2937", soft: "#fceadd" },
  { key: "yellow", label: "Yellow", hex: "#e8b923", ink: "#1f2937", soft: "#fbf2d7" },
  { key: "green", label: "Green", hex: "#4fae6a", ink: "#1f2937", soft: "#dff0e4" },
  { key: "teal", label: "Teal", hex: "#2fa6a0", ink: "#1f2937", soft: "#daefee" },
  { key: "blue", label: "Blue", hex: "#4a86d6", ink: "#1f2937", soft: "#dee9f8" },
  { key: "purple", label: "Purple", hex: "#8b6bd6", ink: "#ffffff", soft: "#eae4f8" },
  { key: "pink", label: "Pink", hex: "#e06aa8", ink: "#1f2937", soft: "#f9e4ef" },
  { key: "brown", label: "Brown", hex: "#9b7351", ink: "#ffffff", soft: "#ede6e0" },
  { key: "grey", label: "Grey", hex: "#8a93a5", ink: "#1f2937", soft: "#eaecef" },
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
