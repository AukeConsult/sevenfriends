import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { AppDatePipe } from '../core/app-date.pipe';
import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { LockedItemsService } from '../core/locked-items.service';
import { OwnRecoveryService } from '../core/own-recovery.service';
import { KeySetup } from '../key-setup/key-setup';
import { KeysService, RestoreResult } from '../core/keys.service';
import { wordsFromText } from '../core/recovery-code';
import { PublishedKey } from '../models';
import { tr } from '../core/i18n';

/** Settings → Keys: the encryption key of this device (make it, see it), the keys of my other devices, a new key, and restoring a key from the 24 words. */
@Component({
  selector: 'app-encryption',
  imports: [AppDatePipe, KeySetup, NgTemplateOutlet, RouterLink, TranslocoDirective],
  templateUrl: './encryption.html',
  providers: [provideTranslocoScope('encryption')],
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

  // ---- what this device cannot open, and the ways to get it back (docs/design/recovery-own-devices.md)
  protected readonly lockedCounts = inject(LockedItemsService).counts;
  private readonly lockedService = inject(LockedItemsService);
  protected readonly lockedTotal = this.lockedService.total;
  private readonly friendsService = inject(FriendsService);
  private readonly router = inject(Router);
  /** where to go when my other devices have done it: only an address inside the app (the band under the header of a friend's page sends `?from=`) */
  private readonly from = ((): string | null => {
    const from = inject(ActivatedRoute).snapshot.queryParamMap.get('from') ?? '';
    return from.startsWith('/') && !from.startsWith('//') ? from : null;
  })();
  /** the request of THIS device to my other devices: asked, working, declined, done */
  protected readonly mine = this.own.mine;
  protected readonly askBusy = signal(false);
  protected readonly askError = signal<string | null>(null);
  protected readonly finished = signal(false);
  /** my friends of the circle in use: asking a friend is one friendship at a time */
  protected readonly friendList = computed(() => this.friendsService.friends().filter((f) => f.status === 'confirmed'));
  /** the other devices of mine that have a working key: one of them has to do it */
  protected readonly otherDevices = computed(() => this.keys.published().filter((k) => !k.revoked && k.id !== this.keys.thisKeyId()));
  /** other devices of mine that have a key (they can open my history) */
  protected readonly otherKeys = computed(() => this.keys.published().filter((k) => !k.revoked && k.id !== this.keys.thisKeyId()).length);
  protected readonly percent = computed(() => {
    const request = this.mine();
    return request?.total ? Math.min(100, Math.round((request.added / request.total) * 100)) : 0;
  });
  /** why there is no working key on this device, in words (null = nothing to warn about) */
  protected readonly noKeyReason = computed((): string | null => {
    if (this.keys.state() !== 'none') return null;
    const d = this.keys.diagnosis();
    if (d?.localPublished === 'removed') return tr('encryption.theKeyOnThisRemoved', 'The key on this device was removed, from another of your devices or with "Not me".');
    if (d?.localPublished === 'no') return tr('encryption.theKeyOnThisNever', 'The key on this device was never saved on the server, so it does not count.');
    if (this.keys.elsewhere()) return tr('encryption.thisDeviceHasNoKey', 'Your account has keys on other devices, but this device has none.');
    return null;
  });

  constructor() {
    void this.own.check();
    void this.own.refreshMine();
    void this.lockedService.check(true);
    if (!this.friendsService.circle()) void this.friendsService.load().catch(() => undefined);
    // the stamp of the server makes the page live; this is the safety net
    const timer = setInterval(() => void this.own.refreshMine(), 2500);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
    // my other devices have done it: told here once, the request is deleted (nothing is kept), and the person goes back to where they came from
    effect(() => {
      if (this.mine()?.status !== 'done' || this.finished()) return;
      untracked(() => {
        this.finished.set(true);
        void this.own.dismissMine().catch(() => undefined);
        void this.keys.refresh();
        void this.lockedService.check(true);
        if (this.from) setTimeout(() => void this.router.navigateByUrl(this.from!, { replaceUrl: true }), 1800);
      });
    });
  }

  /** Ask my other devices to open my old messages for this one (at any time, again and again). */
  protected async askOthers(): Promise<void> {
    if (this.askBusy()) return;
    this.askBusy.set(true);
    this.askError.set(null);
    try {
      await this.own.ask();
    } catch (err: any) {
      this.askError.set(err?.message || tr('encryption.thatDidNotWork', 'That did not work. Try again.'));
    } finally {
      this.askBusy.set(false);
    }
  }

  /** One of my other devices said "Not me": it is read, the request is deleted. */
  protected async dismissAsk(): Promise<void> {
    await this.own.dismissMine().catch(() => undefined);
    void this.keys.refresh();
  }

  protected readonly severalKeys = computed(() => this.keys.published().filter((k) => !k.revoked).length > 1);

  protected async trustThis(): Promise<void> {
    this.allowNote.set(null);
    try {
      await this.own.trustThisDevice();
    } catch (err: any) {
      this.allowNote.set(err?.message || tr('encryption.thatDidNotWork', 'That did not work. Try again.'));
    }
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
      this.allowNote.set(result.skipped ? tr('encryption.couldNotBeOpened', '{{ skipped }} could not be opened on this device. Try again on the device where that key lives.', { skipped: result.skipped }) : tr('encryption.doneTheOtherDevice', 'Done. The other device can now open your old messages and files.'));
    } catch (err: any) {
      this.allowNote.set(err?.message || tr('encryption.thatDidNotWork', 'That did not work. Try again.'));
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
      this.problem.set(err?.message || tr('encryption.theKeyCouldNot', 'The key could not be removed.'));
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
      this.restoreText.set(err?.message || tr('encryption.theKeyCouldNot2', 'The key could not be restored.'));
    } finally {
      this.busy.set(false);
    }
  }
}

const MESSAGES: Record<Exclude<RestoreResult, 'ok'>, string> = {
  get 'bad-words'() { return tr('core.thatIsNotA', 'That is not a valid recovery code. It is 24 words; check each word, and that none is missing.'); },
  get 'no-backup'() { return tr('core.thereIsNoBackup', 'There is no backup of a key on your account. Make a new key instead.'); },
  get 'wrong-code'() { return tr('core.thoseWordsDoNot', 'Those words do not open the backup. Check them against your copy.'); },
  get 'no-key'() { return tr('core.theBackupOpenedBut', 'The backup opened, but the key it belongs to has been removed. Make a new key instead.'); },
};
