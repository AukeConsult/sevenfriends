import { Component, OnInit, inject, signal } from '@angular/core';
import { InstallService } from '../core/install.service';

/** What "install" means and how to do it on this device (opened from the Me menu). */
@Component({
  selector: 'app-install-app',
  imports: [],
  templateUrl: './install-app.html',
})
export class InstallApp implements OnInit {
  protected readonly app = inject(InstallService);
  /** the steps for this device are shown (only when the browser cannot install the app by itself) */
  protected readonly steps = signal(false);

  /** the microphone: allowed (the installed app uses the same permission as the site in the browser, so it is asked for BEFORE installing), blocked, or not asked yet */
  protected readonly mic = signal<'granted' | 'denied' | 'ask'>('ask');
  /** the install button was tapped before the microphone was allowed: it only says so; a second tap installs anyway */
  protected readonly warned = signal(false);

  async ngOnInit(): Promise<void> {
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
