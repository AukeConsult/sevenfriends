import type { CircleSettings } from "./circle-settings";
import type { ProfileColorKey } from "./profile-color";

/** The kinds of circle. A person has at most one of each: `friends` is the first one (id `default`), the others are made on request (id = the type). */
export type CircleType = "friends" | "buddies" | "work" | "family";

/** All the types, in the order they are offered. */
export const CIRCLE_TYPES: readonly CircleType[] = ["friends", "buddies", "work", "family"];

/** How a person shows in ONE circle: their friends in that circle see this name, colour, icon and mood (the picture, pronoun and country stay personal). */
export interface CircleProfile {
  name: string | null;
  color: ProfileColorKey | null;
  /** the seat icon (1-7) used as my picture when I have no photo */
  icon: number | null;
  mood: number | null;
  moodMessage: string | null;
}

export interface Circle {
  id: string;
  name: string;
  type: CircleType;
  createdAt: string | null;
  /** the choices of this circle (theme, text size, order, ...): only the ones that were chosen are here */
  settings: Partial<CircleSettings>;
  /** how I show in this circle (the `friends` circle uses the name, colour and mood of my account) */
  profile: CircleProfile;
}
