import { Injectable } from '@angular/core';

/** The name of the main script of a page (`main-I4MMNZ4K.js`): it changes with every build, so it tells which version this is. A development server has no such name. */
const MAIN = /main-[A-Za-z0-9]{6,}\.js/;

/**
 * Keeps an app that stays open up to date. The Windows app lives in the tray and the Android app in the background, so their page is never loaded again by itself:
 * after a deploy they would show the old version for days. When the app comes back to the front after a while (or from time to time while it is open), this looks at
 * the start page on the server and, when its main script is another one than the one running, loads the page again.
 */
@Injectable({ providedIn: 'root' })
export class AppVersionService {
  private readonly running = MAIN.exec(document.querySelector('script[src*="main-"]')?.getAttribute('src') ?? '')?.[0] ?? null;
  private hiddenSince = 0;
  private lastLook = 0;

  constructor() {
    if (!this.running) return; // a development server: nothing to compare
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.hiddenSince = Date.now();
      else if (this.hiddenSince && Date.now() - this.hiddenSince > 60_000) void this.look(); // back after a minute or more
    });
    setInterval(() => { if (document.visibilityState === 'visible') void this.look(); }, 30 * 60_000); // an app that stays in front
  }

  private async look(): Promise<void> {
    if (Date.now() - this.lastLook < 2 * 60_000) return; // not more than once in two minutes
    this.lastLook = Date.now();
    try {
      const page = await (await fetch('/index.html', { cache: 'no-store' })).text();
      const live = MAIN.exec(page)?.[0];
      if (live && live !== this.running) location.reload(); // a new version was deployed
    } catch { /* offline: try again later */ }
  }
}
