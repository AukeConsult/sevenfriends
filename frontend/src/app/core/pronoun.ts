import { Pronoun } from '../models';

/** "his", "her" or the neutral "their" (not chosen), for a sentence about a friend: "Has you on his sleep list". */
export function possessive(pronoun: Pronoun | null | undefined): string {
  return pronoun === 'he' ? 'his' : pronoun === 'she' ? 'her' : 'their';
}
