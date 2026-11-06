import { Component, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { DesktopNoticeService } from '../core/desktop-notice.service';
import { NoticePreferences } from '../models';
import { NoticesService } from '../core/notices.service';
import { PushService } from '../core/push.service';
import { QUICK_LENGTH, QUICK_MAX, UiPreferencesService, quickOf } from '../core/ui-preferences';
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
  /** which page this is (the route says): the preferences, the sounds, or the notifications */
  protected readonly section = inject(ActivatedRoute).snapshot.data['section'] as 'preferences' | 'sounds' | 'notifications';
  protected readonly title = { preferences: 'Preferences', sounds: 'Sounds', notifications: 'Notifications' }[this.section];
  protected readonly prefs = inject(UiPreferencesService);
  protected readonly noticeProblem = signal<string | null>(null);

  /** The ready-made messages being edited (empty rows are allowed while typing; only the filled ones are saved). */
  protected readonly quick = signal<string[]>([...this.prefs.get('quickMessages')]);
  protected readonly quickMax = QUICK_MAX;
  protected readonly quickLength = QUICK_LENGTH;

  protected addQuick(): void {
    if (this.quick().length < QUICK_MAX) this.quick.update((list) => [...list, '']);
  }

  protected setQuick(index: number, value: string): void {
    this.quick.update((list) => list.map((text, i) => (i === index ? value : text)));
    this.saveQuick();
  }

  protected removeQuick(index: number): void {
    this.quick.update((list) => list.filter((_, i) => i !== index));
    this.saveQuick();
  }

  private saveQuick(): void {
    this.prefs.set('quickMessages', quickOf(this.quick()));
  }

  /** Which pushes I get and what they show: saved on the account, so it holds for every device. null = still loading. */
  private readonly noticeChoices = inject(NoticesService);
  protected readonly notices = this.noticeChoices.notices;
  protected readonly noticesProblem = this.noticeChoices.problem;
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

  protected async testNotice(): Promise<void> {
    if (!this.desktop.wanted()) {
      await this.setDesktop(true);
      if (!this.desktop.wanted()) return; // not allowed: the reason is shown
    }
    await this.desktop.show(
      { title: 'Seven Friends', body: 'This is how a notification looks.', id: `test-${Date.now()}`, silent: false, go: '/settings/notifications' },
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
