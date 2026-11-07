import { Component, computed, inject, output, signal } from '@angular/core';
import { KeysService } from '../core/keys.service';
import { readableFingerprint } from '../models';

/**
 * Making the encryption key, in one piece used by the setup (step 3) and by Settings → Keys: shows whether this device has a key, makes one
 * (`makeKey`, also with `reset` for a new key), shows the 24 recovery words once, and asks for three of them back before it lets go.
 * `finished` is sent when the person has proved the words are written down.
 */
@Component({
  selector: 'app-key-setup',
  templateUrl: './key-setup.html',
})
export class KeySetup {
  protected readonly keys = inject(KeysService);

  readonly finished = output<void>();

  /** the 24 recovery words, shown after the key is made (null before, and again after the person has proved they saved them) */
  protected readonly words = signal<string[] | null>(null);
  /** true while the words are on the screen: a page around this one should not offer to leave */
  readonly showingWords = computed(() => this.words() !== null);
  /** the three words (positions 1-24) the person is asked to type back, to show the code was written down */
  protected readonly quiz = signal<number[]>([]);
  protected readonly answers = signal<string[]>(['', '', '']);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly copied = signal(false);
  protected readonly fingerprintText = computed(() => readableFingerprint(this.keys.fingerprint() ?? ''));
  /** the typed words match the asked-for ones */
  protected readonly proved = computed(() => {
    const words = this.words();
    return !!words && this.quiz().every((position, i) => this.answers()[i].trim().toLowerCase() === words[position - 1]);
  });

  constructor() {
    void this.keys.refresh();
  }

  /** Makes the key (`reset`: a new one in place of the one this device has) and shows the words. */
  async makeKey(reset = false): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      const words = await (reset ? this.keys.reset() : this.keys.setup());
      const positions = new Set<number>(); // three different positions, in order
      while (positions.size < 3) positions.add(1 + (crypto.getRandomValues(new Uint32Array(1))[0] % words.length));
      this.quiz.set([...positions].sort((a, b) => a - b));
      this.answers.set(['', '', '']);
      this.copied.set(false);
      this.words.set(words);
    } catch (err: any) {
      this.problem.set(err?.message || 'The key could not be made. Try again.');
    } finally {
      this.busy.set(false);
    }
  }

  protected setAnswer(i: number, value: string): void {
    this.answers.update((list) => list.map((a, n) => (n === i ? value : a)));
  }

  protected async copyWords(): Promise<void> {
    try {
      await navigator.clipboard.writeText((this.words() ?? []).join(' '));
      this.copied.set(true);
    } catch {
      this.copied.set(false); // the words are on the screen: they can be written down
    }
  }

  /** The words were proved saved: they leave the screen (and the app) for good. */
  protected done(): void {
    this.words.set(null);
    this.finished.emit();
  }
}
