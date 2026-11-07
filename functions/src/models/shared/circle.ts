import type { CircleSettings } from "./circle-settings";

/** `friends` is the default and the only type that can be created for now. */
export type CircleType = "friends" | "family" | "colleagues";

export interface Circle {
  id: string;
  name: string;
  type: CircleType;
  createdAt: string | null;
  /** the choices of this circle (theme, text size, order, ...): only the ones that were chosen are here */
  settings: Partial<CircleSettings>;
}
