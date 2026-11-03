import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Camera } from '../camera/camera';
import { ChatService } from '../core/chat.service';
import { Clearable } from '../core/clearable';
import { MAX_IMAGE_BYTES, PreparedImage, formatBytes, prepareImage } from '../core/image';
import { MediaService } from '../core/media.service';
import { MAX_VIDEO_SECONDS, PreparedVideo, prepareRecorded, prepareVideo, recorderType } from '../core/video';
import { MediaUpload } from '../models';

/**
 * A full page to send an image or a video to a friend (`/friends/:id/image` and `/friends/:id/video`): take it with the
 * camera or choose a file, see it, add a text if you like, and Send. The file is made smaller in the browser (an image
 * to 1600 pixels, a video to 1280 pixels, about 1.2 Mbit/s and at most 30 seconds). It and its name go to the server, which
 * stores it in the media cache; the message then carries the reference, and the conversation reads the file back from
 * the server.
 *
 * The camera works the same on every device, in two ways:
 *  - a phone or tablet (a touch screen): the file chooser with `capture` opens the camera app (Android and iPhone);
 *  - a computer (Windows, Linux, Mac): the browsers ignore `capture` there, so the camera is shown on this page (`app-camera`).
 * Either way the result is a file that goes the same way as a chosen one.
 */
@Component({
  selector: 'app-add-media',
  imports: [RouterLink, Clearable, Camera],
  templateUrl: './add-media.html',
})
export class AddMedia implements OnDestroy {
  private readonly media = inject(MediaService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly kind: 'image' | 'video' = this.route.snapshot.data['kind'];
  protected readonly maxSeconds = MAX_VIDEO_SECONDS;
  protected readonly file = signal<PreparedImage | PreparedVideo | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly caption = signal('');
  /** what is being done now ("Preparing the video…", "Sending…"), or null */
  protected readonly working = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly formatBytes = formatBytes;
  protected readonly durationMs = computed(() => (this.file() as PreparedVideo | null)?.durationMs ?? null);
  protected readonly trimmed = computed(() => (this.file() as PreparedVideo | null)?.trimmed ?? false);

  /** a touch screen: the camera app of the phone is used (a file chooser with `capture`) */
  protected readonly phoneCamera = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  /** the browser can show a camera on the page (needs https or localhost), and for a video, record it */
  protected readonly pageCamera = !this.phoneCamera && Boolean(navigator.mediaDevices?.getUserMedia) && (this.kind === 'image' || recorderType() !== null);
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
      this.error.set(this.kind === 'image' ? 'Choose an image file (a photo).' : 'Choose a video file.');
      return;
    }
    if (file.type === 'image/gif' && file.size > MAX_IMAGE_BYTES) {
      this.error.set('That GIF is too big. Choose one under 10 MB.');
      return;
    }
    this.working.set(this.kind === 'image' ? 'Preparing…' : 'Preparing the video… keep this page open');
    try {
      this.show(this.kind === 'image' ? await prepareImage(file) : await prepareVideo(file, (done) => this.working.set(`Preparing the video… ${Math.round(done * 100)} % (keep this page open)`)));
    } catch (err: any) {
      this.error.set(this.kind === 'image' ? 'This image cannot be opened. Try another one (JPEG, PNG, WebP or GIF).' : err.message ?? 'This video cannot be opened. Try another one.');
    } finally {
      this.working.set(null);
    }
  }

  private show(file: PreparedImage | PreparedVideo): void {
    this.clearPreview();
    this.preview.set(URL.createObjectURL(file.blob));
    this.file.set(file);
    this.stored = null;
  }

  // ------------------------------------------------------------------ the camera on this page (computers)

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

  // ------------------------------------------------------------------ sending

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
      this.stored ??= this.kind === 'image' ? await this.media.uploadImage(file, progress) : await this.media.uploadVideo(file as PreparedVideo, progress);
      this.working.set('Sending…');
      await this.chat.send(this.friendId, this.caption().trim(), { objectId: this.stored.objectId, width: file.width, height: file.height, durationMs: this.durationMs() });
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
