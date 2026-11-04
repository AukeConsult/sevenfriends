import { Component, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBytes } from '../core/image';
import { MediaService } from '../core/media.service';
import { MediaRef } from '../models';

/**
 * A video of a message: the preview picture and a play button. The video itself is read from the server (`getObject`)
 * when it is played, so a conversation does not load every video it holds.
 */
@Component({
  selector: 'app-media-video',
  imports: [RouterLink],
  templateUrl: './media-video.html',
})
export class MediaVideo {
  private readonly service = inject(MediaService);

  readonly media = input.required<MediaRef>();
  protected readonly poster = signal<string | null>(null);
  protected readonly src = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  constructor() {
    effect(() => {
      const media = this.media();
      this.poster.set(null);
      this.src.set(null);
      if (!media.hasThumb) return;
      this.service
        .object(media.ownerId, `${media.objectId}.thumb`)
        .then((file) => this.media() === media && this.poster.set(file.url))
        .catch(() => undefined); // no picture: the play button is enough
    });
  }

  protected async play(event: Event): Promise<void> {
    event.stopPropagation(); // not a tap on my message (which opens Edit / Delete)
    const media = this.media();
    this.loading.set(true);
    this.failed.set(false);
    try {
      this.src.set((await this.service.object(media.ownerId, media.objectId)).url);
    } catch {
      this.failed.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  /** width divided by height (a number: the stylesheet needs it to fit the whole video in the feed) */
  protected ratio(): number {
    const { width, height } = this.media();
    return width && height ? width / height : 16 / 9;
  }

  protected info(): string {
    const { durationMs, bytes } = this.media();
    const seconds = Math.round((durationMs ?? 0) / 1000);
    return `${durationMs ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ` : ''}${formatBytes(bytes)}`;
  }

  protected stop(event: Event): void {
    event.stopPropagation();
  }
}
