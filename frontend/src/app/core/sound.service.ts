import { Injectable, signal } from '@angular/core';

/** What can make a sound. */
export type SoundEvent = 'message' | 'request' | 'answer';

/** One of the sounds to choose from ('none' = silent). */
export type SoundId = 'none' | 'ding' | 'chime' | 'bell' | 'pop' | 'marimba' | 'soft';

interface Tune {
  label: string;
  wave: OscillatorType;
  /** [frequency in Hz, start in seconds] */
  notes: [number, number][];
  /** how long each note rings, in seconds */
  ring: number;
}

/** The sounds, all made in the browser (Web Audio API, no sound files). */
export const TUNES: Record<Exclude<SoundId, 'none'>, Tune> = {
  ding: { label: 'Ding', wave: 'sine', notes: [[880, 0], [1175, 0.12]], ring: 0.22 },
  chime: { label: 'Chime', wave: 'sine', notes: [[660, 0], [880, 0.14], [1100, 0.28]], ring: 0.3 },
  bell: { label: 'Bell', wave: 'triangle', notes: [[1320, 0], [990, 0.25]], ring: 0.6 },
  pop: { label: 'Pop', wave: 'square', notes: [[330, 0]], ring: 0.08 },
  marimba: { label: 'Marimba', wave: 'triangle', notes: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3]], ring: 0.25 },
  soft: { label: 'Soft note', wave: 'sine', notes: [[784, 0]], ring: 0.35 },
};

/** The choices in the order they are listed on the Settings page. */
export const SOUND_CHOICES: { id: SoundId; label: string }[] = [
  { id: 'none', label: 'No sound' },
  ...(Object.entries(TUNES) as [Exclude<SoundId, 'none'>, Tune][]).map(([id, t]) => ({ id, label: t.label })),
];

export const SOUND_EVENTS: { event: SoundEvent; label: string; hint: string }[] = [
  { event: 'message', label: 'New message', hint: 'A friend wrote to you' },
  { event: 'request', label: 'Friend request', hint: 'Somebody wants to be your friend' },
  { event: 'answer', label: 'Answer to your request', hint: 'A friend confirmed or rejected your request' },
];

const DEFAULTS: Record<SoundEvent, SoundId> = { message: 'ding', request: 'chime', answer: 'soft' };
const STORAGE_KEY = 'sf-sounds';
const VOLUME_KEY = 'sf-volume';
/** Volume 0-100 % when nothing was chosen (louder than the first version of the sounds). */
const DEFAULT_VOLUME = 80;
/** The loudest a note gets (at 100 %); the volume is applied on a curve, so the slider feels even. */
const MAX_GAIN = 0.9;

/**
 * The sound when something arrives (a message, a friend request, an answer to my request). Each of the three
 * can have its own sound (or none), chosen on the Settings page. Browsers only allow sound after the person has
 * tapped or clicked the page once, so audio is unlocked at the first tap; before that a sound is silently skipped.
 * The choices are per device (localStorage). Only works while the app is open.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  /** The sound chosen for each event. */
  readonly choices = signal<Record<SoundEvent, SoundId>>(this.read());

  /** true once the person has chosen their sounds (or looked at the Settings page) on this device */
  readonly defined = signal(this.hasSaved());

  /** How loud the sounds are, 0-100 (per device). */
  readonly volume = signal(this.readVolume());

  private context: AudioContext | null = null;

  constructor() {
    const unlock = () => this.unlock();
    // the first tap or key press makes sound allowed
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
  }

  choose(event: SoundEvent, sound: SoundId): void {
    this.choices.update((c) => ({ ...c, [event]: sound }));
    this.save();
  }

  /** The person has seen the sound settings: what is there now (the defaults, if nothing was changed) counts as chosen. */
  markDefined(): void {
    if (!this.defined()) this.save();
  }

  private save(): void {
    this.defined.set(true);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.choices()));
    } catch {
      /* private mode: the choice then lasts until the page is closed */
    }
  }

  private hasSaved(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  setVolume(percent: number): void {
    const value = Math.min(100, Math.max(0, Math.round(percent)));
    this.volume.set(value);
    try {
      localStorage.setItem(VOLUME_KEY, String(value));
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
  }

  /** Plays the sound chosen for this event. */
  play(event: SoundEvent): void {
    this.preview(this.choices()[event]);
  }

  /** Plays one sound (also used to try it out on the Settings page). Never throws. */
  preview(sound: SoundId): void {
    if (sound === 'none') return;
    try {
      const context = this.unlock();
      if (!context || context.state !== 'running') return; // no tap on the page yet: the browser would refuse
      const tune = TUNES[sound];
      const peak = Math.max(0.0002, MAX_GAIN * (this.volume() / 100) ** 2);
      const now = context.currentTime;
      for (const [frequency, start] of tune.notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = tune.wave;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + tune.ring);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + start);
        oscillator.stop(now + start + tune.ring + 0.03);
      }
    } catch {
      /* no audio on this device: the app works the same without it */
    }
  }

  private unlock(): AudioContext | null {
    try {
      this.context ??= new AudioContext();
      if (this.context.state === 'suspended') void this.context.resume();
      return this.context;
    } catch {
      return null;
    }
  }

  private readVolume(): number {
    try {
      const saved = Number(localStorage.getItem(VOLUME_KEY));
      return localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : DEFAULT_VOLUME;
    } catch {
      return DEFAULT_VOLUME;
    }
  }

  private read(): Record<SoundEvent, SoundId> {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<Record<SoundEvent, SoundId>>;
      const valid = (id: unknown): id is SoundId => SOUND_CHOICES.some((c) => c.id === id);
      return {
        message: valid(saved.message) ? saved.message : DEFAULTS.message,
        request: valid(saved.request) ? saved.request : DEFAULTS.request,
        answer: valid(saved.answer) ? saved.answer : DEFAULTS.answer,
      };
    } catch {
      return { ...DEFAULTS };
    }
  }
}
