import { Location } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { formatBytes } from '../core/image';
import { MediaService, StoredFile } from '../core/media.service';

/** An image of a message in full: /media/:ownerId/:objectId. It is read from the server like the one in the conversation. */
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
      .catch((err) => this.error.set(err.message ?? 'Could not load the image'));
  }

  protected back(): void {
    this.location.back();
  }
}
