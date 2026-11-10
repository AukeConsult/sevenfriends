import { Component, computed, effect, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tr } from '../core/i18n';

/** What this device has already accepted of a friend's keys (their fingerprints), kept on this device only. */
const storeKey = (friendId: string) => `sf-pinned-keys:${friendId}`;

function readPinned(friendId: string): string[] | null {
  try {
    const raw = localStorage.getItem(storeKey(friendId));
    const list = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter((f: unknown): f is string => typeof f === 'string') : null;
  } catch {
    return null;
  }
}

function writePinned(friendId: string, fingerprints: string[]): void {
  try {
    localStorage.setItem(storeKey(friendId), JSON.stringify(fingerprints));
  } catch {
    /* storage is blocked: the question is asked again next time */
  }
}

/**
 * Under the header of a friend's page: a friend's key that this device has not seen before (a new phone, a new browser, a new key). The first keys
 * seen are accepted silently (trust on first use); a later one is asked about, in words: "Did you change phone?". It only asks: sending is not stopped.
 * "Yes" remembers the key on this device; "I'm not sure" opens the codes to compare (Locking → Advanced).
 */
@Component({
  selector: 'app-key-changed-band',
  template: `
    @if (changed()) {
      <div class="sf-locked-band" role="status">
        <span class="sf-locked-text">🔑 {{ tr('core.newKeyQuestion', '{{ name }} seems to have a new phone or a new key. Call {{ name }} and ask: did you change phone?', { name: name() }) }}</span>
        <span class="d-flex gap-2">
          <button type="button" class="btn btn-primary btn-sm" (click)="accept()">{{ tr('core.newKeyYes', 'Yes, it is {{ name }}', { name: name() }) }}</button>
          <button type="button" class="btn btn-light btn-sm" (click)="unsure()">{{ tr('core.newKeyUnsure', 'I am not sure') }}</button>
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

  private readonly pinned = signal<string[] | null>(null);
  protected readonly changed = computed(() => {
    const known = this.pinned();
    return !!known && this.fingerprints().some((f) => !known.includes(f));
  });

  constructor(private readonly router: Router) {
    effect(() => {
      const id = this.friendId();
      const now = this.fingerprints();
      if (!now.length) return; // the friend has no key yet, or they are not loaded
      const saved = readPinned(id);
      if (saved === null) {
        writePinned(id, now); // the first keys seen: accepted
        this.pinned.set(now);
      } else {
        this.pinned.set(saved);
      }
    });
  }

  protected accept(): void {
    const all = [...new Set([...(this.pinned() ?? []), ...this.fingerprints()])];
    writePinned(this.friendId(), all);
    this.pinned.set(all);
  }

  protected unsure(): void {
    void this.router.navigate(['/friends', this.friendId(), 'lock'], { queryParams: { advanced: 1 } });
  }
}
