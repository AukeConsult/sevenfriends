import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, DestroyRef, computed, inject, output, signal } from '@angular/core';
import { KeysService } from '../core/keys.service';
import { readableFingerprint } from '../models';
import { tr } from '../core/i18n';

/**
 * Making the encryption key, in one piece used by the setup wizard and by Settings → Keys: shows whether this device has a key, makes one
 * (`makeKey`, also with `reset` for a new key) in memory, shows the 24 recovery words once, and asks for three of them back. Only when the person
 * presses Save is the key put on this device and on the server (and checked): leaving before that throws the new key away.
 * `finished` is sent when the key is saved and checked.
 */
@Component({
  imports: [TranslocoDirective],
  selector: 'app-key-setup',
  host: { class: 'd-flex flex-column gap-3' }, // the parts (words, copy button, check, buttons) have room between them
  templateUrl: './key-setup.html',
  providers: [provideTranslocoScope('keySetup')],
})
export class KeySetup {
  protected readonly keys = inject(KeysService);

  readonly finished = output<void>();
  /** the person cancelled before saving: no key was made (the setup wizard goes on to its next step) */
  readonly cancelled = output<void>();

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
    inject(DestroyRef).onDestroy(() => this.keys.discard()); // left before Save: the key that was not saved is thrown away
  }

  /** Makes the key (`reset`: a new one in place of the one this device has) and shows the words. */
  async makeKey(reset = false): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      const words = await this.keys.prepare(reset);
      const positions = new Set<number>(); // three different positions, in order
      while (positions.size < 3) positions.add(1 + (crypto.getRandomValues(new Uint32Array(1))[0] % words.length));
      this.quiz.set([...positions].sort((a, b) => a - b));
      this.answers.set(['', '', '']);
      this.copied.set(false);
      this.words.set(words);
    } catch (err: any) {
      this.problem.set(err?.message || tr('keySetup.theKeyCouldNot', 'The key could not be made. Try again.'));
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

  /** Cancel: the key that was made in memory is thrown away, the words leave the screen, and nothing was saved anywhere. */
  protected cancel(): void {
    this.keys.discard();
    this.words.set(null);
    this.problem.set(null);
    this.cancelled.emit();
  }

  /** Save: the key goes on this device and the server, and is checked. Then the words leave the screen (and the app) for good. */
  protected async done(): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      await this.keys.commit();
    } catch (err: any) {
      this.problem.set(err?.message || tr('keySetup.theKeyCouldNot2', 'The key could not be saved. Try again.'));
      return; // the words stay on the screen: Save can be pressed again
    } finally {
      this.busy.set(false);
    }
    this.words.set(null);
    this.finished.emit();
  }
}
