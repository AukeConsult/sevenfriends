import { Injectable } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/** Looking again is not needed more often than this. */
const CHECK_EVERY_MS = 20 * 1000;
/** Pages where a reload would throw away what the person is busy with (a picture being sent). */
const BUSY_PAGE = /^\/friends\/[^/]+\/(image|video|audio)$/;

/**
 * The Android app shows the live website (capacitor.config.json: server.url), so a new version only needs to be loaded: whenever the
 * app opens or comes back to the front, index.html is read again (never from the cache) and, when it names another main script than the
 * one running, the page is loaded again. Not in the middle of sending a picture, or while the person is typing something.
 */
@Injectable({ providedIn: 'root' })
export class AppUpdateService {
  private lastCheck = 0;
  private checking = false;

  constructor() {
    if (!Capacitor.isNativePlatform()) return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.check();
    });
    void this.check();
  }

  private running(): string | null {
    const script = document.querySelector<HTMLScriptElement>('script[src*="main-"]');
    return script ? (script.getAttribute('src') ?? '').split('/').pop() ?? null : null;
  }

  private async check(): Promise<void> {
    const now = Date.now();
    if (this.checking || now - this.lastCheck < CHECK_EVERY_MS) return;
    this.checking = true;
    this.lastCheck = now;
    try {
      const mine = this.running();
      if (!mine) return;
      const res = await fetch(`/index.html?check=${now}`, { cache: 'no-store' });
      if (!res.ok) return;
      const latest = /<script[^>]+src="([^"]*main-[^"]+\.js)"/.exec(await res.text())?.[1]?.split('/').pop();
      if (latest && latest !== mine && this.safeToReload()) location.reload();
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
