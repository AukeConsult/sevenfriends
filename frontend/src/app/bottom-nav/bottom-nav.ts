import { Component, HostListener, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { NotificationsService } from '../core/notifications.service';

/** Always-visible banner menu at the bottom of the screen (shown when signed in). */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.html',
  styleUrl: './bottom-nav.scss',
})
export class BottomNav {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationsService);

  /** The Profile item opens a dropup menu (profile page + log out). */
  protected readonly menuOpen = signal(false);

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  @HostListener('document:keydown.escape')
  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  /** Clicking Home runs the invite + message check (also when already on Home). */
  protected onHome(): void {
    this.closeMenu();
    this.notifications.refresh();
  }

  protected profileActive(): boolean {
    return this.router.url.startsWith('/profile');
  }

  protected async logout(): Promise<void> {
    this.closeMenu();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}
