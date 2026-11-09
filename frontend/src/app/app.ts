import { Component, effect, inject, untracked } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { UiPreferencesService } from './core/ui-preferences';
import { BottomNav } from './bottom-nav/bottom-nav';
import { CircleSwitch } from './circle-switch/circle-switch';
import { OwnKeyPrompt } from './own-key-prompt/own-key-prompt';
import { AndroidChannelsService } from './core/android-channels.service';
import { AppUpdateService } from './core/app-update.service';
import { AuthService } from './core/auth.service';
import { FriendLinkService } from './core/friend-link.service';
import { InstallService } from './core/install.service';
import { LanguageService } from './core/language.service';
import { LookSyncService } from './core/look-sync.service';
import { PresenceService } from './core/presence.service';
import { RealtimeService } from './core/realtime.service';

/** The pages that are shown again at the next start: the main pages and a conversation (not forms, pickers, sign-in). */
const REMEMBERED_PAGE = /^\/(friends(\/sleeping|\/(?!add$|join$)[^/]+)?|pending|settings\/(profile|preferences|sounds|notifications))?$/;

/**
 * The send-a-photo/video/voice pages: while the phone's camera app is in front, Android may close this app to free memory, and it starts
 * again at the start page. Within MEDIA_RETURN_MS the person is taken back to the page they were on (the picture itself is lost, but they
 * do not have to find the page again). Not kept longer: an old send page is not a place to start a new day.
 */
const MEDIA_PAGE = /^\/friends\/[^/]+\/(image|video|audio)$/;
const MEDIA_RETURN_KEY = 'sf-media-return';
const MEDIA_RETURN_MS = 3 * 60 * 1000;

function mediaReturn(url: string | null): string | null {
  try {
    if (url) {
      localStorage.setItem(MEDIA_RETURN_KEY, JSON.stringify({ url, at: Date.now() }));
      return null;
    }
    const saved = JSON.parse(localStorage.getItem(MEDIA_RETURN_KEY) ?? 'null') as { url?: string; at?: number } | null;
    localStorage.removeItem(MEDIA_RETURN_KEY);
    return saved?.url && MEDIA_PAGE.test(saved.url) && Date.now() - (saved.at ?? 0) < MEDIA_RETURN_MS ? saved.url : null;
  } catch {
    return null; // storage not available: nothing to go back to
  }
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BottomNav, CircleSwitch, OwnKeyPrompt],
  templateUrl: './app.html'
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly prefs = inject(UiPreferencesService);
  private readonly friendLink = inject(FriendLinkService);

  constructor() {
    inject(LanguageService); // the texts follow the language of the account (or the country, or the browser)
    inject(RealtimeService); // starts listening for live updates (friend requests, messages) once somebody is signed in
    inject(LookSyncService); // the theme and the text size are kept on the account, so every device shows them
    inject(InstallService); // catches the browser's install offer early (it can arrive soon after the page opens)
    inject(PresenceService); // tells the system when the person is active, away or offline (the dot on their friends)
    inject(AndroidChannelsService); // Android's notification channels follow the sounds chosen here
    inject(AppUpdateService); // a new version of the web app is loaded when the app comes to the front, and at least once an hour

    // The page that was open last is remembered (UiPreferences.lastPage) and shown again when the app is opened at its start page.
    let first = true;
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const url = event.urlAfterRedirects.split('?')[0].split('#')[0];
      // somebody opened a friend link and is signed in: answer it first (signed out, the login page shows what it is about)
      if (this.auth.user() && this.friendLink.pending() && url !== '/friends/join') {
        void this.router.navigateByUrl('/friends/join', { replaceUrl: true });
        return;
      }
      if (first) {
        first = false;
        const back = url === '/' ? mediaReturn(null) : null;
        if (back) {
          void this.router.navigateByUrl(back, { replaceUrl: true });
          return;
        }
        const last = this.prefs.get('lastPage');
        if (url === '/' && last && last !== '/') {
          void this.router.navigateByUrl(last, { replaceUrl: true });
          return;
        }
      }
      if (MEDIA_PAGE.test(url)) mediaReturn(url);
      else {
        try { localStorage.removeItem(MEDIA_RETURN_KEY); } catch { /* storage not available */ }
        if (REMEMBERED_PAGE.test(url)) this.prefs.set('lastPage', url);
      }
    });
    // signed out: the next person starts at the start page
    let wasSignedIn = false;
    effect(() => {
      const signedIn = Boolean(this.auth.user());
      untracked(() => {
        if (wasSignedIn && !signedIn) {
          this.prefs.set('lastPage', null);
          this.prefs.set('setup', 'new'); // the next person is offered the setup
        }
        wasSignedIn = signedIn;
      });
    });
  }
}
