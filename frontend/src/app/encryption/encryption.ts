import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { OwnRecoveryService } from '../core/own-recovery.service';
import { KeySetup } from '../key-setup/key-setup';
import { KeysService, RestoreResult } from '../core/keys.service';
import { wordsFromText } from '../core/recovery-code';
import { PublishedKey } from '../models';

/** Settings → Keys: the encryption key of this device (make it, see it), the keys of my other devices, a new key, and restoring a key from the 24 words. */
@Component({
  selector: 'app-encryption',
  imports: [DatePipe, KeySetup],
  templateUrl: './encryption.html',
})
export class Encryption {
  /** the page shows the key status and the way to make or restore a key; the devices, the details and a new key are behind the Advanced button */
  protected readonly advanced = signal(false);
  protected readonly keys = inject(KeysService);
  private readonly keySetup = viewChild.required(KeySetup);
  protected readonly own = inject(OwnRecoveryService);
  /** the key being given its copies now, and how far it got */
  protected readonly allowing = signal<string | null>(null);
  protected readonly allowed = signal(0);
  protected readonly allowNote = signal<string | null>(null);
  /** true when one of my keys in use is waiting for access and this device is not the one that can give it */
  protected readonly waitingHere = computed(() => {
    const inUse = this.keys.published().filter((k) => !k.revoked).sort((x, y) => (x.createdAt ?? '').localeCompare(y.createdAt ?? ''));
    return inUse.length > 1 && inUse[0].id !== this.keys.thisKeyId() && this.own.waiting().length === 0;
  });

  /** the recovery words are on the screen: nothing else on the page is offered meanwhile */
  protected readonly showingWords = computed(() => this.keySetup().showingWords());
  /** the keys that are in use, then the retired ones */
  protected readonly devices = computed(() => [...this.keys.published()].sort((a, b) => Number(a.revoked) - Number(b.revoked)));

  /** the key that is asked "really remove?" */
  protected readonly removing = signal<string | null>(null);
  protected readonly resetting = signal(false);
  protected readonly busy = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected readonly typed = signal('');
  protected readonly restoreText = signal<string | null>(null);

  constructor() {
    void this.own.check();
  }

  protected isWaiting(key: PublishedKey): boolean {
    return this.own.waiting().some((k) => k.id === key.id);
  }

  protected async allow(key: PublishedKey): Promise<void> {
    this.allowing.set(key.id);
    this.allowed.set(0);
    this.allowNote.set(null);
    try {
      const result = await this.own.allow(key, (n) => this.allowed.set(n));
      this.allowNote.set(result.skipped ? `${result.skipped} could not be opened on this device. Try again on the device where that key lives.` : 'Done. The other device can now open your old messages and files.');
    } catch (err: any) {
      this.allowNote.set(err?.message || 'That did not work. Try again.');
    } finally {
      this.allowing.set(null);
    }
  }

  protected short(key: PublishedKey): string {
    return key.fingerprint.slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
  }

  protected async remove(key: PublishedKey): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      await this.keys.revoke(key.id);
      this.removing.set(null);
    } catch (err: any) {
      this.problem.set(err?.message || 'The key could not be removed.');
    } finally {
      this.busy.set(false);
    }
  }

  protected async newKey(): Promise<void> {
    this.resetting.set(false);
    await this.keySetup().makeKey(true);
  }

  protected async restore(): Promise<void> {
    this.busy.set(true);
    this.restoreText.set(null);
    try {
      const result = await this.keys.restore(wordsFromText(this.typed()));
      if (result === 'ok') this.typed.set('');
      else this.restoreText.set(MESSAGES[result]);
    } catch (err: any) {
      this.restoreText.set(err?.message || 'The key could not be restored.');
    } finally {
      this.busy.set(false);
    }
  }
}

const MESSAGES: Record<Exclude<RestoreResult, 'ok'>, string> = {
  'bad-words': 'That is not a valid recovery code. It is 24 words; check each word, and that none is missing.',
  'no-backup': 'There is no backup of a key on your account. Make a new key instead.',
  'wrong-code': 'Those words do not open the backup. Check them against your copy.',
  'no-key': 'The backup opened, but the key it belongs to has been removed. Make a new key instead.',
};
