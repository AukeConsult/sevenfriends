import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Capacitor } from '@capacitor/core';
import { FriendContext } from '../friend-page/friend-context';
import { Component, OnDestroy, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Camera } from '../camera/camera';
import { MAX_AUDIO_SECONDS, PreparedAudio, audioRecorderType, prepareAudioFile, prepareRecordedAudio } from '../core/audio';
import { ChatService } from '../core/chat.service';
import { ChatItem } from '../core/message-lock.service';
import { Clearable } from '../core/clearable';
import { MAX_IMAGE_BYTES, PreparedImage, formatBytes, prepareImage, rotateImage } from '../core/image';
import { MediaService } from '../core/media.service';
import { MessageLockService } from '../core/message-lock.service';
import { MAX_VIDEO_SECONDS, PreparedVideo, prepareRecorded, prepareVideo, recorderType } from '../core/video';
import { MediaUpload, MessageEncMedia } from '../models';
import { ApiError } from '../core/api.service';
import { Voice } from '../voice/voice';

type Prepared = PreparedImage | PreparedVideo | PreparedAudio;

/** The words of each kind: the title, the buttons and what is said when the chosen file is not of the kind. */
const textOf = (kind: 'image' | 'video' | 'audio') => ({
  image: { title: tr('core.sendAnImage', 'Send an image'), recording: tr('core.takeAPhoto', 'Take a photo'), take: tr('core.takeAPhoto', 'Take a photo'), choose: tr('core.chooseAnImage', 'Choose an image'), another: tr('core.takeOrChooseAnother', 'Take or choose another'), wrong: tr('core.chooseAnImageFile', 'Choose an image file (a photo).') },
  video: { title: tr('core.sendAVideo', 'Send a video'), recording: tr('core.recordAVideo', 'Record a video'), take: tr('core.recordAVideo', 'Record a video'), choose: tr('core.chooseAVideo', 'Choose a video'), another: tr('core.recordOrChooseAnother', 'Record or choose another'), wrong: tr('core.chooseAVideoFile', 'Choose a video file.') },
  audio: { title: tr('core.sendAVoiceMessage', 'Send a voice message'), recording: tr('core.recordAVoiceMessage', 'Record a voice message'), take: tr('core.recordAVoiceMessage', 'Record a voice message'), choose: tr('core.chooseAnAudioFile', 'Choose an audio file'), another: tr('core.recordOrChooseAnother', 'Record or choose another'), wrong: tr('core.chooseAnAudioFile2', 'Choose an audio file.') },
})[kind];

/**
 * Sends an image, a video or a voice message to a friend. It opens inside the feed, above the message field (`<app-add-media [kind] [friendId]>` in the chat; it tells
 * the chat with `closed` and `sent`), and still works as a full page on the earlier addresses (`/friends/:id/image`, `/video` and `/audio`). Take or
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
  imports: [Clearable, Camera, Voice, TranslocoDirective],
  templateUrl: './add-media.html',
  providers: [provideTranslocoScope('addMedia')],
})
export class AddMedia implements OnInit, OnDestroy {
  private readonly media = inject(MediaService);
  private readonly chat = inject(ChatService);
  private readonly ctx = inject(FriendContext, { optional: true }); // only inside a friend page (the pages of the old routes have none)
  private readonly lock = inject(MessageLockService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  /** given when it is shown inside the feed; without them it is a page and takes both from its address */
  readonly kindIn = input<'image' | 'video' | 'audio' | null>(null, { alias: 'kind' });
  readonly friendIn = input<string | null>(null, { alias: 'friendId' });
  /** hosted by a page that has its own writing frame and Send button (Send a message): the text comes from `caption`, the page calls `send()`, and a ✕ closes the card */
  readonly hosted = input(false);
  readonly captionIn = input('', { alias: 'caption' });
  /** a file is ready to be sent (chosen or recorded, and nothing is being done to it) */
  readonly hasFile = computed(() => !!this.file() && !this.working());
  readonly closed = output<void>();
  readonly sent = output<ChatItem>();
  protected embedded = false;
  protected friendId = '';
  protected kind: 'image' | 'video' | 'audio' = 'image';
  protected text = textOf('image');
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
  private appPhoto = false;
  /**
   * A video in the Android app is filmed on the page too, small (960 x 540, at most one minute): the camera app of the phone films in full
   * quality (1080p or 4K, a huge file) while this page waits in the background, where Android may close it, and the big file would then
   * have to be made smaller in the page, which needs a lot of memory.
   */
  private appVideo = false;
  protected nativeCapture = false;
  /** the browser can show the camera, or take the voice, on the page (needs https or localhost), and for a video or voice, record it */
  protected pageCamera = false;
  protected readonly cameraOpen = signal(false);

  /** the upload that worked, when sending the message did not: the next try does not upload again */
  private stored: MediaUpload | null = null;
  /** the file was locked before it was uploaded: the key of the message and what the message must carry about the locked file (kept with the upload) */
  private sealed: { key: CryptoKey; media: MessageEncMedia } | null = null;

  /** the kind and the friend are known now (an input is not set while the fields are made) */
  ngOnInit(): void {
    this.embedded = this.kindIn() !== null;
    this.kind = this.kindIn() ?? this.route.snapshot.data['kind'];
    this.friendId = this.friendIn() ?? this.route.snapshot.paramMap.get('id') ?? '';
    this.text = textOf(this.kind);
    this.appPhoto = Capacitor.isNativePlatform() && this.kind === 'image';
    this.appVideo = Capacitor.isNativePlatform() && this.kind === 'video';
    this.nativeCapture = this.phoneCamera && this.kind !== 'audio' && !this.appPhoto && !this.appVideo;
    this.pageCamera =
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      (this.kind === 'audio' ? audioRecorderType() !== null : (!this.phoneCamera || this.appPhoto || this.appVideo) && (this.kind === 'image' || recorderType() !== null));
  }

  /** a file is chosen, the camera or the voice recorder is open, or something is being sent: tapping elsewhere must not close the panel (it would lose it) */
  hasWork(): boolean {
    return !!this.file() || !!this.working() || this.cameraOpen();
  }

  /** Cancel: the panel closes (in the feed), or the page goes back to the conversation. */
  protected cancel(): void {
    if (this.embedded) this.closed.emit();
    else void this.router.navigate(['/friends', this.friendId]);
  }

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
      this.error.set(tr('addMedia.thatGifIsToo', 'That GIF is too big. Choose one under 10 MB.'));
      return;
    }
    this.working.set(this.kind === 'video' ? tr('addMedia.preparingTheVideoKeep', 'Preparing the video… keep this page open') : tr('addMedia.preparing', 'Preparing…'));
    try {
      this.show(
        this.kind === 'image'
          ? await prepareImage(file)
          : this.kind === 'audio'
            ? await prepareAudioFile(file)
            : await prepareVideo(file, (done) => this.working.set(tr('addMedia.preparingTheVideoKeep2', 'Preparing the video… {{ done }} % (keep this page open)', { done: Math.round(done * 100) }))),
      );
    } catch (err: any) {
      this.error.set(this.kind === 'image' ? 'This image could not be prepared (it may be too big for the memory of this phone). Close other apps and try again, take the photo at a lower resolution, or choose another one (JPEG, PNG, WebP or GIF).' : err.message ?? tr('addMedia.thisFileCannotBe', 'This file cannot be opened. Try another one.'));
    } finally {
      this.working.set(null);
    }
  }

  private show(file: Prepared): void {
    this.clearPreview();
    this.preview.set(URL.createObjectURL(file.blob));
    this.file.set(file);
    this.stored = null;
    this.sealed = null;
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
    this.working.set(tr('addMedia.preparingTheVideo', 'Preparing the video…'));
    try {
      this.show(await prepareRecorded(film.blob, film.durationMs));
    } catch (err: any) {
      this.error.set(err.message ?? tr('addMedia.theVideoCouldNot', 'The video could not be saved. Try again.'));
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
    this.working.set(tr('addMedia.turning', 'Turning…'));
    this.error.set(null);
    try {
      this.show(await rotateImage(file as PreparedImage, clockwise));
    } catch (err: any) {
      this.error.set(err.message ?? tr('addMedia.theImageCouldNot', 'The image could not be turned'));
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
    this.sealed = null;
  }

  async send(): Promise<void> {
    const file = this.file();
    if (!file || this.working()) return;
    this.working.set(tr('addMedia.sending', 'Sending…'));
    this.error.set(null);
    let sending = false; // false = the file is still being uploaded
    try {
      const progress = (done: number, total: number) => this.working.set(tr('addMedia.sendingOf', 'Sending… {{ done }} of {{ total }}', { done, total }));
      if (!this.stored) {
        // both of us have a key and locking is on: the file is locked here with the key of its message, and only the locked file leaves the device
        const key = await this.lock.mediaKey(this.friendId);
        if (key) {
          const locked = await this.media.uploadLocked(this.kind, file, this.friendId, key, progress);
          this.stored = locked.upload;
          this.sealed = { key, media: locked.media };
        } else {
          this.stored = this.kind === 'image' ? await this.media.uploadImage(file as PreparedImage, progress) : this.kind === 'audio' ? await this.media.uploadAudio(file as PreparedAudio, progress) : await this.media.uploadVideo(file as PreparedVideo, progress);
        }
      }
      this.working.set(tr('addMedia.sending', 'Sending…'));
      const size = 'width' in file && !this.sealed ? { width: file.width, height: file.height } : {}; // a locked file's size is inside the lock
      sending = true;
      const message = await this.chat.sendMedia(this.friendId, (this.hosted() ? this.captionIn() : this.caption()).trim(), { objectId: this.stored.objectId, ...size, durationMs: this.sealed ? undefined : (this.durationMs() ?? undefined) }, this.sealed ?? undefined, this.ctx?.pokes() ?? false);
      this.ctx?.poke.set(false);
      if (this.embedded) this.sent.emit(message); // the feed adds it and closes this panel
      else await this.router.navigate(['/friends', this.friendId]); // the conversation loads the message, and the file, from the server
    } catch (err: any) {
      this.error.set(err instanceof ApiError && err.status >= 500 && sending ? `${err.message} (sending the message)` : (err.message ?? tr('addMedia.couldNotSendIt', 'Could not send it')));
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
