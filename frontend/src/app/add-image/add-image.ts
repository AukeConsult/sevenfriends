import { Component, OnDestroy, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ChatService } from '../core/chat.service';
import { Clearable } from '../core/clearable';
import { MAX_IMAGE_BYTES, PreparedImage, formatBytes, prepareImage } from '../core/image';
import { MediaService } from '../core/media.service';
import { MediaUpload } from '../models';

/**
 * A full page to send an image to a friend: choose it (the gallery or the camera of the phone), see it, add a text if you
 * like, and Send. The image (made smaller in the browser) and its name go to the server, which stores them in the media
 * cache; the message then carries the reference, and the conversation reads the image back from the server.
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

  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly image = signal<PreparedImage | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly caption = signal('');
  protected readonly preparing = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly formatBytes = formatBytes;
  /** the upload that worked, when sending the message did not: the next try does not upload again */
  private stored: MediaUpload | null = null;

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (!file) return;
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
    this.clearPreview();
  }

  private clearPreview(): void {
    const url = this.preview();
    if (url) URL.revokeObjectURL(url);
  }
}
