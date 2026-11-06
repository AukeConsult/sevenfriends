import { Component, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DesktopNoticeService } from '../core/desktop-notice.service';
import { NoticePreferences } from '../models';
import { NoticesService } from '../core/notices.service';
import { PushService } from '../core/push.service';
import { SOUND_CHOICES, SOUND_EVENTS, SoundEvent, SoundService } from '../core/sound.service';

/** A full page for the person's own settings: for now, which sound plays for what. */
@Component({
  selector: 'app-settings',
  imports: [RouterLink],
  templateUrl: './settings.html',
})
export class Settings {
  protected readonly sounds = inject(SoundService);
  protected readonly desktop = inject(DesktopNoticeService);
  protected readonly push = inject(PushService);
  private readonly api = inject(ApiService);
  protected readonly noticeProblem = signal<string | null>(null);

  /** Which pushes I get and what they show: saved on the account, so it holds for every device. null = still loading. */
  private readonly noticeChoices = inject(NoticesService);
  protected readonly notices = this.noticeChoices.notices;
  protected readonly noticesProblem = this.noticeChoices.problem;
  /** what the test notification did (shown under its button) */
  protected readonly testResult = signal<string | null>(null);
  protected readonly testing = signal(false);
  protected readonly kinds: { key: 'message' | 'request' | 'answer' | 'removed'; label: string }[] = [
    { key: 'message', label: 'New messages' },
    { key: 'request', label: 'Friend requests' },
    { key: 'answer', label: 'Answers to my requests' },
    { key: 'removed', label: 'A friend removed the friendship' },
  ];
  /** inside the Android app: the browser-only parts of this page (pop-ups, browser help) are hidden */
  protected readonly native = Capacitor.isNativePlatform();

  constructor() {
    this.sounds.markDefined(); // the person has now seen the sound settings
    void this.noticeChoices.load();
  }

  protected readonly events = SOUND_EVENTS;
  private readonly choices = SOUND_CHOICES;
  protected readonly jingles = this.sounds.jingles;

  /** The name of the sound chosen for an event. */
  protected soundLabel(event: SoundEvent): string {
    const id = this.sounds.choices()[event];
    if (id.startsWith('file:')) return this.jingles().find((j) => `file:${j.file}` === id)?.label ?? id.slice(5);
    return this.choices.find((c) => c.id === id)?.label ?? id;
  }

  protected async setPush(on: boolean, input: HTMLInputElement): Promise<void> {
    const enabled = await this.push.setEnabled(on);
    input.checked = enabled; // the switch shows what really happened
  }

  protected async setDesktop(on: boolean): Promise<void> {
    this.noticeProblem.set(null);
    const allowed = await this.desktop.setWanted(on);
    if (on && !allowed) {
      this.noticeProblem.set(
        this.desktop.supported
          ? 'Notifications are blocked for this site. Allow them in the browser settings (the lock or sliders icon at the left of the address), then try again.'
          : 'This browser cannot show desktop notifications.',
      );
    }
  }

  /** The notification screen of the Android app (NativeCheck.java): the notification settings of the phone are set there. */
  protected openAndroidScreen(): void {
    (window as unknown as { SevenFriendsAndroid?: { openCheck(): void } }).SevenFriendsAndroid?.openCheck();
  }

  /** One switch: shown at once, saved on the account; if saving fails the switch goes back. */
  protected async setNotice(key: keyof NoticePreferences, on: boolean): Promise<void> {
    const before = this.notices();
    if (before) await this.noticeChoices.save({ ...before, [key]: on });
  }

  /** Sends a real push to all my devices through the server, and says how many it reached. */
  protected async testPush(): Promise<void> {
    this.testing.set(true);
    this.testResult.set(null);
    this.testResult.set(await this.noticeChoices.testPush());
    this.testing.set(false);
  }

  protected async testNotice(): Promise<void> {
    if (!this.desktop.wanted()) {
      await this.setDesktop(true);
      if (!this.desktop.wanted()) return; // not allowed: the reason is shown
    }
    await this.desktop.show(
      { title: 'Seven Friends', body: 'This is how a notification looks.', id: `test-${Date.now()}`, silent: false, go: '/sound-and-notifications' },
      true,
    );
  }

  protected setVolume(percent: string): void {
    this.sounds.setVolume(Number(percent));
  }

  protected tryOut(event: SoundEvent): void {
    this.sounds.toggle(event, this.sounds.choices()[event]);
  }
}
