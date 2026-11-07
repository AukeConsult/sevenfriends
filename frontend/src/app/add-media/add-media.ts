import { Capacitor } from '@capacitor/core';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Camera } from '../camera/camera';
import { MAX_AUDIO_SECONDS, PreparedAudio, audioRecorderType, prepareAudioFile, prepareRecordedAudio } from '../core/audio';
import { ChatService } from '../core/chat.service';
import { Clearable } from '../core/clearable';
import { MAX_IMAGE_BYTES, PreparedImage, formatBytes, prepareImage, rotateImage } from '../core/image';
import { MediaService } from '../core/media.service';
import { MAX_VIDEO_SECONDS, PreparedVideo, prepareRecorded, prepareVideo, recorderType } from '../core/video';
import { MediaUpload } from '../models';
import { Voice } from '../voice/voice';

type Prepared = PreparedImage | PreparedVideo | PreparedAudio;

/** The words of each kind: the title, the buttons and what is said when the chosen file is not of the kind. */
const TEXT = {
  image: { title: 'Send an image', recording: 'Take a photo', take: 'Take a photo', choose: 'Choose an image', another: 'Take or choose another', wrong: 'Choose an image file (a photo).' },
  video: { title: 'Send a video', recording: 'Record a video', take: 'Record a video', choose: 'Choose a video', another: 'Record or choose another', wrong: 'Choose a video file.' },
  audio: { title: 'Send a voice message', recording: 'Record a voice message', take: 'Record a voice message', choose: 'Choose an audio file', another: 'Record or choose another', wrong: 'Choose an audio file.' },
};

/**
 * A full page to send an image, a video or a voice message to a friend (`/friends/:id/image`, `/video` and `/audio`): take or
 * record it, or choose a file, see (or hear) it, add a text if you like, and Send. The file is made smaller in the browser
 * (an image to 1024 pixels and about 200 KB, a video to 1280 pixels, about 1.2 Mbit/s and at most 1 minute; a voice is recorded at 32 kbit/s,
 * at most 2 minutes, and a chosen audio file is sent as it is, at most 2 minutes and 25 MB). It and its name go to the server,
 * which stores it in the media cache; the message then carries the reference, and the conversation reads the file back from
 * the server.
 *
 * The camera works the same on every device, in two ways:
 *  - a phone or tablet (Android, iPhone, iPad): the file chooser with `capture` opens the camera app;
 *  - a computer (Windows, Linux, Mac, also with a touch screen): the browsers ignore `capture` there, so the camera is shown on this page (`app-camera`).
 * A voice is always recorded on this page (`app-voice`), phones too: the file chooser of a phone cannot record audio everywhere.
 */
@Component({
  selector: 'app-add-media',
  imports: [RouterLink, Clearable, Camera, Voice],
  templateUrl: './add-media.html',
})
export class AddMedia implements OnDestroy {
  private readonly media = inject(MediaService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly kind: 'image' | 'video' | 'audio' = this.route.snapshot.data['kind'];
  protected readonly text = TEXT[this.kind];
  protected readonly maxSeconds = MAX_VIDEO_SECONDS;
  protected readonly maxMinutes = MAX_AUDIO_SECONDS / 60;
  protected readonly file = signal<Prepared | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly caption = signal('');
  /** what is being done now ("Preparing the video…", "Sending…"), or null */
  protected readonly working = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly formatBytes = formatBytes;
  protected readonly durationMs = computed(() => (this.file() as { durationMs?: number } | null)?.durationMs ?? null);
  protected readonly trimmed = computed(() => (this.file() as PreparedVideo | null)?.trimmed ?? false);

  /**
   * a phone or tablet (Android, iPhone, iPad): the camera app of the phone is used (a file chooser with `capture`; not for audio).
   * It is found from the system, NOT from a touch screen: a Windows laptop with a touch screen has one too, and there `capture` is
   * ignored, so "Record a video" would only open the file chooser. Everything else shows the camera on the page.
   */
  protected readonly phoneCamera = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS says it is a Mac
  /**
   * A photo in the Android app is taken with the camera ON THE PAGE, not with the phone's camera app: while that app is in front, Android
   * may close this app's page to save memory (a selfie in high resolution), and the person lands on the start page without the photo.
   * The page camera also gives a small picture at once, which is much faster than the full-size photo of the camera app.
   */
  private readonly appPhoto = Capacitor.isNativePlatform() && this.kind === 'image';
  /**
   * A video in the Android app is filmed on the page too, small (960 x 540, at most one minute): the camera app of the phone films in full
   * quality (1080p or 4K, a huge file) while this page waits in the background, where Android may close it, and the big file would then
   * have to be made smaller in the page, which needs a lot of memory.
   */
  private readonly appVideo = Capacitor.isNativePlatform() && this.kind === 'video';
  protected readonly nativeCapture = this.phoneCamera && this.kind !== 'audio' && !this.appPhoto && !this.appVideo;
  /** the browser can show the camera, or take the voice, on the page (needs https or localhost), and for a video or voice, record it */
  protected readonly pageCamera =
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    (this.kind === 'audio' ? audioRecorderType() !== null : (!this.phoneCamera || this.appPhoto || this.appVideo) && (this.kind === 'image' || recorderType() !== null));
  protected readonly cameraOpen = signal(false);

  /** the upload that worked, when sending the message did not: the next try does not upload again */
  private stored: MediaUpload | null = null;

  protected onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const chosen = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    return chosen ? this.use(chosen) : Promise.resolve();
  }

  /** A chosen, photographed or filmed file becomes what is sent. */
  private async use(file: File): Promise<void> {
    this.error.set(null);
    if (!file.type.startsWith(`${this.kind}/`)) {
      this.error.set(this.text.wrong);
      return;
    }
    if (file.type === 'image/gif' && file.size > MAX_IMAGE_BYTES) {
      this.error.set('That GIF is too big. Choose one under 10 MB.');
      return;
    }
    this.working.set(this.kind === 'video' ? 'Preparing the video… keep this page open' : 'Preparing…');
    try {
      this.show(
        this.kind === 'image'
          ? await prepareImage(file)
          : this.kind === 'audio'
            ? await prepareAudioFile(file)
            : await prepareVideo(file, (done) => this.working.set(`Preparing the video… ${Math.round(done * 100)} % (keep this page open)`)),
      );
    } catch (err: any) {
      this.error.set(this.kind === 'image' ? 'This image could not be prepared (it may be too big for the memory of this phone). Close other apps and try again, take the photo at a lower resolution, or choose another one (JPEG, PNG, WebP or GIF).' : err.message ?? 'This file cannot be opened. Try another one.');
    } finally {
      this.working.set(null);
    }
  }

  private show(file: Prepared): void {
    this.clearPreview();
    this.preview.set(URL.createObjectURL(file.blob));
    this.file.set(file);
    this.stored = null;
  }

  /** The line under the preview: name, size in pixels (not for audio), length and bytes. */
  protected details(file: Prepared): string {
    const parts = [file.name];
    if ('width' in file) parts.push(`${file.width} × ${file.height}`);
    if ('durationMs' in file && file.durationMs) parts.push(`${Math.round(file.durationMs / 1000)} s`);
    parts.push(formatBytes(file.blob.size));
    return parts.join(' · ');
  }

  // ------------------------------------------------------------------ the camera or the voice on this page

  protected cameraFailed(message: string): void {
    this.cameraOpen.set(false);
    this.error.set(message);
  }

  protected async photoTaken(photo: File): Promise<void> {
    this.cameraOpen.set(false);
    await this.use(photo);
  }

  protected async filmed(film: { blob: Blob; durationMs: number }): Promise<void> {
    this.cameraOpen.set(false);
    this.error.set(null);
    this.working.set('Preparing the video…');
    try {
      this.show(await prepareRecorded(film.blob, film.durationMs));
    } catch (err: any) {
      this.error.set(err.message ?? 'The video could not be saved. Try again.');
    } finally {
      this.working.set(null);
    }
  }

  protected voiceRecorded(voice: { blob: Blob; durationMs: number }): void {
    this.cameraOpen.set(false);
    this.error.set(null);
    this.show(prepareRecordedAudio(voice.blob, voice.durationMs));
  }

  // ------------------------------------------------------------------ sending

  /** A picture can be turned a quarter turn before it is sent (not a GIF: it would stop moving). */
  protected readonly canRotate = computed(() => this.kind === 'image' && !!this.file() && (this.file() as PreparedImage).blob.type !== 'image/gif');

  protected async rotate(clockwise: boolean): Promise<void> {
    const file = this.file();
    if (!file || this.working() || this.kind !== 'image') return;
    this.working.set('Turning…');
    this.error.set(null);
    try {
      this.show(await rotateImage(file as PreparedImage, clockwise));
    } catch (err: any) {
      this.error.set(err.message ?? 'The image could not be turned');
    } finally {
      this.working.set(null);
    }
  }

  /** Back to the start: take or choose another. */
  protected startAgain(): void {
    this.clearPreview();
    this.preview.set(null);
    this.file.set(null);
    this.error.set(null);
    this.stored = null;
  }

  protected async send(): Promise<void> {
    const file = this.file();
    if (!file || this.working()) return;
    this.working.set('Sending…');
    this.error.set(null);
    try {
      const progress = (done: number, total: number) => this.working.set(`Sending… ${done} of ${total}`);
      this.stored ??=
        this.kind === 'image' ? await this.media.uploadImage(file as PreparedImage, progress) : this.kind === 'audio' ? await this.media.uploadAudio(file as PreparedAudio, progress) : await this.media.uploadVideo(file as PreparedVideo, progress);
      this.working.set('Sending…');
      const size = 'width' in file ? { width: file.width, height: file.height } : {};
      await this.chat.send(this.friendId, this.caption().trim(), { objectId: this.stored.objectId, ...size, durationMs: this.durationMs() ?? undefined });
      await this.router.navigate(['/friends', this.friendId]); // the conversation loads the message, and the file, from the server
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send it');
    } finally {
      this.working.set(null);
    }
  }

  ngOnDestroy(): void {
    this.clearPreview();
  }

  private clearPreview(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
  }
}
