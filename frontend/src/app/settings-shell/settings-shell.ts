import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { swipeOf, usesSideways } from '../core/swipe';
import { PageBar } from '../page-bar/page-bar';

/** Settings: the header bar (the name of the part that is open, a back arrow to the list) above the page that is open. The list itself is `SettingsHome`. */
@Component({
  selector: 'app-settings-shell',
  imports: [PageBar, RouterOutlet, TranslocoDirective],
  templateUrl: './settings-shell.html',
  providers: [provideTranslocoScope('settingsShell', 'settings')],
})
export class SettingsShell {
  private readonly router = inject(Router);

  /** the address that is open now */
  private readonly url = signal(this.router.url);

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.url.set(this.router.url);
    });
  }

  // Swipe to the left: back, like the arrow of the bar (a part goes to the list, the list goes to Home).
  private swipe: { x: number; y: number; time: number } | null = null;

  @HostListener('document:touchstart', ['$event'])
  protected onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.swipe = event.touches.length === 1 && touch && !usesSideways(event.target as Element | null) ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
  }

  @HostListener('document:touchend', ['$event'])
  protected onTouchEnd(event: TouchEvent): void {
    const start = this.swipe;
    this.swipe = null;
    const touch = event.changedTouches[0];
    if (!start || !touch || window.getSelection()?.toString()) return;
    if (swipeOf(start, touch) < 0) void this.router.navigateByUrl(this.backTo() ?? '/');
  }

  /** the part that is open (its name is the title of the bar), or null on the list and on pages that are not a part */
  protected readonly title = computed(() => {
    this.url();
    return this.tabs.find((tab) => this.on(tab)) ?? null;
  });

  /** where the back arrow goes: a part goes back to the list, a page inside a part (a sound, the terms) to its part; the list has no arrow */
  protected readonly backTo = computed<string | null>(() => {
    const path = this.url().split(/[?#]/)[0].replace(/\/$/, '');
    if (path === '/settings') return null;
    if (path.startsWith('/settings/encryption/')) return '/settings/encryption';
    if (path.startsWith('/settings/sounds')) return '/settings/notifications';
    if (path === '/settings/terms' || path === '/settings/privacy' || path === '/settings/locking') return '/settings/about';
    return '/settings';
  });

  /** the part is the open page (its own pages count too: the terms, the privacy page and Locking belong to About and rules) */
  private on(tab: { path: string; also?: string[] }): boolean {
    return [tab.path, ...(tab.also ?? [])].some((path) =>
      this.router.isActive('/settings/' + path, { paths: 'subset', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' }),
    );
  }

  private readonly tabs = [
    { path: 'profile', key: 'profile', fallback: 'Profile' },
    { path: 'friends', key: 'friends', fallback: 'Friends' },
    { path: 'preferences', key: 'preferences', fallback: 'Appearance' },
    { path: 'notifications', key: 'notifications', fallback: 'Notifications' },
    { path: 'encryption', key: 'keys', fallback: 'Privacy lock' },
    { path: 'install', key: 'install', fallback: 'Install' },
    { path: 'about', key: 'info', fallback: 'About and rules', also: ['terms', 'privacy', 'locking'] },
  ];
}
