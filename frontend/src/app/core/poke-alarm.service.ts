import { Injectable, signal } from '@angular/core';

/** A poke that is ringing in this page. */
export interface PokeRinging {
  id: string;
  name: string;
  text: string;
  url: string;
}

/** How long the alarm of the page rings if nobody stops it, in milliseconds. */
const RING_MS = 30_000;

/**
 * The alarm of a poke in a BROWSER page (a computer, or an installed web app): a band at the top of the page (`app-poke-alarm`) with the sender's name and a sound that
 * repeats until Stop, Open, or 30 seconds. The Android app and the Windows app ring natively (see docs/design/poke-alarm.md); this is for the browser, which is also a device
 * of the person: when a PC has both the Windows app and a browser open, both ring (the server cannot tell which browser is on the same PC as the app, so one is not removed).
 * A browser may keep the sound silent until the person has touched the page once; the band and the notification (which stays until it is clicked) still tell.
 */
@Injectable({ providedIn: 'root' })
export class PokeAlarmService {
  readonly ringing = signal<PokeRinging | null>(null);
  private context: AudioContext | null = null;
  private beepTimer: ReturnType<typeof setInterval> | undefined;
  private stopTimer: ReturnType<typeof setTimeout> | undefined;

  /** A poke arrived: show the band and start the sound (a second poke while one rings replaces the text and keeps ringing). */
  ring(poke: PokeRinging): void {
    this.ringing.set(poke);
    clearTimeout(this.stopTimer);
    this.stopTimer = setTimeout(() => this.stop(), RING_MS);
    if (this.beepTimer === undefined) {
      this.beep();
      this.beepTimer = setInterval(() => this.beep(), 1200);
    }
  }

  stop(): void {
    clearInterval(this.beepTimer);
    clearTimeout(this.stopTimer);
    this.beepTimer = undefined;
    this.ringing.set(null);
  }

  /** Two quick tones, like an alarm clock. Never throws (a browser may refuse sound before the first touch). */
  private beep(): void {
    try {
      this.context ??= new AudioContext();
      void this.context.resume();
      const start = this.context.currentTime;
      for (const [offset, frequency] of [[0, 880], [0.25, 1175]] as const) {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = 'square';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.25, start + offset);
        gain.gain.setValueAtTime(0, start + offset + 0.2);
        oscillator.connect(gain).connect(this.context.destination);
        oscillator.start(start + offset);
        oscillator.stop(start + offset + 0.22);
      }
    } catch {
      /* no sound: the band still shows */
    }
  }
}
