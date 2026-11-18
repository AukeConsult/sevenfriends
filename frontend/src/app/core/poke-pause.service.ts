import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { LiveChanges } from './live-changes';
import { PokePause } from '../models';

/**
 * Pause pokes: for a limited time (at most 24 hours) a poke to me arrives as an ordinary message instead of ringing, and my friends see the mood "Silent" in every
 * circle. It is kept on the account, so it holds on every device. The server ends it by itself; the page only compares the time. See docs/design/poke-alarm.md.
 */
@Injectable({ providedIn: 'root' })
export class PokePauseService {
  private readonly api = inject(ApiService);
  private readonly live = inject(LiveChanges);
  /** when the pause ends (ms), null = pokes are on */
  readonly until = signal<number | null>(null);
  private readonly now = signal(Date.now());
  /** pokes are paused now */
  readonly paused = computed(() => {
    const until = this.until();
    return until !== null && until > this.now();
  });
  readonly loaded = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    setInterval(() => this.now.set(Date.now()), 30_000); // the pause ends on the screen too
    // the pause was set, ended or finished on another device of mine (the server touches `profile` for each): show it here at once
    this.live.on('profile').subscribe(() => {
      if (this.loaded()) void this.load();
    });
    // the app came back to the front: it may have changed meanwhile
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.loaded()) void this.load();
    });
  }

  async load(): Promise<void> {
    try {
      this.set(await this.api.request<PokePause>('/profile/poke-pause'));
    } catch {
      /* not known: the card shows "on" */
    } finally {
      this.loaded.set(true);
    }
  }

  /** Pause pokes for this many minutes (1 to 1440). */
  async pause(minutes: number): Promise<void> {
    await this.send(minutes);
  }

  /** End the pause now. */
  async resume(): Promise<void> {
    await this.send(null);
  }

  private async send(minutes: number | null): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.set(await this.api.request<PokePause>('/profile/poke-pause', { method: 'PUT', body: JSON.stringify({ minutes }) }));
    } catch (err: any) {
      this.error.set(err?.message ?? 'Could not change it');
    } finally {
      this.busy.set(false);
    }
  }

  private set(answer: PokePause): void {
    this.now.set(Date.now());
    this.until.set(answer.until ? Date.parse(answer.until) : null);
  }

  /** The minutes from now until 08:00 (this computer's time) the next time it is 08:00: "Until morning". Always 1 to 1440. */
  static minutesUntilMorning(from: Date = new Date()): number {
    const morning = new Date(from);
    morning.setHours(8, 0, 0, 0);
    if (morning.getTime() <= from.getTime() + 60_000) morning.setDate(morning.getDate() + 1);
    return Math.max(1, Math.min(1440, Math.round((morning.getTime() - from.getTime()) / 60_000)));
  }
}
