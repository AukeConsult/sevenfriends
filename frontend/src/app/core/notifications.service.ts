import { Injectable, inject, signal } from '@angular/core';
import { CheckResult } from '../models';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';
import { FriendsService } from './friends.service';
import { MessagesService } from './messages.service';
import { tr } from './i18n';

/**
 * Runs the "check" that fires when Home is opened or clicked:
 *  1. has someone invited me? (matched on my email, phone number or social media)
 *  2. are there pending (unread) messages?
 */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  private readonly api = inject(ApiService);
  private readonly friends = inject(FriendsService);
  private readonly messages = inject(MessagesService);
  private readonly active = inject(ActiveCircleService);

  readonly loading = signal(false);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  private inflight: Promise<void> | null = null;

  constructor() {
    // another circle: a check that is still running was asked in the old one, so a new one is made for the new circle
    this.active.onSwitch(() => {
      this.inflight = null;
      this.loading.set(false);
      this.loaded.set(false);
      this.error.set(null);
    });
  }

  /** Safe to call often: a check that is already running is reused. */
  refresh(): Promise<void> {
    if (this.inflight) return this.inflight;

    this.loading.set(true);
    this.error.set(null);
    const generation = this.active.generation;
    const run: Promise<void> = (async () => {
      try {
        const res = await this.api.request<CheckResult>(
          '/notifications/check',
          { method: 'POST' },
        );
        // blind to the other circles: the messages are the ones of this circle; a request still always lands in the friends circle, so only that app shows them (until a request carries its circle)
        if (generation !== this.active.generation) return; // the circle was changed meanwhile: this answer is about the old one
        this.friends.requests.set(res.requests); // the server answers with the requests of the circle this app is in only
        this.messages.replace(res.messages);
      } catch (err: any) {
        if (generation === this.active.generation) this.error.set(err.message ?? tr('core.couldNotLoadNotifications', 'Could not load notifications'));
      } finally {
        if (generation === this.active.generation) {
          this.loading.set(false);
          this.loaded.set(true);
          this.inflight = null;
        }
      }
    })();
    this.inflight = run;
    return run;
  }
}
