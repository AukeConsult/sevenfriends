import { Component, effect, inject, input, signal } from '@angular/core';
import { MediaService } from '../core/media.service';
import { MediaRef } from '../models';

/** An image of a message: read from the server (`getObject`), the small preview when there is one. It keeps its shape while it loads. */
@Component({
  selector: 'app-media-image',
  templateUrl: './media-image.html',
})
export class MediaImage {
  private readonly service = inject(MediaService);

  readonly media = input.required<MediaRef>();
  protected readonly src = signal<string | null>(null);
  protected readonly failed = signal(false);

  constructor() {
    effect(() => {
      const media = this.media();
      this.src.set(null);
      this.failed.set(false);
      this.service
        .object(media.ownerId, media.hasThumb ? `${media.objectId}.thumb` : media.objectId)
        .then((file) => this.media() === media && this.src.set(file.url))
        .catch(() => this.media() === media && this.failed.set(true));
    });
  }

  protected ratio(): string | null {
    const { width, height } = this.media();
    return width && height ? `${width} / ${height}` : null;
  }
}
