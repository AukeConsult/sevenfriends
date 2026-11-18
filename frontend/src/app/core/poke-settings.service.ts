import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

type AndroidBridge = { pokeSeconds?(): number; setPokeSeconds?(seconds: number): void };
type WindowsBridge = { postMessage(message: unknown): void };

/** The choices for how long a poke alarm rings, in seconds (the same as PokeService.RING_CHOICES in the Android app). */
export const POKE_RING_CHOICES = [10, 30, 60, 120, 300];
const DEFAULT_SECONDS = 30;
const KEY = 'sf-poke-seconds';

/**
 * How long a poke rings on THIS device. It is set here (Settings → Notifications) and handed to the app around the page, which rings the alarm when the page is
 * closed or not running: the Android app keeps it in its own storage (`SevenFriendsAndroid.setPokeSeconds`; the same value as the "Poke alarm" card of its own
 * notification screen, which is the one that is read), the Windows app keeps it in a file (`{ type: 'pokeSeconds' }` over the WebView2 bridge). A browser has no
 * alarm, so `available` is false there. There is no way to switch the alarm off, only how long it rings. See docs/design/poke-alarm.md.
 */
@Injectable({ providedIn: 'root' })
export class PokeSettingsService {
  private readonly android = Capacitor.isNativePlatform();
  private readonly windows = /SevenFriendsWindows/i.test(navigator.userAgent);
  /** this device can ring a poke alarm (the Android app and the Windows app) */
  readonly available = this.android || this.windows;
  readonly seconds = signal(DEFAULT_SECONDS);

  constructor() {
    if (!this.available) return;
    this.read();
    setTimeout(() => this.read(), 1500); // the Android bridge is added after the page starts to load
    if (this.windows) this.tell(this.seconds()); // the Windows app is told at every start (it has no way to ask)
  }

  /** What this device has now: from the Android app itself, else what was last chosen here. */
  private read(): void {
    const bridge = (window as unknown as { SevenFriendsAndroid?: AndroidBridge }).SevenFriendsAndroid;
    let value: number | null = null;
    if (this.android && bridge?.pokeSeconds) value = bridge.pokeSeconds();
    else {
      try {
        value = Number(localStorage.getItem(KEY)) || null;
      } catch {
        value = null;
      }
    }
    this.seconds.set(value && POKE_RING_CHOICES.includes(value) ? value : DEFAULT_SECONDS);
  }

  set(seconds: number): void {
    if (!POKE_RING_CHOICES.includes(seconds)) return;
    this.seconds.set(seconds);
    try {
      localStorage.setItem(KEY, String(seconds));
    } catch {
      /* the app keeps its own copy */
    }
    this.tell(seconds);
  }

  private tell(seconds: number): void {
    if (this.android) (window as unknown as { SevenFriendsAndroid?: AndroidBridge }).SevenFriendsAndroid?.setPokeSeconds?.(seconds);
    if (this.windows) (window as unknown as { chrome?: { webview?: WindowsBridge } }).chrome?.webview?.postMessage({ type: 'pokeSeconds', seconds });
  }
}
