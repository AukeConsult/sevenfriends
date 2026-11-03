import { Component, ElementRef, OnDestroy, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChatService } from '../core/chat.service';
import { Clearable } from '../core/clearable';
import { MAX_IMAGE_BYTES, PreparedImage, formatBytes, prepareImage } from '../core/image';
import { MediaService } from '../core/media.service';
import { MediaUpload } from '../models';

/**
 * A full page to send an image to a friend: take a photo with the camera or choose a picture, see it, add a text if you
 * like, and Send. The image (made smaller in the browser) and its name go to the server, which stores them in the media
 * cache; the message then carries the reference, and the conversation reads the image back from the server.
 *
 * The camera works the same on every device, in two ways:
 *  - a phone or tablet (a touch screen): the file chooser with `capture` opens the camera app of the phone (Android and iPhone);
 *  - a computer (Windows, Linux, Mac): the browsers ignore `capture` there, so the camera is shown on this page
 *    (`getUserMedia`) with a shutter button, and a button to switch when the computer has more than one camera.
 * Either way the photo ends up as a file that goes the same way as a chosen picture.
 */
@Component({
  selector: 'app-add-image',
  imports: [RouterLink, Clearable],
  templateUrl: './add-image.html',
})
export class AddImage implements OnDestroy {
  private readonly media = inject(MediaService);
  private readonly chat = inject(ChatService);
  private readonly router = inject(Router);
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');

  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly image = signal<PreparedImage | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly caption = signal('');
  protected readonly preparing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formatBytes = formatBytes;

  /** a touch screen: the camera app of the phone is used (a file chooser with `capture`) */
  protected readonly phoneCamera = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
  /** the browser can show a camera on the page (needs https or localhost) */
  protected readonly pageCamera = !this.phoneCamera && Boolean(navigator.mediaDevices?.getUserMedia);
  /** the camera view is open */
  protected readonly cameraOpen = signal(false);
  protected readonly cameras = signal<MediaDeviceInfo[]>([]);
  private readonly stream = signal<MediaStream | null>(null);
  private cameraIndex = 0;

  /** the upload that worked, when sending the message did not: the next try does not upload again */
  private stored: MediaUpload | null = null;

  constructor() {
    // the camera picture goes into the video element as soon as both exist
    effect(() => {
      const element = this.video()?.nativeElement;
      const stream = this.stream();
      if (!element || !stream) return;
      element.srcObject = stream;
      void element.play().catch(() => undefined);
    });
  }

  protected onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    return file ? this.use(file) : Promise.resolve();
  }

  /** A chosen or photographed file becomes the image to send. */
  private async use(file: File): Promise<void> {
    this.error.set(null);
    if (!file.type.startsWith('image/')) {
      this.error.set('Choose an image file (a photo).');
      return;
    }
    if (file.type === 'image/gif' && file.size > MAX_IMAGE_BYTES) {
      this.error.set('That GIF is too big. Choose one under 10 MB.');
      return;
    }
    this.preparing.set(true);
    try {
      const image = await prepareImage(file);
      this.clearPreview();
      this.preview.set(URL.createObjectURL(image.blob));
      this.image.set(image);
      this.stored = null;
    } catch {
      this.error.set('This image cannot be opened. Try another one (JPEG, PNG, WebP or GIF).');
    } finally {
      this.preparing.set(false);
    }
  }

  // ------------------------------------------------------------------ the camera on this page (computers)

  protected async openCamera(): Promise<void> {
    this.error.set(null);
    try {
      await this.startCamera(null);
      // the names of the cameras are only known once the person has allowed one
      this.cameras.set((await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput'));
      this.cameraOpen.set(true);
    } catch (err) {
      this.error.set(cameraProblem(err));
    }
  }

  private async startCamera(deviceId: string | null): Promise<void> {
    this.stopCamera();
    this.stream.set(
      await navigator.mediaDevices.getUserMedia({
        video: deviceId ? { deviceId: { exact: deviceId } } : { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }),
    );
  }

  /** The next camera of the computer (a laptop often has one, a desk with a webcam and a laptop two). */
  protected async nextCamera(): Promise<void> {
    const cameras = this.cameras();
    if (cameras.length < 2) return;
    this.cameraIndex = (this.cameraIndex + 1) % cameras.length;
    try {
      await this.startCamera(cameras[this.cameraIndex].deviceId);
    } catch (err) {
      this.error.set(cameraProblem(err));
    }
  }

  /** The shutter: the picture on the screen now becomes a photo, which goes the way a chosen picture does. */
  protected async takePhoto(): Promise<void> {
    const element = this.video()?.nativeElement;
    if (!element?.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = element.videoWidth;
    canvas.height = element.videoHeight;
    canvas.getContext('2d')?.drawImage(element, 0, 0); // the photo itself is not mirrored, only the view of it is
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    this.closeCamera();
    if (!blob) {
      this.error.set('The photo could not be taken. Try again.');
      return;
    }
    await this.use(new File([blob], `photo-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`, { type: 'image/jpeg' }));
  }

  protected closeCamera(): void {
    this.stopCamera();
    this.cameraOpen.set(false);
  }

  private stopCamera(): void {
    this.stream()?.getTracks().forEach((track) => track.stop()); // the camera light goes out
    this.stream.set(null);
  }

  // ------------------------------------------------------------------ sending

  /** Back to the start: choose or take another one. */
  protected startAgain(): void {
    this.clearPreview();
    this.preview.set(null);
    this.image.set(null);
    this.error.set(null);
    this.stored = null;
  }

  protected async send(): Promise<void> {
    const image = this.image();
    if (!image || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      this.stored ??= await this.media.uploadImage(image);
      await this.chat.send(this.friendId, this.caption().trim(), { objectId: this.stored.objectId, width: image.width, height: image.height });
      await this.router.navigate(['/friends', this.friendId]); // the conversation loads the message, and the image, from the server
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not send the image');
    } finally {
      this.busy.set(false);
    }
  }

  ngOnDestroy(): void {
    this.stopCamera();
    this.clearPreview();
  }

  private clearPreview(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
  }
}

/** What went wrong with the camera, in words for the person. */
function cameraProblem(err: unknown): string {
  switch ((err as { name?: string }).name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The camera is blocked. Allow it for this site in the browser settings, or choose an image instead.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Choose an image instead.';
    case 'NotReadableError':
      return 'The camera is in use by another program. Close it and try again, or choose an image instead.';
    default:
      return 'The camera could not be started. Choose an image instead.';
  }
}
