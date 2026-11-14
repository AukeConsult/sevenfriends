import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InstallService } from '../core/install.service';

/** The front page of Settings: one row for each part; a row opens that part as a page of its own (the routes are the children of `settings`). */
@Component({
  selector: 'app-settings-home',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './settings-home.html',
  providers: [provideTranslocoScope('settingsShell', 'settings')],
})
export class SettingsHome {
  /** `install.native`: the Android app has no "Install the app" page */
  protected readonly install = inject(InstallService);

  protected readonly rows = [
    { path: '/settings/profile', key: 'profile', fallback: 'Profile', icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z', browserOnly: false },
    { path: '/settings/friends', key: 'friends', fallback: 'Friends', icon: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.9M16 3.1a4 4 0 010 7.8', browserOnly: false },
    { path: '/settings/preferences', key: 'preferences', fallback: 'Appearance', icon: 'M12 3a9 9 0 100 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 004-4c0-4.4-4-8-9-8z', browserOnly: false },
    { path: '/settings/notifications', key: 'notifications', fallback: 'Notifications', icon: 'M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0', browserOnly: false },
    { path: '/settings/encryption', key: 'keys', fallback: 'Privacy lock', icon: 'M5 11h14v10H5zM8 11V7a4 4 0 018 0v4', browserOnly: false },
    { path: '/settings/install', key: 'install', fallback: 'Install', icon: 'M12 3v12M7 10l5 5 5-5M5 21h14', browserOnly: true },
    { path: '/settings/about', key: 'info', fallback: 'About and rules', icon: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8h.01', browserOnly: false },
  ];
}
