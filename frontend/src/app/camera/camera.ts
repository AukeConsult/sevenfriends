import { Component, ElementRef, OnDestroy, OnInit, effect, input, output, signal, viewChild } from '@angular/core';
import { MAX_VIDEO_SECONDS, recorderOptions, recorderType } from '../core/video';

/** What went wrong with the camera, in words for the person. */
export function cameraProblem(err: unknown): string {
  switch ((err as { name?: string }).name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The camera is blocked. Allow it for this site in the browser settings, or choose a file instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Choose a file instead.';
    case 'NotReadableError':
      return 'The camera is in use by another program. Close it and try again, or choose a file instead.';
    default:
      return 'The camera could not be started. Choose a file instead.';
  }
}

/**
 * The camera of a computer, on the page (`getUserMedia`; a phone uses the camera app instead, see the add-media page).
 * In `photo` mode there is a shutter; in `video` mode the film is recorded straight into a small file (at most 2 minutes,
 * it stops by itself). The camera is stopped (its light goes out) when this is removed from the page.
 */
@Component({
  selector: 'app-camera',
  templateUrl: './camera.html',
})
export class Camera implements OnInit, OnDestroy {
  readonly mode = input.required<'photo' | 'video'>();
  /** a photo was taken */
  readonly photo = output<File>();
  /** a film was recorded */
  readonly recorded = output<{ blob: Blob; durationMs: number }>();
  /** Cancel was pressed */
  readonly closed = output<void>();
  /** the camera could not be started (the words for the person) */
  readonly failed = output<string>();

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  protected readonly cameras = signal<MediaDeviceInfo[]>([]);
  protected readonly recording = signal(false);
  protected readonly seconds = signal(0);
  protected readonly maxSeconds = MAX_VIDEO_SECONDS;
  private readonly stream = signal<MediaStream | null>(null);
  private cameraIndex = 0;
  private recorder: MediaRecorder | null = null;
  private startedAt = 0;
  private clock: ReturnType<typeof setInterval> | undefined;

  constructor() {
    // the camera picture goes into the video element as soon as both exist
    effect(() => {
      const element = this.video()?.nativeElement;
      const stream = this.stream();
      if (!element || !stream) return;
      // the picture is shown, the sound is NOT played: it would come out of the speakers and be heard again by the microphone (feedback).
      // The `muted` attribute in the template does not set this property on an element Angular creates, so it is set here.
      element.muted = true;
      element.volume = 0;
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      await this.start(null);
      // the names of the cameras are only known once the person has allowed one
      this.cameras.set((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
    } catch (err) {
      this.failed.emit(cameraProblem(err));
    }
  }

  private async start(deviceId: string | null): Promise<void> {
    this.stopStream();
    this.stream.set(
      await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: this.mode() === 'video',
      }),
    );
  }

  /** The next camera of the computer (a laptop often has one, a desk with a webcam and a laptop two). */
  protected async nextCamera(): Promise<void> {
    const cameras = this.cameras();
    if (cameras.length < 2) return;
    this.cameraIndex = (this.cameraIndex + 1) % cameras.length;
    try {
      await this.start(cameras[this.cameraIndex].deviceId);
    } catch (err) {
      this.failed.emit(cameraProblem(err));
    }
  }

  /** The shutter: the picture on the screen now becomes a photo. */
  protected async takePhoto(): Promise<void> {
    const element = this.video()?.nativeElement;
    if (!element?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext('2d')?.drawImage(element, 0, 0); // the photo itself is not mirrored, only the view of it is
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (!blob) {
      this.failed.emit('The photo could not be taken. Try again.');
      return;
    }
    this.photo.emit(new File([blob], `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`, { type: 'image/jpeg' }));
  }

  protected startRecording(): void {
    const stream = this.stream();
    const type = recorderType();
    if (!stream || !type) {
      this.failed.emit('This browser cannot record video. Choose a file instead.');
      return;
    }
    const chunks: Blob[] = [];
    this.recorder = new MediaRecorder(stream, recorderOptions(type));
    this.recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    this.recorder.onstop = () => {
      clearInterval(this.clock);
      this.recording.set(false);
      this.recorded.emit({ blob: new Blob(chunks, { type }), durationMs: Math.min(Date.now() - this.startedAt, MAX_VIDEO_SECONDS * 1000) });
    };
    this.startedAt = Date.now();
    this.seconds.set(0);
    this.recorder.start(1000);
    this.recording.set(true);
    this.clock = setInterval(() => {
      this.seconds.set(Math.floor((Date.now() - this.startedAt) / 1000));
      if (this.seconds() >= MAX_VIDEO_SECONDS) this.stopRecording(); // the limit
    }, 250);
  }

  protected stopRecording(): void {
    if (this.recorder?.state === 'recording') this.recorder.stop();
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
    if (this.recorder) this.recorder.onstop = null; // leaving: nothing is sent
    this.stopStream();
  }

  private stopStream(): void {
    this.stream()?.getTracks().forEach((track) => track.stop()); // the camera light goes out
    this.stream.set(null);
  }
}
