import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject, input, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { RouterLink } from '@angular/router';
import { DesktopNoticeService } from '../core/desktop-notice.service';
import { NoticePreferences } from '../models';
import { NoticesService } from '../core/notices.service';
import { PushService } from '../core/push.service';
import { SOUND_CHOICES, SOUND_EVENTS, SoundEvent, SoundService } from '../core/sound.service';
import { tr } from '../core/i18n';

/**
 * The notification and sound controls, used by Settings → Notifications and by the setup wizard, so both treat every kind of device the same way:
 * the Android app (its own notification screen), a browser on a computer (pop-up while the app is open, push when it is closed, the help for Chrome,
 * Edge, Safari and Windows), an Android phone in a browser (install the app), an iPhone (only from the Home Screen app), and the sounds.
 * In the wizard (`setup`), choosing a sound comes back to the wizard.
 */
@Component({
  selector: 'app-notice-controls',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './notice-controls.html',
  providers: [provideTranslocoScope('noticeControls')],
  host: { class: 'd-flex flex-column', style: 'gap: 0.75rem' }, // the cards and headings have room between them, as on the page around it
})
export class NoticeControls {
  /** shown inside the setup wizard: the sound pages return to it */
  readonly setup = input(false);
  /** which part: everything (Settings), or only the notifications or only the sounds (the two wizard steps) */
  readonly part = input<'all' | 'notifications' | 'sounds'>('all');

  protected readonly sounds = inject(SoundService);
  protected readonly desktop = inject(DesktopNoticeService);
  protected readonly push = inject(PushService);
  protected readonly noticeProblem = signal<string | null>(null);

  /** Which pushes I get and what they show: saved on the account, so it holds for every device. null = still loading. */
  private readonly noticeChoices = inject(NoticesService);
  protected readonly notices = this.noticeChoices.notices;
  protected readonly noticesProblem = this.noticeChoices.problem;
  /** the browser pages of THIS site, where its notifications are allowed again (a web page cannot link to them: the address is copied to paste in a new tab) */
  protected readonly settingsAddresses = [
    { name: 'Chrome', address: `chrome://settings/content/siteDetails?site=${encodeURIComponent(location.origin)}` },
    { name: 'Edge', address: `edge://settings/content/siteDetails?site=${encodeURIComponent(location.origin)}` },
  ];
  protected readonly copiedAddress = signal<string | null>(null);
  protected async copyAddress(address: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(address);
      this.copiedAddress.set(address);
    } catch {
      this.copiedAddress.set(null); // the browser refused: the address is not shown as copied
    }
  }
  protected readonly kinds: { key: 'message' | 'request' | 'answer' | 'removed'; label: string }[] = [
    { key: 'message', label: tr('noticeControls.newMessages', 'New messages') },
    { key: 'request', label: tr('noticeControls.friendRequests', 'Friend requests') },
    { key: 'answer', label: tr('noticeControls.answersToMyRequests', 'Answers to my requests') },
    { key: 'removed', label: tr('noticeControls.aFriendRemovedThe', 'A friend removed the friendship') },
  ];
  /** inside the Android app: the browser-only parts (pop-ups, browser help) are hidden */
  protected readonly native = Capacitor.isNativePlatform();
  /** the device of this browser: each one gets its own explanation of notifications (Android: install the app; iPhone: Home Screen app; Safari on a Mac; else Chrome / Edge on a computer) */
  protected readonly device: 'android' | 'iphone' | 'safari' | 'computer' = /Android/i.test(navigator.userAgent)
    ? 'android'
    : /iPhone|iPad|iPod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
      ? 'iphone'
      : /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg|OPR/i.test(navigator.userAgent)
        ? 'safari'
        : 'computer';

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
          ? tr('noticeControls.notificationsAreBlockedFor2', 'Notifications are blocked for this site. Allow them in the browser settings (the lock or sliders icon at the left of the address), then try again.')
          : tr('noticeControls.thisBrowserCannotShow', 'This browser cannot show desktop notifications.'),
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
      { title: 'Seven Friends', body: tr('noticeControls.thisIsHowA', 'This is how a notification looks.'), id: `test-${Date.now()}`, silent: false, go: this.setup() ? '/setup' : '/settings/notifications' },
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
