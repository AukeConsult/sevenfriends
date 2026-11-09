import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { fileExists } from '../core/download';
import { InstallService } from '../core/install.service';

/** What "install" means and how to do it on this device (opened from the Me menu). */
@Component({
  selector: 'app-install-app',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './install-app.html',
  providers: [provideTranslocoScope('installApp')],
})
export class InstallApp implements OnInit {
  protected readonly app = inject(InstallService);
  protected readonly auth = inject(AuthService);
  /** the steps for this device are shown (only when the browser cannot install the app by itself) */
  protected readonly steps = signal(false);

  /** the microphone: allowed (the installed app uses the same permission as the site in the browser, so it is asked for BEFORE installing), blocked, or not asked yet */
  /** the finished apps on this website (frontend/public/downloads, put there by scripts/publish-download.mjs): a download button shows only for a file that is really there */
  protected readonly windowsFile = signal(false);
  protected readonly androidFile = signal(false);

  protected readonly mic = signal<'granted' | 'denied' | 'ask'>('ask');
  /** the install button was tapped before the microphone was allowed: it only says so; a second tap installs anyway */
  protected readonly warned = signal(false);

  async ngOnInit(): Promise<void> {
    if (this.app.windows) void fileExists('/downloads/SevenFriendsSetup.exe').then((found) => this.windowsFile.set(found));
    if (this.app.androidDevice && !this.app.native) void fileExists('/downloads/SevenFriends.apk').then((found) => this.androidFile.set(found));
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      const read = () => this.mic.set(status.state === 'prompt' ? 'ask' : status.state);
      read();
      status.onchange = read;
    } catch {
      /* the browser cannot say: the button just asks */
    }
  }

  /** Asks for the microphone now (from a tap) and lets go of it at once: only the permission is wanted. */
  protected async allowMic(): Promise<void> {
    try {
      (await navigator.mediaDevices.getUserMedia({ audio: true })).getTracks().forEach((track) => track.stop());
      this.mic.set('granted');
    } catch (err) {
      this.mic.set((err as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'ask');
    }
  }

  /** The big button: the browser's own install question when it is ready, otherwise the steps for this device. */
  protected press(): void {
    if (this.mic() === 'ask' && !this.warned()) {
      this.warned.set(true);
      return;
    }
    if (this.app.canInstall()) void this.app.install();
    else this.steps.set(true);
  }
}
