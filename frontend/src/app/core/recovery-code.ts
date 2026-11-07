import { RECOVERY_WORDS } from './recovery-words';

/**
 * The recovery code: a random 256-bit recovery key written as 24 words (design: docs/design/safebox-encryption.md).
 * Every word is 11 bits of the list of 2048; the last word also holds 8 bits of check, so a mistyped or swapped word is noticed.
 * (The same way BIP-39 does it, so the words are easy to read, write and say.)
 */
export const RECOVERY_WORD_COUNT = 24;
const KEY_BYTES = 32;

const INDEX = new Map(RECOVERY_WORDS.map((word, i) => [word, i]));

/** A new random recovery key. */
export function newRecoveryKey(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(KEY_BYTES));
}

async function checkByte(key: Uint8Array): Promise<number> {
  const digest = await crypto.subtle.digest('SHA-256', key as BufferSource);
  return new Uint8Array(digest)[0];
}

/** The 24 words of a recovery key. */
export async function wordsOf(key: Uint8Array): Promise<string[]> {
  if (key.length !== KEY_BYTES) throw new Error('A recovery key is 32 bytes');
  const bits: number[] = [];
  for (const byte of [...key, await checkByte(key)]) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  const words: string[] = [];
  for (let w = 0; w < RECOVERY_WORD_COUNT; w++) {
    let index = 0;
    for (let i = 0; i < 11; i++) index = (index << 1) | bits[w * 11 + i];
    words.push(RECOVERY_WORDS[index]);
  }
  return words;
}

/** What a person typed (any case, any spaces, commas or line breaks) as words; the empty ones are left out. */
export function wordsFromText(typed: string): string[] {
  return typed.toLowerCase().split(/[^a-z]+/).filter(Boolean);
}

/** The recovery key of 24 words, or null when a word is not on the list, there are not 24, or the check does not fit (a mistyped word). */
export async function keyOf(words: string[]): Promise<Uint8Array | null> {
  if (words.length !== RECOVERY_WORD_COUNT) return null;
  const bits: number[] = [];
  for (const word of words) {
    const index = INDEX.get(word.toLowerCase());
    if (index === undefined) return null;
    for (let i = 10; i >= 0; i--) bits.push((index >> i) & 1);
  }
  const bytes = new Uint8Array(KEY_BYTES + 1);
  for (let i = 0; i < bytes.length * 8; i++) bytes[i >> 3] = (bytes[i >> 3] << 1) | bits[i];
  const key = bytes.slice(0, KEY_BYTES);
  return (await checkByte(key)) === bytes[KEY_BYTES] ? key : null;
}
