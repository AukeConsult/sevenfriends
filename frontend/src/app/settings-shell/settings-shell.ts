import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { InstallService } from '../core/install.service';
import { SettingsTab, UiPreferencesService } from '../core/ui-preferences';
import { tr } from '../core/i18n';
import { PageBar } from '../page-bar/page-bar';

/** The Settings page: one tab for each part (the part itself is the page shown under the tabs). */
@Component({
  selector: 'app-settings-shell',
  imports: [PageBar, RouterLink, RouterOutlet, TranslocoDirective],
  templateUrl: './settings-shell.html',
  providers: [provideTranslocoScope('settingsShell')],
})
export class SettingsShell {
  /** `install.native`: the Android app has no "Install the app" page */
  protected readonly install = inject(InstallService);
  private readonly router = inject(Router);
  private readonly prefs = inject(UiPreferencesService);

  constructor() {
    // the tab that is open is remembered: Settings opens on it the next time (app.routes.ts)
    this.router.events.subscribe((event) => {
      if (!(event instanceof NavigationEnd)) return;
      const open = this.tabs.find((tab) => this.on(tab));
      if (open && !(open.browserOnly && this.install.native)) this.prefs.set('settingsTab', open.path as SettingsTab);
    });
  }

  /** the tab is lit on its own page, and the Info tab also on the terms and the privacy page */
  protected on(tab: { path: string; also?: string[] }): boolean {
    return [tab.path, ...(tab.also ?? [])].some((path) =>
      this.router.isActive('/settings/' + path, { paths: 'subset', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' }),
    );
  }

  protected readonly tabs = [
    { path: 'profile', label: tr('settingsShell.profile', 'Profile') },
    { path: 'preferences', label: tr('settingsShell.preferences', 'Display and chat') },
    { path: 'notifications', label: tr('settingsShell.notifications', 'Notifications') },
    { path: 'encryption', label: tr('settingsShell.keys', 'Privacy lock') },
    { path: 'install', label: tr('settingsShell.install', 'Install'), browserOnly: true },
    { path: 'about', label: tr('settingsShell.info', 'About and rules'), also: ['terms', 'privacy'] },
  ];
}
