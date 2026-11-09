import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { CircleActivityService } from './circle-activity.service';
import { FriendsService } from './friends.service';
import { MessagesService } from './messages.service';
import { RecoveryInboxService } from './recovery-inbox.service';

/** How often the title flips while the tab is in the background. */
const FLASH_MS = 1200;

/**
 * Shows in the browser TAB that something is waiting: the title gets a count, "(2) Friends – Seven Friends",
 * and while the tab is in the background the title flashes between that and a short "New in Seven Friends".
 * What counts: my unread messages and the friend requests that have a seat for me to confirm in the circle in use, and one for each other circle with activity.
 */
@Injectable({ providedIn: 'root' })
export class AttentionService {
  private readonly messages = inject(MessagesService);
  private readonly friends = inject(FriendsService);
  private readonly activity = inject(CircleActivityService);
  private readonly recovery = inject(RecoveryInboxService);

  /** The title of the current page (set by the title strategy on every navigation). */
  readonly baseTitle = signal('Seven Friends');

  /** the total across circles: what waits in the circle in use, and one for each other circle with activity (the app knows no more of those) */
  readonly count = computed(() => this.messages.messages().length + this.friends.requests().filter((r) => r.seated).length + this.activity.circles().length + this.recovery.count());

  private readonly hidden = signal(document.hidden);
  private readonly flash = signal(false);

  private readonly title = computed(() => {
    const count = this.count();
    if (!count) return this.baseTitle();
    return this.hidden() && this.flash() ? '💬 New in Seven Friends' : `(${count}) ${this.baseTitle()}`;
  });

  constructor() {
    document.addEventListener('visibilitychange', () => this.hidden.set(document.hidden));

    effect(() => {
      document.title = this.title();
    });

    // the count on the app's icon too (installed web app on a computer or an iPhone home screen; the Android app's launcher shows its own dot
    // for the notifications it has). A browser without the badge API does nothing.
    effect(() => {
      const count = this.count();
      const badge = navigator as Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
      try {
        void (count ? badge.setAppBadge?.(count) : badge.clearAppBadge?.())?.catch(() => undefined);
      } catch {
        /* no badge */
      }
    });

    // flash while something is waiting and the tab is in the background
    effect((onCleanup) => {
      if (!this.count() || !this.hidden()) {
        this.flash.set(false);
        return;
      }
      const timer = setInterval(() => this.flash.update((on) => !on), FLASH_MS);
      onCleanup(() => clearInterval(timer));
    });
  }
}
