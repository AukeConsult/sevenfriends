import { Injectable, inject } from '@angular/core';
import { FriendLinkService } from './friend-link.service';
import { InstallService } from './install.service';
import { UiPreferencesService } from './ui-preferences';

const SEEN = 'sf-welcome-seen';
const DAYS = 30;

/**
 * The welcome pages are shown to someone who is signed out and is NOT running the installed app (they offer no install: one button on to
 * the web app). Not shown: inside the Android app, the Windows app or an installed web app, once "Continue in the browser" was chosen
 * (for this visit; and for 30 days when there is no friend invitation waiting: an invitation always shows them again, so they can say who invited).
 */
@Injectable({ providedIn: 'root' })
export class WelcomeService {
  private readonly install = inject(InstallService);
  private readonly link = inject(FriendLinkService);
  private readonly prefs = inject(UiPreferencesService);

  shouldShow(): boolean {
    if (this.install.installed() || this.seenThisVisit()) return false;
    if (this.link.pending()) return true;
    const until = this.prefs.get('welcomeUntil');
    return !(until && until > Date.now());
  }

  /** "Continue in the browser". */
  continueInBrowser(): void {
    try {
      sessionStorage.setItem(SEEN, '1');
    } catch {
      /* private mode: it is asked again */
    }
    if (!this.link.pending()) this.prefs.set('welcomeUntil', Date.now() + DAYS * 24 * 3600 * 1000);
  }

  private seenThisVisit(): boolean {
    try {
      return sessionStorage.getItem(SEEN) === '1';
    } catch {
      return false;
    }
  }
}
