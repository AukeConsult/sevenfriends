import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Preferences, SoundPreferences } from '../models';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { LiveChanges } from './live-changes';
import { tr } from './i18n';

/** What can make a sound. */
export type SoundEvent = 'message' | 'request' | 'answer';

/** A built-in sound ('none' = silent). */
export type BuiltInSoundId = 'none' | 'ding' | 'chime' | 'bell' | 'pop' | 'marimba' | 'soft';

/** One of the sounds to choose from: a built-in one, or a jingle file from `public/sounds` (`file:<file name>`). */
export type SoundId = BuiltInSoundId | `file:${string}`;

/** A music jingle: an audio file in `frontend/public/sounds/` (listed in sounds.json by scripts/sounds-manifest.mjs). */
export interface Jingle {
  file: string;
  label: string;
}

interface Tune {
  label: string;
  wave: OscillatorType;
  /** [frequency in Hz, start in seconds] */
  notes: [number, number][];
  /** how long each note rings, in seconds */
  ring: number;
}

/** The sounds, all made in the browser (Web Audio API, no sound files). */
export const TUNES: Record<Exclude<BuiltInSoundId, 'none'>, Tune> = {
  ding: { get label() { return tr('core.ding', 'Ding'); }, wave: 'sine', notes: [[880, 0], [1175, 0.12]], ring: 0.22 },
  chime: { get label() { return tr('core.chime', 'Chime'); }, wave: 'sine', notes: [[660, 0], [880, 0.14], [1100, 0.28]], ring: 0.3 },
  bell: { get label() { return tr('core.bell', 'Bell'); }, wave: 'triangle', notes: [[1320, 0], [990, 0.25]], ring: 0.6 },
  pop: { get label() { return tr('core.pop', 'Pop'); }, wave: 'square', notes: [[330, 0]], ring: 0.08 },
  marimba: { get label() { return tr('core.marimba', 'Marimba'); }, wave: 'triangle', notes: [[523, 0], [659, 0.1], [784, 0.2], [1047, 0.3]], ring: 0.25 },
  soft: { get label() { return tr('core.softNote', 'Soft note'); }, wave: 'sine', notes: [[784, 0]], ring: 0.35 },
};

/** The choices in the order they are listed on the Settings page. */
export const SOUND_CHOICES: { id: BuiltInSoundId; label: string }[] = [
  { id: 'none', get label() { return tr('core.noSound', 'No sound'); } },
  ...(Object.entries(TUNES) as [Exclude<BuiltInSoundId, 'none'>, Tune][]).map(([id, t]) => ({ id, get label() { return t.label; } })),
];

const JINGLES_URL = '/sounds/sounds.json';
const JINGLES_FOLDER = '/sounds/';
/** A jingle that is longer than this is stopped. */
const JINGLE_MAX_MS = 20000;
/** How long after the last change the choices are saved on the account (a slider sends many changes). */
const SAVE_DELAY_MS = 600;

export const SOUND_EVENTS: { event: SoundEvent; label: string; hint: string }[] = [
  { event: 'message', get label() { return tr('core.newMessage', 'New message'); }, get hint() { return tr('core.aFriendWroteTo', 'A friend wrote to you'); } },
  { event: 'request', get label() { return tr('core.friendRequest', 'Friend request'); }, get hint() { return tr('core.somebodyWantsToBe', 'Somebody wants to be your friend'); } },
  { event: 'answer', get label() { return tr('core.answerToYourRequest', 'Answer to your request'); }, get hint() { return tr('core.aFriendConfirmedOr', 'A friend confirmed or rejected your request'); } },
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
 * The choices belong to the ACCOUNT (`PUT /preferences/sounds`), so they follow the person to every device: they are
 * loaded when somebody signs in and saved a moment after every change, and kept in localStorage only as a copy for a
 * quick start. At sign-out the copy is cleared, so the next person on the device starts with the defaults.
 * Only works while the app is open.
 */
@Injectable({ providedIn: 'root' })
export class SoundService {
  /** The sound chosen for each event. */
  readonly choices = signal<Record<SoundEvent, SoundId>>(this.read());

  /** The music jingles that were dropped in `public/sounds` (empty when there are none). */
  readonly jingles = signal<Jingle[]>([]);

  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly live = inject(LiveChanges);

  /** true once the person has chosen their sounds (or looked at the Settings page) */
  readonly defined = signal(this.hasSaved());

  /** How loud the sounds are, 0-100. */
  readonly volume = signal(this.readVolume());

  private context: AudioContext | null = null;
  private jingle: HTMLAudioElement | null = null;
  private oscillators: OscillatorNode[] = [];
  /** The volume knob of the built-in sound that is playing: moving the slider changes it while it plays. */
  private master: GainNode | null = null;
  private endTimer: ReturnType<typeof setTimeout> | undefined;
  /** the sound that is playing announces an event (not a try-out on the Settings page): any touch stops it */
  private alerting = false;

  /** Which tune is playing on the Settings page right now (the key it was started with), or null. */
  readonly playingKey = signal<string | null>(null);
  private jingleTimer: ReturnType<typeof setTimeout> | undefined;
  private accountUid: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // another device of mine saved other sounds
    this.live.on('sounds').pipe(takeUntilDestroyed()).subscribe(() => void this.reloadFromAccount());
    const unlock = () => this.unlock();
    // the first tap or key press makes sound allowed
    document.addEventListener('pointerdown', unlock, { once: true, capture: true });
    document.addEventListener('keydown', unlock, { once: true, capture: true });
    // a sound that announces something (a message, a request) stops at the first touch, key press or when the app is brought to the front
    const quiet = () => this.alerting && this.stop();
    for (const type of ['pointerdown', 'touchstart', 'keydown', 'wheel']) document.addEventListener(type, quiet, { capture: true, passive: true });
    document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && quiet());
    window.addEventListener('focus', quiet);
    void this.loadJingles();

    // a change that is waiting to be saved is not lost when the page is hidden or closed
    const onHide = () => {
      if (this.saveTimer && this.accountUid) {
        clearTimeout(this.saveTimer);
        this.saveTimer = undefined;
        void this.saveNow(true);
      }
    };
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && onHide());
    window.addEventListener('pagehide', onHide);

    // follow the login: load this person's sounds, and clear them again at sign-out
    effect(() => {
      const uid = this.auth.user()?.uid ?? null;
      untracked(() => void this.follow(uid));
    });
  }

  private async follow(uid: string | null): Promise<void> {
    if (uid === this.accountUid) return;
    const previous = this.accountUid;
    this.accountUid = uid;
    clearTimeout(this.saveTimer);
    if (!uid) {
      if (previous) this.reset(); // signed out: the next person starts with the defaults
      return;
    }
    try {
      const { sounds } = await this.api.request<Preferences>('/preferences');
      if (this.accountUid !== uid) return; // somebody else signed in while it loaded
      if (sounds) this.apply(sounds);
      else if (this.defined()) await this.saveNow(); // first time after the account got sounds: this device's choices become the account's
    } catch {
      /* offline: the choices on this device are used until the next change */
    }
  }

  /** Another device of mine saved other sounds: take them (unless I am changing something right now). */
  async reloadFromAccount(): Promise<void> {
    const uid = this.accountUid;
    if (!uid || this.saveTimer) return;
    try {
      const { sounds } = await this.api.request<Preferences>('/preferences');
      if (this.accountUid === uid && !this.saveTimer && sounds) this.apply(sounds);
    } catch {
      /* offline: keep the sounds of this device */
    }
  }

  /** The sounds of the account are now the sounds in use (and the copy on this device). */
  private apply(sounds: SoundPreferences): void {
    this.choices.set({ message: sounds.message as SoundId, request: sounds.request as SoundId, answer: sounds.answer as SoundId });
    this.volume.set(sounds.volume);
    this.defined.set(true);
    this.writeLocal();
  }

  private reset(): void {
    this.choices.set({ ...DEFAULTS });
    this.volume.set(DEFAULT_VOLUME);
    this.defined.set(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(VOLUME_KEY);
    } catch {
      /* nothing to clear */
    }
  }

  private writeLocal(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.choices()));
      localStorage.setItem(VOLUME_KEY, String(this.volume()));
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
  }

  /** A change: keep the copy on this device now, and save it on the account in a moment. */
  private changed(): void {
    this.defined.set(true);
    this.writeLocal();
    if (!this.accountUid) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.saveNow();
    }, SAVE_DELAY_MS);
  }

  private async saveNow(keepalive = false): Promise<void> {
    if (!this.accountUid) return;
    const { message, request, answer } = this.choices();
    try {
      await this.api.request<Preferences>('/preferences/sounds', {
        method: 'PUT',
        body: JSON.stringify({ message, request, answer, volume: this.volume() }),
        keepalive,
      });
    } catch {
      /* not saved: the next change tries again, and this device keeps working with its copy */
    }
  }

  /**
   * Reads the list of jingles (written by scripts/sounds-manifest.mjs). No list, or no network: just no jingles.
   * Also called by the sound picker, so a jingle that was added after the app was opened shows up without a restart. The list is only
   * replaced when it changed, so nothing on the page flickers.
   */
  async loadJingles(): Promise<void> {
    try {
      const response = await fetch(JINGLES_URL, { cache: 'no-cache' });
      if (!response.ok) return;
      const list = (await response.json()) as { jingles?: Jingle[] };
      const jingles = (list.jingles ?? []).filter((j) => typeof j.file === 'string' && typeof j.label === 'string');
      if (JSON.stringify(jingles) !== JSON.stringify(this.jingles())) this.jingles.set(jingles);
    } catch {
      /* no jingles */
    }
  }

  /** Plays a jingle file at the chosen volume, one at a time, and never longer than JINGLE_MAX_MS. */
  private playJingle(file: string): void {
    this.stopJingle();
    try {
      const audio = new Audio(JINGLES_FOLDER + encodeURIComponent(file));
      audio.volume = this.level(); // the same curve as the built-in sounds
      this.jingle = audio;
      audio.onended = () => { if (this.jingle === audio) this.stop(); };
      void audio.play().catch(() => this.stopJingle()); // blocked until the first tap, or the file is gone
      this.jingleTimer = setTimeout(() => this.stopJingle(), JINGLE_MAX_MS);
    } catch {
      /* no audio on this device */
    }
  }

  private stopJingle(): void {
    clearTimeout(this.jingleTimer);
    this.jingle?.pause();
    this.jingle = null;
    this.playingKey.set(null);
  }

  /** Stops whatever tune is playing (a built-in sound or a jingle). */
  stop(): void {
    this.alerting = false;
    this.stopJingle();
    clearTimeout(this.endTimer);
    for (const oscillator of this.oscillators) {
      try { oscillator.stop(); } catch { /* already ended */ }
    }
    this.oscillators = [];
    this.master = null;
    this.playingKey.set(null);
  }

  /** Play/Stop button of the Settings pages: starts the tune, or stops it when it is the one that is playing. Another tune replaces the first. */
  toggle(key: string, sound: SoundId): void {
    if (this.playingKey() === key) {
      this.stop();
      return;
    }
    this.preview(sound, key);
  }

  choose(event: SoundEvent, sound: SoundId): void {
    this.choices.update((c) => ({ ...c, [event]: sound }));
    this.changed();
  }

  /** The person has seen the sound settings: what is there now (the defaults, if nothing was changed) counts as chosen. */
  markDefined(): void {
    if (!this.defined()) this.changed();
  }

  setVolume(percent: number): void {
    this.volume.set(Math.min(100, Math.max(0, Math.round(percent))));
    if (this.jingle) this.jingle.volume = this.level(); // a tune that is playing follows the slider
    this.master?.gain.setTargetAtTime(this.level(), this.context?.currentTime ?? 0, 0.01);
    this.changed();
  }

  private hasSaved(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** Plays the sound chosen for this event. */
  play(event: SoundEvent): void {
    if (this.start(this.choices()[event])) this.alerting = true; // does not cut off a sound that is already playing
  }

  /** Plays one sound to try it out on the Settings page: it replaces the one that is playing. Never throws. */
  preview(sound: SoundId, key: string | null = null): void {
    this.stop();
    if (this.start(sound)) this.playingKey.set(key);
  }

  /** Starts a sound; true when it plays. */
  private start(sound: SoundId): boolean {
    if (sound === 'none') return false;
    if (sound.startsWith('file:')) {
      this.playJingle(sound.slice('file:'.length));
      return this.jingle !== null;
    }
    try {
      const context = this.unlock();
      if (!context || context.state !== 'running') return false; // no tap on the page yet: the browser would refuse
      const tune = TUNES[sound as Exclude<BuiltInSoundId, 'none'>];
      if (!tune) return false; // a choice that no longer exists
      const peak = MAX_GAIN;
      const master = context.createGain();
      master.gain.value = this.level();
      master.connect(context.destination);
      this.master = master;
      const now = context.currentTime;
      for (const [frequency, start] of tune.notes) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = tune.wave;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(peak, now + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + tune.ring);
        oscillator.connect(gain).connect(master);
        oscillator.start(now + start);
        oscillator.stop(now + start + tune.ring + 0.03);
        this.oscillators.push(oscillator);
      }
      const last = Math.max(...tune.notes.map(([, at]) => at)) + tune.ring + 0.05;
      clearTimeout(this.endTimer);
      this.endTimer = setTimeout(() => this.stop(), last * 1000);
      return true;
    } catch {
      /* no audio on this device: the app works the same without it */
      return false;
    }
  }

  /** The volume as a 0-1 gain, on a curve so the slider feels even. */
  private level(): number {
    return Math.min(1, Math.max(0, (this.volume() / 100) ** 2));
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
      // a jingle choice is kept even before the list of jingles has been read (a deleted file simply stays silent)
      const valid = (id: unknown): id is SoundId =>
        SOUND_CHOICES.some((c) => c.id === id) || (typeof id === 'string' && id.startsWith('file:') && id.length > 'file:'.length);
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
