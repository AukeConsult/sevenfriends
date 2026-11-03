import { Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { formatBytes } from '../core/image';
import { MediaService, StoredFile } from '../core/media.service';

/**
 * An image or a video of a message in full: /media/:ownerId/:objectId. It is read from the server like the one in the conversation,
 * and can be saved on the device (Download: the bytes already read, saved under the file name of the message).
 */
@Component({
  selector: 'app-media-viewer',
  templateUrl: './media-viewer.html',
})
export class MediaViewer {
  private readonly location = inject(Location);

  protected readonly file = signal<StoredFile | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly formatBytes = formatBytes;

  constructor() {
    const params = inject(ActivatedRoute).snapshot.paramMap;
    inject(MediaService)
      .object(params.get('ownerId') ?? '', params.get('objectId') ?? '')
      .then((file) => this.file.set(file))
      .catch((err) => this.error.set(err.message ?? 'Could not load the file'));
  }

  protected isVideo(file: StoredFile): boolean {
    return file.type.startsWith('video/');
  }

  /** The name to save under: the file name of the message, with an extension if it has none. */
  protected saveName(file: StoredFile): string {
    const name = file.name || 'file';
    if (/\.[A-Za-z0-9]{2,5}$/.test(name)) return name;
    const extension = file.type.split('/')[1]?.split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov');
    return extension ? `${name}.${extension}` : name;
  }

  protected back(): void {
    this.location.back();
  }
}
