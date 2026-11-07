import { Injectable, effect, inject, untracked } from '@angular/core';
import { AccountSettings, ProfileDetails } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DEFAULTS, UiPreferencesService } from './ui-preferences';

/** The choices that are kept on the account (the others in UiPreferences are about this screen or this device). */
const SYNCED: readonly (keyof AccountSettings)[] = ['theme', 'textSize', 'chatOrder', 'enterSends', 'sleepList', 'feedIcons', 'quickMessages'];

/**
 * Keeps the settings that follow the person (theme, text size, order, Enter, sleep list, pictures, ready-made messages) on the account, so every device shows the same.
 * Signed in (and each time the app comes back to the front) the account's choices are read and shown; a change made here is saved to the account.
 * A choice the account does not have yet is saved from this device, but only when it is not the default (an unused device does not overwrite the real choice).
 */
@Injectable({ providedIn: 'root' })
export class LookSyncService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly signals = SYNCED.map((key) => [key, this.prefs.value(key)] as const);

  /** what the account is known to have (null = not read yet: nothing is saved before it is) */
  private known: Partial<AccountSettings> | null = null;

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

  /** Reads the account's choices and shows them; what the account lacks is filled from this device. */
  private async pull(): Promise<void> {
    try {
      const profile = await this.api.request<ProfileDetails>('/profile');
      const account = profile.settings ?? {};
      this.known = { ...account };
      for (const key of SYNCED) {
        if (account[key] !== undefined) (this.prefs.set as (k: string, v: unknown) => void)(key, account[key]);
      }
      await this.push(Object.fromEntries(SYNCED.map((key) => [key, this.prefs.get(key)])));
    } catch {
      /* offline or signed out: the choices of this device stay */
    }
  }

  private async push(current: Record<string, unknown>): Promise<void> {
    const known = this.known;
    if (!known || !this.auth.user()) return;
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
      await this.api.request<ProfileDetails>('/profile', { method: 'PUT', body: JSON.stringify({ settings: changed }) });
    } catch {
      this.known = known; // not saved: the next change or return to the app tries again
    }
  }
}
