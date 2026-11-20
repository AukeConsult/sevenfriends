import { Injectable } from '@angular/core';

/** True while the app reloads itself for a new version (the "close the app?" question of an installed app must not come then). */
export const appIsUpdating = { value: false };

/** Looking again when the app comes to the front is not needed more often than this. */
const CHECK_EVERY_MS = 20 * 1000;
/** A window that stays open (an installed browser app, a tab) looks at least this often. */
const HOURLY_MS = 60 * 60 * 1000;
/** A new version that could not be loaded yet (the person was busy) is tried again this often. */
const RETRY_MS = 60 * 1000;
/** The same new version is loaded again at the earliest after this long: a page that still looks old after a reload (a cache that has not caught up) must not reload at every start. */
const NO_REPEAT_MS = 10 * 60 * 1000;
const TRIED_KEY = 'sf-update-tried';
/** Pages where a reload would throw away what the person is busy with (a picture being sent). */
const BUSY_PAGE = /^\/friends\/[^/]+\/(image|video|audio)$/;

/**
 * The Android app and the installed browser app show the live website, so a new version only needs to be loaded: when the app opens or
 * comes back to the front, and at least once an hour while it stays open, index.html is read again (never from the cache) and, when it
 * names another main script than the one running, the page is loaded again. Not in the middle of sending a picture, or while the person
 * is typing something: then it waits and tries again every minute.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private lastCheck = 0;
  private checking = false;
  /** a newer version (its main script) exists but the page could not be reloaded yet */
  private waiting: string | null = null;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
    });
    window.addEventListener('sf-resume', () => void this.check()); // the Android app tells the page that it is back (the WebView may not send visibilitychange)
    window.addEventListener('pageshow', () => void this.check());
    void this.check();
    setInterval(() => void this.check(true), HOURLY_MS);
    setInterval(() => {
      if (this.waiting && this.safeToReload()) this.reload(this.waiting);
    }, RETRY_MS);
  }

  private running(): string | null {
    const script = document.querySelector<HTMLScriptElement>('script[src*="main-"]');
    return script ? (script.getAttribute('src') ?? '').split('/').pop() ?? null : null;
  }

  private async check(force = false): Promise<void> {
    const now = Date.now();
    if (this.checking || (!force && now - this.lastCheck < CHECK_EVERY_MS)) return;
    this.checking = true;
    this.lastCheck = now;
    try {
      const mine = this.running();
      if (!mine) return;
      const res = await fetch(`/index.html?check=${now}`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = /<script[^>]+src="([^"]*main-[^"]+\.js)"/.exec(await res.text())?.[1]?.split('/').pop();
      if (latest && latest !== mine && !this.triedRecently(latest)) {
        if (this.safeToReload()) this.reload(latest);
        else this.waiting = latest;
      }
    } catch {
      /* offline or the server is busy: the next time the app comes forward */
    } finally {
      this.checking = false;
    }
  }

  /** This version was loaded for a moment ago already (and the page still shows the old one): not again now. */
  private triedRecently(latest: string): boolean {
    try {
      const [name, time] = (sessionStorage.getItem(TRIED_KEY) ?? '').split('|');
      return name === latest && Date.now() - Number(time) < NO_REPEAT_MS;
    } catch {
      return false;
    }
  }

  private reload(latest: string): void {
    try {
      sessionStorage.setItem(TRIED_KEY, `${latest}|${Date.now()}`);
    } catch {
      /* no storage: the reload still happens */
    }
    appIsUpdating.value = true;
    location.reload();
  }

  private safeToReload(): boolean {
    if (BUSY_PAGE.test(location.pathname)) return false;
    const field = document.activeElement;
    const typing = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
    return !(typing && field.value.trim().length > 0);
  }
}
