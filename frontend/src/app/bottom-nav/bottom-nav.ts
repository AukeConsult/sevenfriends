import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { NotificationsService } from '../core/notifications.service';
import { PresenceService } from '../core/presence.service';
import { PushService } from '../core/push.service';

/** The pages under the Settings button. */
const SETTINGS_PAGES = ['/sound-and-notifications', '/install-app', '/privacy', '/terms', '/about'];

/** Always-visible banner menu at the bottom of the screen (shown when signed in). */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.html',
})
export class BottomNav {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsService);
  private readonly push = inject(PushService);
  private readonly presence = inject(PresenceService);

  /** Two buttons open a dropup menu: Profile (my profile, log out) and Settings (all the other pages). One at a time. */
  protected readonly menuOpen = signal<'profile' | 'settings' | null>(null);

  protected toggleMenu(which: 'profile' | 'settings'): void {
    this.menuOpen.update((open) => (open === which ? null : which));
  }

  @HostListener('document:keydown.escape')
  protected closeMenu(): void {
    this.menuOpen.set(null);
  }

  /** Clicking Home runs the invite + message check (also when already on Home). */
  protected onHome(): void {
    this.closeMenu();
    this.notifications.refresh();
  }

  protected profileActive(): boolean {
    return this.router.url.startsWith('/profile');
  }

  protected settingsActive(): boolean {
    return SETTINGS_PAGES.some((page) => this.router.url.startsWith(page));
  }

  protected async logout(): Promise<void> {
    this.closeMenu();
    await this.presence.goOffline(); // friends see the gray dot at once
    await this.push.forgetDevice(); // this device stops getting the person's pushes
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
