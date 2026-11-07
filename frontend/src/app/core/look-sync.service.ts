import { Injectable, effect, inject, untracked } from '@angular/core';
import { Circle, CircleSettings } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DEFAULTS, UiPreferencesService } from './ui-preferences';

/** The choices that are kept on the circle (the others in UiPreferences are about this screen or this device). */
const SYNCED: readonly (keyof CircleSettings)[] = ['theme', 'textSize', 'chatOrder', 'enterSends', 'sleepList', 'feedIcons', 'quickMessages'];

/**
 * Keeps the settings (theme, text size, order, Enter, sleep list, pictures, ready-made messages) on the CIRCLE the person works in, so every device shows the same
 * and each circle can have its own. For now that is always the first (default) circle; `circleId` is the one place that will say which circle is active.
 * Signed in (and each time the app comes back to the front) the circle's choices are read and shown; a change made here is saved to the circle.
 * A choice the circle does not have yet is saved from this device, but only when it is not the default (an unused device does not overwrite the real choice).
 */
@Injectable({ providedIn: 'root' })
export class LookSyncService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly signals = SYNCED.map((key) => [key, this.prefs.value(key)] as const);

  /** the circle the settings belong to (null = not known yet) */
  private circleId: string | null = null;
  /** what the circle is known to have (null = not read yet: nothing is saved before it is) */
  private known: Partial<CircleSettings> | null = null;

  constructor() {
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        this.known = null;
        if (user) void this.pull();
      });
    });
    // a change made on this device is saved to the account
    effect(() => {
      const current = Object.fromEntries(this.signals.map(([key, value]) => [key, value()]));
      untracked(() => void this.push(current));
    });
    // the app comes back to the front: another device may have changed something
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.auth.user()) void this.pull(); });
  }

  /** Reads the choices of the circle and shows them; what the circle lacks is filled from this device. */
  private async pull(): Promise<void> {
    try {
      const { circles } = await this.api.request<{ circles: Circle[] }>('/circles');
      const circle = circles[0]; // the circle the person works in (the first one for now)
      if (!circle) return;
      this.circleId = circle.id;
      const stored = circle.settings ?? {};
      this.known = { ...stored };
      for (const key of SYNCED) {
        if (stored[key] !== undefined) (this.prefs.set as (k: string, v: unknown) => void)(key, stored[key]);
      }
      await this.push(Object.fromEntries(SYNCED.map((key) => [key, this.prefs.get(key)])));
    } catch {
      /* offline or signed out: the choices of this device stay */
    }
  }

  private async push(current: Record<string, unknown>): Promise<void> {
    const known = this.known;
    const circleId = this.circleId;
    if (!known || !circleId || !this.auth.user()) return;
    const changed: Record<string, unknown> = {};
    for (const key of SYNCED) {
      const same = JSON.stringify(known[key]) === JSON.stringify(current[key]);
      // the account has no value and this is the default: nothing to keep (so an unused device never overwrites a real choice)
      const unused = known[key] === undefined && JSON.stringify(current[key]) === JSON.stringify(DEFAULTS[key]);
      if (!same && !unused) changed[key] = current[key];
    }
    if (!Object.keys(changed).length) return;
    this.known = { ...known, ...changed };
    try {
      await this.api.request<Circle>(`/circles/${circleId}/settings`, { method: 'PUT', body: JSON.stringify(changed) });
    } catch {
      this.known = known; // not saved: the next change or return to the app tries again
    }
  }
}
