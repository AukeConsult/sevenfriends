import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { KeysService } from './keys.service';
import { myDeviceKey } from './my-key';

const MIN_GAP_MS = 30_000;

/**
 * What THIS device cannot open: the messages and safebox files (all friends, all circles) that have no copy of their key for the key of this device
 * (design: docs/design/recovery-own-devices.md). Shown on Home and in the bands of the feed, the friend's page and the safebox, with the ways to get them back.
 * Asked of the server at start, on focus and when a key changes; only when the account has more than one key (with one key nothing can be locked).
 */
@Injectable({ providedIn: 'root' })
export class LockedItemsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly keys = inject(KeysService);

  /** null = not known (no key on this device, or not asked yet) */
  readonly counts = signal<{ messages: number; files: number } | null>(null);
  readonly total = computed(() => (this.counts()?.messages ?? 0) + (this.counts()?.files ?? 0));

  private last = 0;

  constructor() {
    // the keys changed (a key was made, restored, removed): look again
    effect(() => {
      this.keys.published();
      this.keys.thisKeyId();
      untracked(() => void this.check(true));
    });
    window.addEventListener('focus', () => void this.check());
  }

  /** Asks the server how much is locked for this device; `force` ignores the pause between two questions. */
  async check(force = false): Promise<void> {
    if (!this.auth.user()) {
      this.counts.set(null);
      return;
    }
    if (!force && Date.now() - this.last < MIN_GAP_MS) return;
    const mine = await myDeviceKey(this.auth.user()?.uid);
    if (!mine || this.keys.published().length < 2) {
      this.counts.set(mine ? { messages: 0, files: 0 } : null);
      return;
    }
    this.last = Date.now();
    try {
      this.counts.set(await this.api.request<{ messages: number; files: number }>(`/own-recovery/status?key=${mine.keyId}`));
    } catch {
      /* the last answer stays */
    }
  }
}
