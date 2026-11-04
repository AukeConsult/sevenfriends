import { Component, effect, inject, untracked } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { UiPreferencesService } from './core/ui-preferences';
import { BottomNav } from './bottom-nav/bottom-nav';
import { AuthService } from './core/auth.service';
import { FriendLinkService } from './core/friend-link.service';
import { InstallService } from './core/install.service';
import { PresenceService } from './core/presence.service';
import { RealtimeService } from './core/realtime.service';

/** The pages that are shown again at the next start: the main pages and a conversation (not forms, pickers, sign-in). */
const REMEMBERED_PAGE = /^\/(friends(\/sleeping|\/(?!add$|join$)[^/]+)?|pending|profile|sound-and-notifications)?$/;

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BottomNav],
  templateUrl: './app.html'
})
export class App {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly prefs = inject(UiPreferencesService);
  private readonly friendLink = inject(FriendLinkService);

  constructor() {
    inject(RealtimeService); // starts listening for live updates (friend requests, messages) once somebody is signed in
    inject(InstallService); // catches the browser's install offer early (it can arrive soon after the page opens)
    inject(PresenceService); // tells the system when the person is active, away or offline (the dot on their friends)

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
        const last = this.prefs.get('lastPage');
        if (url === '/' && last && last !== '/') {
          void this.router.navigateByUrl(last, { replaceUrl: true });
          return;
        }
      }
      if (REMEMBERED_PAGE.test(url)) this.prefs.set('lastPage', url);
    });
    // signed out: the next person starts at the start page
    let wasSignedIn = false;
    effect(() => {
      const signedIn = Boolean(this.auth.user());
      untracked(() => {
        if (wasSignedIn && !signedIn) this.prefs.set('lastPage', null);
        wasSignedIn = signedIn;
      });
    });
  }
}
