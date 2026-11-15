import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { AccountStatus } from '../models';
import { forgetAccount, rememberedAccounts } from './account-registry';
import { AuthService, LAST_UID_KEY } from './auth.service';
import { storedKeyOwners } from './device-key';
import { wipeAccountLocal, wipeAllLocalData } from './local-wipe';
import { UiPreferencesService } from './ui-preferences';

/** Asking again is not needed more often than this (a quick switch back and forth does not ask the server each time). */
const CHECK_EVERY_MS = 30_000;

export type AccountAnswer = AccountStatus | 'unknown';

/**
 * A device that holds data of an account that was deleted somewhere else (the person deleted it on another device) must not keep it. The server stamps every
 * account (`accountId`, gone with the account); this browser remembers the pairs (user id, stamp) of the accounts it holds. When the app starts, comes back to
 * the front, gets its connection back, or finds its login dead, each pair is asked about (`POST /accounts/check`, no sign-in needed). An account that is GONE is
 * wiped from this device: its key and its local choices, and everything when no other account is left here.
 *
 * Nothing is wiped on a doubt: an answer that is not a clear "gone" (offline, a server error, a page that is not ours) changes nothing, "gone" must be said
 * TWICE a moment apart, and an account that is signed in here is only wiped when its login is really dead (a fresh token is refused, or the server refuses the
 * login), never because of one answer.
 */
@Injectable({ providedIn: 'root' })
export class AccountWatchService implements OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly prefs = inject(UiPreferencesService);

  /** the accounts wiped from this device by this service (for the page and the tests) */
  readonly wiped = signal<string[]>([]);
  /** the moment between the two answers "gone" (milliseconds; short in the tests) */
  delayMs = 1000;

  private running: Promise<void> | null = null;
  private lastRun = 0;

  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') void this.checkAll();
  };
  private readonly onResume = () => void this.checkAll(); // the Android app tells the page that it is back
  private readonly onOnline = () => void this.checkAll(true);
  private readonly startTimer: ReturnType<typeof setTimeout>;

  constructor() {
    document.addEventListener('visibilitychange', this.onVisible);
    window.addEventListener('sf-resume', this.onResume);
    window.addEventListener('online', this.onOnline);
    this.startTimer = setTimeout(() => void this.checkAll(true), 1500); // at the start, after the page has painted
  }

  ngOnDestroy(): void {
    clearTimeout(this.startTimer);
    document.removeEventListener('visibilitychange', this.onVisible);
    window.removeEventListener('sf-resume', this.onResume);
    window.removeEventListener('online', this.onOnline);
  }

  /** Asks about every account this browser holds; one run at a time. `force` = also within the 30 seconds. */
  checkAll(force = false): Promise<void> {
    if (this.running) return this.running;
    if (!force && Date.now() - this.lastRun < CHECK_EVERY_MS) return Promise.resolve();
    this.lastRun = Date.now();
    this.running = this.run().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(): Promise<void> {
    for (const { uid, accountId } of rememberedAccounts()) {
      try {
        if ((await this.ask(uid, accountId)) !== 'gone') continue;
        await new Promise((resolve) => setTimeout(resolve, this.delayMs));
        if ((await this.ask(uid, accountId)) !== 'gone') continue; // twice, or nothing
        if (!(await this.loginIsDead(uid))) continue;
        await this.wipe(uid);
      } catch {
        /* a doubt is never a reason to wipe: the next time asks again */
      }
    }
  }

  /** The server's answer for one pair; anything but a clear answer is "unknown". */
  private async ask(uid: string, accountId: string): Promise<AccountAnswer> {
    try {
      const res = await fetch(`${environment.apiBase}/accounts/check`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid, accountId }) });
      if (!res.ok) return 'unknown';
      const body: unknown = await res.json();
      const status = (body as { status?: unknown } | null)?.status;
      return status === 'gone' ? 'gone' : status === 'active' ? 'active' : 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * An account that is not signed in here has no login to look at. One that IS signed in here is only wiped when its login is dead: a fresh token is refused
   * (Firebase deleted the login), or the server refuses it (the login is gone, or the account document is). A token that works and an API that answers means
   * the account is alive, whatever the check said.
   */
  private async loginIsDead(uid: string): Promise<boolean> {
    const user = this.auth.user();
    if (!user || user.uid !== uid) return true;
    let token: string;
    try {
      token = await user.getIdToken(true);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? '';
      return code === 'auth/user-not-found' || code === 'auth/user-token-expired' || code === 'auth/user-disabled' || code === 'auth/invalid-user-token';
    }
    try {
      const res = await fetch(`${environment.apiBase}/keys`, { headers: { Authorization: `Bearer ${token}` } });
      return res.status === 401;
    } catch {
      return false; // no connection: not a reason to wipe
    }
  }

  /** Wipes what this device holds of ONE account (its key and local choices), and everything when nobody else is left on this device. */
  async wipe(uid: string): Promise<void> {
    const signedIn = this.auth.user()?.uid === uid;
    if (signedIn) await this.auth.logout().catch(() => undefined);
    forgetAccount(uid);
    await wipeAccountLocal(uid);
    try {
      if (localStorage.getItem(LAST_UID_KEY) === uid) {
        localStorage.removeItem(LAST_UID_KEY);
        sessionStorage.clear();
        this.prefs.clearAccountChoices();
      }
    } catch {
      /* no storage */
    }
    const othersRemembered = rememberedAccounts().some((a) => a.uid !== uid);
    const othersKeys = (await storedKeyOwners()).some((owner) => owner !== uid);
    if (!othersRemembered && !othersKeys) await wipeAllLocalData(); // nothing of anybody else is here: nothing stays
    this.wiped.update((list) => [...list, uid]);
    if (signedIn) this.goHome(); // a clean start on the login page
  }

  /** Opens the front page again, as a new start (the tests replace this). */
  protected goHome(): void {
    location.assign('/');
  }
}
