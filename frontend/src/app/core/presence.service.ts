import { Injectable, effect, inject, untracked } from '@angular/core';
import { Presence } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { FriendsService } from './friends.service';
import { InstallService } from './install.service';

/** How often a signed-in app reports (the server counts a silent app as offline after 2.5 minutes). */
const HEARTBEAT_MS = 60000;

/**
 * Tells the system whether the person is using the app, so friends see a dot: 'active' = the screen is on and the
 * app is in front, 'passive' = signed in but the page is hidden (another tab, minimized, screen off), 'offline' =
 * signed out or closed. It reports at every change and once a minute; while the page is in front it also refreshes
 * the friends list, so the dots of the friends move on.
 */
@Injectable({ providedIn: 'root' })
export class PresenceService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly friends = inject(FriendsService);
  private readonly install = inject(InstallService);
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor() {
    effect(() => {
      const signedIn = Boolean(this.auth.user());
      untracked(() => (signedIn ? this.start() : this.stop()));
    });
    document.addEventListener('visibilitychange', () => this.report());
    // closing the installed app asks first (the browser shows its own question: the text cannot be changed); a browser tab is left alone
    window.addEventListener('beforeunload', (event) => {
      if (!this.auth.user() || !this.install.runsAsApp()) return;
      event.preventDefault();
      event.returnValue = '';
    });
    window.addEventListener('pagehide', () => this.report('offline', true)); // closed (a reload reports active again at once)
  }

  private start(): void {
    this.stop();
    this.report();
    this.timer = setInterval(() => {
      this.report();
      if (document.visibilityState === 'visible' && this.friends.circle()) void this.friends.load().catch(() => undefined);
    }, HEARTBEAT_MS);
  }

  private stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private current(): Presence {
    return document.visibilityState === 'visible' ? 'active' : 'passive';
  }

  private report(state: Presence = this.current(), keepalive = false): void {
    if (!this.auth.user()) return;
    void this.send(state, keepalive);
  }

  private async send(state: Presence, keepalive: boolean): Promise<void> {
    try {
      await this.api.request('/profile/presence', { method: 'PUT', body: JSON.stringify({ state }), keepalive });
    } catch {
      /* offline or signed out: the next report tries again */
    }
  }

  /** Signing out: tell the system first, while the login still works. */
  async goOffline(): Promise<void> {
    this.stop();
    await this.send('offline', false);
  }
}
