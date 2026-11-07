import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { InstallService } from '../core/install.service';

/** The Settings page: one tab for each part (the part itself is the page shown under the tabs). */
@Component({
  selector: 'app-settings-shell',
  imports: [RouterLink, RouterOutlet],
  templateUrl: './settings-shell.html',
})
export class SettingsShell {
  /** `install.native`: the Android app has no "Install the app" page */
  protected readonly install = inject(InstallService);
  private readonly router = inject(Router);

  /** the tab is lit on its own page, and the Info tab also on the terms and the privacy page */
  protected on(tab: { path: string; also?: string[] }): boolean {
    return [tab.path, ...(tab.also ?? [])].some((path) =>
      this.router.isActive('/settings/' + path, { paths: 'subset', queryParams: 'ignored', fragment: 'ignored', matrixParams: 'ignored' }),
    );
  }

  protected readonly tabs = [
    { path: 'profile', label: 'Profile' },
    { path: 'preferences', label: 'Preferences' },
    { path: 'notifications', label: 'Notifications' },
    { path: 'install', label: 'Install', browserOnly: true },
    { path: 'about', label: 'Info', also: ['terms', 'privacy'] },
  ];
}
