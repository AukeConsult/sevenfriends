/**
 * The initials shown for a person next to their picture:
 *  - a name: the first letters of its words, at most two ("Leif Auke" -> "LA", "Leif" -> "L");
 *  - an email address (a friend without a name is shown by their email): the first letter of the address and the first letter of the
 *    domain ("leif@gmail.com" -> "LG");
 *  - a phone number: its last two digits.
 */
export function initials(name: string | null | undefined): string {
  const text = (name ?? '').trim();
  if (!text) return '';

  const email = /^([^\s@]+)@([^\s@]+)$/.exec(text);
  if (email) return (first(email[1]) + first(email[2])).toUpperCase();

  const digits = text.replace(/\D/g, '');
  if (/^[+\d][\d\s().-]*$/.test(text) && digits.length >= 2) return digits.slice(-2);

  return text
    .split(/\s+/)
    .map(first)
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

/** the first letter or digit of a word (an emoji or a mark in front is skipped) */
function first(word: string): string {
  return /[\p{L}\p{N}]/u.exec(word)?.[0] ?? '';
}
