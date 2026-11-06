import { Injectable } from '@angular/core';

/** Looking again when the app comes to the front is not needed more often than this. */
const CHECK_EVERY_MS = 20 * 1000;
/** A window that stays open (an installed browser app, a tab) looks at least this often. */
const HOURLY_MS = 60 * 60 * 1000;
/** A new version that could not be loaded yet (the person was busy) is tried again this often. */
const RETRY_MS = 60 * 1000;
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
  /** a newer version exists but the page could not be reloaded yet */
  private waiting = false;

  constructor() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
    });
    void this.check();
    setInterval(() => void this.check(true), HOURLY_MS);
    setInterval(() => {
      if (this.waiting && this.safeToReload()) location.reload();
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
      if (latest && latest !== mine) {
        if (this.safeToReload()) location.reload();
        else this.waiting = true;
      }
    } catch {
      /* offline or the server is busy: the next time the app comes forward */
    } finally {
      this.checking = false;
    }
  }

  private safeToReload(): boolean {
    if (BUSY_PAGE.test(location.pathname)) return false;
    const field = document.activeElement;
    const typing = field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement;
    return !(typing && field.value.trim().length > 0);
  }
}
