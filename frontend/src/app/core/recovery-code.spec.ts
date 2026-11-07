import { keyOf, newRecoveryKey, RECOVERY_WORD_COUNT, wordsFromText, wordsOf } from './recovery-code';
import { RECOVERY_WORDS } from './recovery-words';

describe('recovery code', () => {
  it('has the 2048 words of the list, all different', () => {
    expect(RECOVERY_WORDS.length).toBe(2048);
    expect(new Set(RECOVERY_WORDS).size).toBe(2048);
  });

  it('writes a key as 24 words and reads it back', async () => {
    const key = newRecoveryKey();
    const words = await wordsOf(key);
    expect(words.length).toBe(RECOVERY_WORD_COUNT);
    expect(Array.from((await keyOf(words))!)).toEqual(Array.from(key));
  });

  it('reads what a person types: any case, spaces, commas and line breaks', async () => {
    const key = newRecoveryKey();
    const words = await wordsOf(key);
    const typed = wordsFromText(words.map((w, i) => (i % 5 === 4 ? w.toUpperCase() + ',\n' : w + '  ')).join(''));
    expect(Array.from((await keyOf(typed))!)).toEqual(Array.from(key));
  });

  it('notices a word that is changed, one that is not on the list, and the wrong count', async () => {
    const words = await wordsOf(newRecoveryKey());
    const changed = [...words];
    changed[7] = changed[7] === 'zoo' ? 'abandon' : 'zoo';
    expect(await keyOf(changed)).toBeNull();
    expect(await keyOf([...words.slice(0, 23), 'notaword'])).toBeNull();
    expect(await keyOf(words.slice(0, 23))).toBeNull();
    expect(await keyOf([...words, 'abandon'])).toBeNull();
  });
});
