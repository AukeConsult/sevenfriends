import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { fileExists } from '../core/download';
import { FriendLinkService } from '../core/friend-link.service';
import { InstallService } from '../core/install.service';
import { WelcomeService } from '../core/welcome.service';
import { Hero } from '../hero/hero';

/**
 * The first page for someone who has not installed the app on this device (public, shown before sign-in): the same top for
 * everybody (logo, slogan, the points) and ONE install action for this platform: Android (the app file), iPhone / iPad (Add to
 * Home Screen), Windows (the installer) or another computer (the browser's own install). "Continue in the browser" goes on to
 * sign-in. When a friend invitation is waiting, it says so first. See docs/invite-install-login.md.
 */
@Component({
  selector: 'app-welcome',
  imports: [RouterLink, Hero],
  templateUrl: './welcome.html',
})
export class Welcome implements OnInit {
  protected readonly app = inject(InstallService);
  private readonly welcome = inject(WelcomeService);
  private readonly router = inject(Router);
  private readonly friendLinks = inject(FriendLinkService);
  private readonly friend = this.friendLinks.pending;
  /** the waiting invitation was copied to the clipboard (when the download was tapped) */
  protected readonly copied = signal(false);

  protected readonly kind: 'android' | 'ios' | 'windows' | 'other' = this.app.androidDevice ? 'android' : this.app.ios ? 'ios' : this.app.windows ? 'windows' : 'other';
  /** is the app file on the website (Android and Windows)? null = still asking */
  protected readonly fileReady = signal<boolean | null>(null);

  protected readonly invited = computed(() => this.friend() !== null);
  /** who the link points to, when it says so (an email or a phone number) */
  protected readonly invitedBy = computed(() => this.friend()?.email ?? this.friend()?.phone ?? null);

  ngOnInit(): void {
    const file = this.kind === 'android' ? '/downloads/SevenFriends.apk' : this.kind === 'windows' ? '/downloads/SevenFriendsSetup.exe' : null;
    if (file) void fileExists(file).then((found) => this.fileReady.set(found));
  }

  /** Before an app is downloaded the invitation link goes to the clipboard: the app has its own storage and cannot see it, the person pastes it there (sign-in page, "I have an invitation"). */
  protected copyInvitation(): void {
    const pending = this.friend();
    if (!pending) return;
    navigator.clipboard?.writeText(this.friendLinks.linkText(pending)).then(() => this.copied.set(true), () => undefined);
  }

  protected install(): void {
    void this.app.install();
  }

  protected continueInBrowser(): void {
    this.welcome.continueInBrowser();
    void this.router.navigateByUrl('/login');
  }
}
