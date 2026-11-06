import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { fileExists } from '../core/download';
import { FriendLinkService } from '../core/friend-link.service';
import { InstallService } from '../core/install.service';
import { WelcomeService } from '../core/welcome.service';

/**
 * One install page for each kind of device (the route says which): Android (installed by download), iPhone (Add to Home Screen)
 * and Windows or another computer (installed as a browser app). Public: the welcome page links here before sign-in.
 */
@Component({
  selector: 'app-install-device',
  imports: [RouterLink],
  templateUrl: './install-device.html',
})
export class InstallDevice implements OnInit {
  protected readonly app = inject(InstallService);
  protected readonly auth = inject(AuthService);
  private readonly welcome = inject(WelcomeService);
  private readonly router = inject(Router);
  private readonly friendLinks = inject(FriendLinkService);
  protected readonly device = inject(ActivatedRoute).snapshot.data['device'] as 'android' | 'iphone' | 'windows';

  /** is the app file on the website? null = still asking */
  protected readonly fileReady = signal<boolean | null>(null);
  /** the waiting invitation was copied to the clipboard (when the download was tapped) */
  protected readonly copied = signal(false);
  protected readonly invited = computed(() => this.friendLinks.pending() !== null);

  ngOnInit(): void {
    if (this.device === 'android') void fileExists('/downloads/SevenFriends.apk').then((found) => this.fileReady.set(found));
  }

  /** Before the app is downloaded the invitation link goes to the clipboard: the app has its own storage and cannot see it, the person pastes it there (sign-in page, "I have an invitation"). */
  protected copyInvitation(): void {
    const pending = this.friendLinks.pending();
    if (!pending) return;
    navigator.clipboard?.writeText(this.friendLinks.linkText(pending)).then(() => this.copied.set(true), () => undefined);
  }

  protected install(): void {
    void this.app.install();
  }

  protected continueInBrowser(): void {
    this.welcome.continueInBrowser();
    void this.router.navigateByUrl(this.auth.user() ? '/' : '/login');
  }
}
