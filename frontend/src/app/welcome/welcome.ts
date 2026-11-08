import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { FriendLinkService } from '../core/friend-link.service';
import { InstallService } from '../core/install.service';
import { WelcomeService } from '../core/welcome.service';
import { WhyTiles } from '../why-tiles/why-tiles';
import { SeatDots } from '../seat-dots/seat-dots';
import { CIRCLE_PAGES } from '../circle-entry/circle-entry';

/**
 * The first page for someone who has not installed the app on this device (public, shown before sign-in): the same top for
 * everybody (logo, the promise, the seven seats, three numbers and three reasons) and ONE install action for this platform: Android (the app file), iPhone / iPad (Add to
 * Home Screen), Windows (the installer) or another computer (the browser's own install). "Continue in the browser" goes on to
 * sign-in. When a friend invitation is waiting, it says so first. See docs/invite-install-login.md.
 */
@Component({
  selector: 'app-welcome',
  imports: [RouterLink, SeatDots, WhyTiles],
  templateUrl: './welcome.html',
})
export class Welcome {
  private readonly app = inject(InstallService);
  private readonly welcome = inject(WelcomeService);
  private readonly router = inject(Router);
  /** signed in: the page is still shown (it is always open at /welcome), with a way on to the home page */
  protected readonly auth = inject(AuthService);
  private readonly friendLinks = inject(FriendLinkService);
  private readonly friend = this.friendLinks.pending;
  protected readonly kind: 'android' | 'ios' | 'windows' | 'other' = this.app.androidDevice ? 'android' : this.app.ios ? 'ios' : this.app.windows ? 'windows' : 'other';
  /** the install page of this device (each device has its own: Android, iPhone, and Windows or another computer) */
  protected readonly installPage = `/install/${this.kind === 'android' ? 'android' : this.kind === 'ios' ? 'iphone' : 'windows'}`;

  protected readonly invited = computed(() => this.friend() !== null);
  /** who the link points to, when it says so (an email or a phone number) */
  protected readonly invitedBy = computed(() => this.friend()?.email ?? this.friend()?.phone ?? null);

  constructor() {
    // a link that invites into another circle shows the welcome page of that circle (one of its pages, picked by chance)
    const circle = this.friend()?.circle;
    const pages = circle ? CIRCLE_PAGES[circle] : undefined;
    if (pages && !this.auth.user()) void this.router.navigateByUrl(pages[Math.floor(Math.random() * pages.length)], { replaceUrl: true });
  }

  protected continueInBrowser(): void {
    this.welcome.continueInBrowser();
    void this.router.navigateByUrl('/login');
  }
}
