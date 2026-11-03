/**
 * The four moods a person can stick to their profile (icons `public/icons/moods/mood1.svg` ... `mood4.svg`).
 * Friends see them on the Friends page and in the message feed. The ids are what the backend stores (1-4).
 */
export interface Mood {
  id: number;
  label: string;
}

export const MOODS: readonly Mood[] = [
  { id: 1, label: 'Happy' },
  { id: 2, label: 'Calm' },
  { id: 3, label: 'Tired' },
  { id: 4, label: 'Down' },
];

/** The picture of a mood. */
export const moodIcon = (id: number): string => `icons/moods/mood${id}.svg`;

/** The name of a mood ('' when unknown). */
export const moodLabel = (id: number | null): string => MOODS.find((m) => m.id === id)?.label ?? '';
