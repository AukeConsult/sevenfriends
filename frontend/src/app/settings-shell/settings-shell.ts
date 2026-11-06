import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { InstallService } from '../core/install.service';

/** The Settings page: one tab for each part (the part itself is the page shown under the tabs). */
@Component({
  selector: 'app-settings-shell',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './settings-shell.html',
})
export class SettingsShell {
  /** `install.native`: the Android app has no "Install the app" page */
  protected readonly install = inject(InstallService);

  protected readonly tabs = [
    { path: 'profile', label: 'Profile' },
    { path: 'preferences', label: 'Preferences' },
    { path: 'sounds', label: 'Sounds' },
    { path: 'notifications', label: 'Notifications' },
    { path: 'install', label: 'Install', browserOnly: true },
    { path: 'privacy', label: 'Privacy' },
    { path: 'terms', label: 'Terms' },
    { path: 'about', label: 'About' },
  ];
}
