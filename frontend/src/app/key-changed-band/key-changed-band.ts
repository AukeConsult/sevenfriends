import { Component, computed, effect, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tr } from '../core/i18n';

/** What this device has already accepted of a friend's keys (their fingerprints), kept on this device only. */
const storeKey = (friendId: string) => `sf-pinned-keys:${friendId}`;
/** Keys that wait for an answer (Accept or Decline): the question stays until it is answered, even when the key is approved elsewhere meanwhile. */
const pendingKey = (friendId: string) => `sf-pending-keys:${friendId}`;
/** Keys that were declined: not asked about again. */
const declinedKey = (friendId: string) => `sf-declined-keys:${friendId}`;

function readList(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key);
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter((f: unknown): f is string => typeof f === 'string') : null;
  } catch {
    return null;
  }
}

function writeList(key: string, list: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage is blocked: the question is asked again next time */
  }
}

/**
 * Under the header of a friend's page: a friend's key that this device has not seen before (a new phone, a new browser, a new key). The first keys
 * seen are accepted silently (trust on first use); a later one is asked about, in words: "Did you change phone?". The question is a block in the page (not an
 * overlay) and it STAYS, also after a reload, until the person answers: Accept remembers the key on this device, Decline opens the codes to compare and
 * the key is not asked about again. It only asks: sending is not stopped.
 */
@Component({
  selector: 'app-key-changed-band',
  template: `
    @if (changed()) {
      <div class="sf-locked-band" role="status">
        <span class="sf-locked-text">🔑 {{ tr('core.newKeyQuestion', '{{ name }} seems to have a new phone or a new key. Call {{ name }} and ask: did you change phone?', { name: name() }) }}</span>
        <span class="d-flex gap-2">
          <button type="button" class="btn btn-primary btn-sm" (click)="accept()">{{ tr('core.newKeyYes', 'Yes, it is {{ name }}', { name: name() }) }}</button>
          <button type="button" class="btn btn-light btn-sm" (click)="decline()">{{ tr('core.newKeyDecline', 'Decline') }}</button>
        </span>
      </div>
    }
  `,
})
export class KeyChangedBand {
  protected readonly tr = tr;
  readonly friendId = input.required<string>();
  readonly name = input('');
  /** the fingerprints of the friend's keys, as the server gave them */
  readonly fingerprints = input<string[]>([]);

  /** the keys waiting for an answer (also loaded at the start, so the question is back after a reload) */
  private readonly pending = signal<string[]>([]);
  protected readonly changed = computed(() => this.pending().length > 0);

  constructor(private readonly router: Router) {
    effect(() => this.pending.set(readList(pendingKey(this.friendId())) ?? []));
    effect(() => {
      const id = this.friendId();
      const now = this.fingerprints();
      if (!now.length) return; // the friend has no key yet, or they are not loaded
      const saved = readList(storeKey(id));
      if (saved === null) {
        writeList(storeKey(id), now); // the first keys seen: accepted
        return;
      }
      const waiting = readList(pendingKey(id)) ?? [];
      const declined = readList(declinedKey(id)) ?? [];
      const fresh = now.filter((f) => !saved.includes(f) && !waiting.includes(f) && !declined.includes(f));
      if (fresh.length) {
        const next = [...waiting, ...fresh];
        writeList(pendingKey(id), next);
        this.pending.set(next);
      }
    });
  }

  protected accept(): void {
    const id = this.friendId();
    writeList(storeKey(id), [...new Set([...(readList(storeKey(id)) ?? []), ...this.pending()])]);
    writeList(pendingKey(id), []);
    this.pending.set([]);
  }

  /** The key is not accepted and not asked about again; the codes open so they can be compared. */
  protected decline(): void {
    const id = this.friendId();
    writeList(declinedKey(id), [...new Set([...(readList(declinedKey(id)) ?? []), ...this.pending()])]);
    writeList(pendingKey(id), []);
    this.pending.set([]);
    void this.router.navigate(['/friends', id, 'lock'], { queryParams: { advanced: 1 } });
  }
}
