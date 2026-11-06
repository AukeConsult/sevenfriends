import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { DesktopNoticeService } from '../core/desktop-notice.service';
import { InstallService } from '../core/install.service';
import { NoticesService } from '../core/notices.service';
import { PushService } from '../core/push.service';
import { SOUND_CHOICES, SoundId, SoundService } from '../core/sound.service';
import { UiPreferencesService } from '../core/ui-preferences';

/**
 * The first-time setup, in three short steps: a sound, notifications, done. Home sends a new account here once (and offers it
 * again while it is "skipped"). It only uses what the Settings pages use; every step can be left for later.
 */
@Component({
  selector: 'app-setup',
  templateUrl: './setup.html',
})
export class Setup {
  protected readonly sounds = inject(SoundService);
  protected readonly push = inject(PushService);
  protected readonly desktop = inject(DesktopNoticeService);
  protected readonly install = inject(InstallService);
  private readonly noticeChoices = inject(NoticesService);
  private readonly prefs = inject(UiPreferencesService);
  private readonly router = inject(Router);

  protected readonly step = signal<1 | 2 | 3>(1);
  protected readonly choices = SOUND_CHOICES;
  protected readonly current = computed(() => this.sounds.choices().message);

  /** how notifications can be turned on here: the Android app, an iPhone that has not got the app on the home screen, push, or only pop-ups */
  protected readonly how = computed<'android' | 'ios-first' | 'push' | 'popup'>(() => {
    if (this.install.native) return 'android';
    if (this.install.ios && !this.install.installed()) return 'ios-first';
    return this.push.supported() ? 'push' : 'popup';
  });

  protected readonly busy = signal(false);
  /** notifications are on (a green check) */
  protected readonly on = computed(() => this.how() === 'push' ? this.push.enabled() : this.desktop.wanted());
  protected readonly testResult = signal<string | null>(null);
  protected readonly problem = signal<string | null>(null);

  protected choose(sound: string): void {
    this.sounds.choose('message', sound as SoundId); // it plays, so the choice can be heard
  }

  protected setVolume(percent: string): void {
    this.sounds.setVolume(Number(percent));
  }

  protected next(): void {
    this.sounds.stop();
    this.step.update((step) => (step === 1 ? 2 : 3));
  }

  protected async turnOn(): Promise<void> {
    this.busy.set(true);
    this.problem.set(null);
    try {
      if (this.how() === 'push') {
        await this.push.setEnabled(true);
        this.problem.set(this.push.problem());
      } else {
        const allowed = await this.desktop.setWanted(true);
        if (!allowed) this.problem.set('Notifications are blocked for this site. Allow them in the browser settings (the lock icon at the left of the address), then try again.');
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** The Android app's own notification screen (the phone's notification settings are set there). */
  protected openAndroidScreen(): void {
    (window as unknown as { SevenFriendsAndroid?: { openCheck(): void } }).SevenFriendsAndroid?.openCheck();
  }

  protected async test(): Promise<void> {
    this.busy.set(true);
    this.testResult.set(null);
    try {
      if (this.how() === 'popup') {
        await this.desktop.show({ title: 'Seven Friends', body: 'This is how a notification looks.', id: `test-${Date.now()}`, silent: false, go: '/' }, true);
        this.testResult.set('A test pop-up was shown.');
      } else {
        this.testResult.set(await this.noticeChoices.testPush());
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** "Do it later": Home offers the setup again. */
  protected later(): void {
    this.sounds.stop();
    this.prefs.set('setup', 'skipped');
    void this.router.navigateByUrl('/');
  }

  protected finish(to: string): void {
    this.prefs.set('setup', 'done');
    void this.router.navigateByUrl(to);
  }
}
