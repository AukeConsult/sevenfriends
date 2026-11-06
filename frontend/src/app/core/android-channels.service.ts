import { effect, inject, Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { NoticePreferences } from '../models';
import { NoticesService } from './notices.service';
import { PushService } from './push.service';
import { SoundService } from './sound.service';

type AndroidHost = {
  SevenFriendsAndroid?: { sync(sounds: string): void; pushed(ok: boolean, text: string): void; deviceSet(on: boolean, problem: string): void; appState(json: string): void; tested(text: string): void };
  sfAndroid?: { fromAndroid(json: string): void; device(on: boolean): void; read(): void; hideText(on: boolean): void; test(): void };
};

/**
 * Inside the Android app, between the page and the app around it (MainActivity.java, NativeNotices.java, Channels.java).
 *
 * To Android: which sound each kind of notification has, so Android's own notification settings show the same (one channel per kind,
 * with that sound). Android shows a push in the channel the server names from the sound choice, so the channel must exist before the push
 * arrives: this runs at start, whenever the choice changes, and when the app comes back to the front.
 *
 * From Android: the check screen (NativeCheck.java) has a button that sends what Android has for this phone (each kind on or off).
 * It is stored on the account, as a switch on the Settings page is.
 *
 * Also from Android: the switch "Notify this device", "Hide the text" and the test notification of the native notification screen
 * (NativeCheck.java). On the Android app the Settings page only refers to that screen.
 */
@Injectable({ providedIn: 'root' })
export class AndroidChannelsService {
  private readonly sounds = inject(SoundService);
  private readonly notices = inject(NoticesService);
  private readonly push = inject(PushService);

  /** The phone's notification volume in percent, as the Android app last sent it (null = not sent yet). The app's own volume follows it. */
  readonly phoneVolume = signal<number | null>(null);

  constructor() {
    if (!Capacitor.isNativePlatform()) return;
    effect(() => this.tell(JSON.stringify(this.sounds.choices())));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.tell(JSON.stringify(this.sounds.choices()));
    });
    this.host.sfAndroid = {
      fromAndroid: (json) => void this.store(json),
      read: () => void this.readOut(),
      hideText: (on) =>
        void (async () => {
          if (await this.notices.load()) {
            const now = this.notices.notices();
            if (now) await this.notices.save({ ...now, hideText: on });
          }
          await this.readOut(); // the screen shows what is stored now
        })(),
      test: () =>
        void (async () => this.host.SevenFriendsAndroid?.tested(await this.notices.testPush()))(),
      device: (on) =>
        void (async () => {
          await this.push.setEnabled(on);
          this.host.SevenFriendsAndroid?.deviceSet(this.push.enabled(), this.push.problem() ?? '');
        })(),
    };
  }

  private get host(): AndroidHost {
    return window as unknown as AndroidHost;
  }

  private tell(sounds: string): void {
    // the bridge is added after the page starts to load: a call before it is there is simply made again at the next change or return
    this.host.SevenFriendsAndroid?.sync(sounds);
  }

  /** `json`: for each kind, true when Android has it on. The other choices (hide the text) stay as they are on the account. */
  private async store(json: string): Promise<void> {
    const answer = (ok: boolean, text: string) => this.host.SevenFriendsAndroid?.pushed(ok, text);
    try {
      const android = JSON.parse(json) as Partial<NoticePreferences> & { volume?: number };
      if (typeof android.volume === 'number') {
        // on the Android app the volume of the app's sounds follows the phone's notification volume
        this.phoneVolume.set(android.volume);
        this.sounds.setVolume(android.volume);
      }
      if (!(await this.notices.load())) return answer(false, 'The app could not read your choices from the account. Check the connection.');
      const now = this.notices.notices();
      if (!now) return answer(false, 'The app could not read your choices from the account.');
      const next = { ...now };
      for (const kind of ['message', 'request', 'answer', 'removed'] as const) {
        if (typeof android[kind] === 'boolean') next[kind] = android[kind];
      }
      const ok = await this.notices.save(next);
      answer(ok, ok ? 'Stored on your account: ' + this.describe(next) + ` The phone's notification volume is ${this.phoneVolume() ?? '?'} %.` : 'It could not be saved. Check the connection and try again.');
    } catch {
      answer(false, 'The app did not understand what was sent.');
    }
  }

  /**
   * The check screen asks what the app has: this device's push switch, the choices of the account (which kinds, hide the text), the
   * sounds and the volume. The answer is JSON for `SevenFriendsAndroid.appState`; `{"error": ...}` when the account could not be read.
   */
  private async readOut(): Promise<void> {
    const loaded = await this.notices.load();
    const now = this.notices.notices();
    const state = loaded && now
      ? { device: this.push.enabled(), notices: now, sounds: this.sounds.choices(), volume: this.sounds.volume() }
      : { error: 'The account could not be read. Check the connection.' };
    this.host.SevenFriendsAndroid?.appState(JSON.stringify(state));
  }

  private describe(n: NoticePreferences): string {
    return (['message', 'request', 'answer', 'removed'] as const).map((k) => `${k} ${n[k] ? 'on' : 'off'}`).join(', ') + '.';
  }
}
