import { Component, OnDestroy, OnInit, inject, output, signal } from '@angular/core';
import { UiPreferencesService } from '../core/ui-preferences';
import { MAX_AUDIO_SECONDS, audioRecorderOptions, audioRecorderType } from '../core/audio';


/** The app runs installed on an Android phone (not as a tab of the browser). */
const installedOnAndroid = (): boolean =>
  /Android/i.test(navigator.userAgent) && (matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);

/** What the browser says about the microphone permission: "granted", "denied" (blocked) or "prompt" (not asked yet, or not answered); null = it cannot say. */
async function micPermission(): Promise<string | null> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return null;
  }
}

/** What went wrong with the microphone, in words for the person. `permission` is what the browser says about the permission. */
export function micProblem(err: unknown, permission: string | null = null): string {
  switch ((err as { name?: string }).name) {
    case 'NotAllowedError':
    case 'SecurityError':
      if (permission === 'denied') {
        return installedOnAndroid()
          ? 'The microphone is blocked for this app. Open your phone\'s Settings, then Apps, Seven Friends, Permissions, Microphone, and choose Allow. Then come back and try again.'
          : 'The microphone is blocked. Allow it for this site in the browser settings, or choose a file instead.';
      }
      // not blocked for good: the question was dismissed, or Android itself is not letting the browser use the microphone
      return installedOnAndroid()
        ? 'The microphone was not allowed. Tap Record again and choose Allow. If no question appears: Settings, Apps, Seven Friends, Permissions, Microphone, Allow.'
        : 'The microphone was not allowed. Tap Record again and choose Allow when the browser asks, or choose a file instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found. Choose a file instead.';
    case 'NotReadableError':
      return 'The microphone is in use by another program. Close it and try again, or choose a file instead.';
    default:
      return 'The microphone could not be started. Choose a file instead.';
  }
}

/** The same, with the permission looked up first. */
export const micMessage = async (err: unknown): Promise<string> => micProblem(err, await micPermission());

/**
 * The voice recorder, on the page (`getUserMedia`, on computers and phones alike): Start, Stop, the time, the name of the
 * microphone in use, whether it is muted (the browser says so when Windows or the driver mutes it), and a level bar that moves with the voice, so it is seen that the microphone works. **If nothing at
 * all was heard while recording, the recording is not kept**: it says so and offers another microphone (a computer often
 * has several, and the default one may be muted or not the one that is plugged in). It records straight into a small file
 * (32 kbit/s) and stops by itself after 2 minutes. The microphone is released when this is removed from the page.
 *
 * The microphone is first opened with the browser's own sound filters (echo cancelling, noise cutting, automatic gain). Some
 * microphones (the "Microphone Array" of Realtek on Windows, for one) give only silence with them on: when a recording is
 * silent the microphone is opened again **without the filters** and the person records again; that choice is remembered.
 */
@Component({
  selector: 'app-voice',
  templateUrl: './voice.html',
})
export class Voice implements OnInit, OnDestroy {
  readonly recorded = output<{ blob: Blob; durationMs: number }>();
  readonly closed = output<void>();
  readonly failed = output<string>();

  protected readonly recording = signal(false);
  protected readonly ready = signal(false);
  protected readonly seconds = signal(0);
  protected readonly level = signal(0);
  /** the name of the microphone in use, and how many there are (to offer another one) */
  protected readonly micName = signal('');
  protected readonly microphones = signal<MediaDeviceInfo[]>([]);
  /** the browser reports the microphone as muted (by Windows, the driver, a mute key or a privacy setting): nothing can be heard until it is unmuted */
  protected readonly muted = signal(false);
  /** the last recording had no sound at all */
  protected readonly silent = signal(false);
  /** nothing was heard with the filters on: the microphone was opened again without them, record again */
  protected readonly retried = signal(false);
  protected readonly maxSeconds = MAX_AUDIO_SECONDS;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private recorder: MediaRecorder | null = null;
  private startedAt = 0;
  private clock: ReturnType<typeof setInterval> | undefined;
  private frame = 0;
  /** the loudest moment of the recording (0 to 1) */
  private peak = 0;
  private micIndex = 0;
  private deviceId: string | null = null;
  /** the microphone is opened without the filters of the browser */
  private readonly prefs = inject(UiPreferencesService);
  private raw = this.prefs.get('micRaw');

  async ngOnInit(): Promise<void> {
    try {
      await this.open(null);
      // the names of the microphones are only known once the person has allowed one
      this.microphones.set((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications'));
      this.ready.set(true);
    } catch (err) {
      void micMessage(err).then((message) => this.failed.emit(message));
    }
  }

  /** Opens the microphone (the default one, or the one with this id) and starts the level bar. The browser's own settings are used (no special sound options). */
  private async open(deviceId: string | null): Promise<void> {
    this.release();
    this.deviceId = deviceId;
    const filters = this.raw ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : {};
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { ...filters, deviceId: { exact: deviceId } } : this.raw ? filters : true });
    const track = this.stream.getAudioTracks()[0];
    this.micName.set(track?.label ?? '');
    this.muted.set(Boolean(track?.muted)); // and it is followed: the person can unmute while this page is open
    if (track) {
      track.onmute = () => this.muted.set(true);
      track.onunmute = () => this.muted.set(false);
    }
    this.listen(this.stream);
  }

  /** The next microphone of the computer. */
  protected async nextMicrophone(): Promise<void> {
    const all = this.microphones();
    if (all.length < 2 || this.recording()) return;
    this.micIndex = (this.micIndex + 1) % all.length;
    this.silent.set(false);
    try {
      await this.open(all[this.micIndex].deviceId);
    } catch (err) {
      void micMessage(err).then((message) => this.failed.emit(message));
    }
  }

  /** The level bar: how loud it is now (and the loudest moment while recording). */
  private listen(stream: MediaStream): void {
    if (typeof AudioContext === 'undefined') return;
    this.context = new AudioContext();
    void this.context.resume();
    const meter = this.context.createAnalyser();
    this.context.createMediaStreamSource(stream).connect(meter);
    const samples = new Uint8Array(meter.fftSize);
    const draw = () => {
      meter.getByteTimeDomainData(samples);
      let loud = 0;
      for (const v of samples) loud = Math.max(loud, Math.abs(v - 128));
      this.level.set(Math.min(1, loud / 64));
      if (this.recording()) this.peak = Math.max(this.peak, loud / 128);
      this.frame = requestAnimationFrame(draw);
    };
    draw();
  }

  protected format(seconds: number): string {
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected start(): void {
    const type = audioRecorderType();
    if (!this.stream || !type) {
      this.failed.emit('This browser cannot record audio. Choose a file instead.');
      return;
    }
    const chunks: Blob[] = [];
    this.recorder = new MediaRecorder(this.stream, audioRecorderOptions(type));
    this.recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    this.recorder.onstop = () => {
      clearInterval(this.clock);
      this.recording.set(false);
      if (this.context && this.peak < 0.01) {
        // nothing was heard: not kept. First the microphone is opened again without the filters of the browser, and the person records again
        if (!this.raw) {
          this.raw = true;
          this.prefs.set('micRaw', true); // remembered for the next recordings
          this.retried.set(true);
          void this.open(this.deviceId).catch((err) => micMessage(err).then((message) => this.failed.emit(message)));
        } else {
          this.silent.set(true);
        }
        return;
      }
      this.recorded.emit({ blob: new Blob(chunks, { type }), durationMs: Math.min(Date.now() - this.startedAt, MAX_AUDIO_SECONDS * 1000) });
    };
    this.startedAt = Date.now();
    this.seconds.set(0);
    this.peak = 0;
    this.silent.set(false);
    this.retried.set(false);
    this.recorder.start(1000);
    this.recording.set(true);
    this.clock = setInterval(() => {
      this.seconds.set(Math.floor((Date.now() - this.startedAt) / 1000));
      if (this.seconds() >= MAX_AUDIO_SECONDS) this.stop(); // the limit
    }, 250);
  }

  protected stop(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    if (this.recorder?.state === 'recording') {
      this.recorder.onstop = null;
      this.recorder.stop();
    }
    this.release();
  }

  /** Lets go of the microphone and the level bar. */
  private release(): void {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close();
    this.context = null;
  }
}
