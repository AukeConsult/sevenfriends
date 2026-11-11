import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatBytes } from '../core/image';
import { MediaService } from '../core/media.service';
import { MediaRef } from '../models';

/** An audio message: a play button (with the length and size); the audio is read from the server (`getObject`) only when it is played. */
@Component({
  selector: 'app-media-audio',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './media-audio.html',
  providers: [provideTranslocoScope('mediaAudio')],
})
export class MediaAudio {
  private readonly service = inject(MediaService);

  readonly media = input.required<MediaRef>();
  /** the friendship of the message: the full-size page needs it to rename the file */
  readonly friendId = input<string | null>(null);
  protected readonly src = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

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

  protected info(): string {
    const { durationMs, bytes } = this.media();
    const seconds = Math.round((durationMs ?? 0) / 1000);
    return `${durationMs ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} · ` : ''}${formatBytes(bytes)}`;
  }

  protected playbackFailed(): void {
    this.failed.set(true);
  }

  protected stop(event: Event): void {
    event.stopPropagation();
  }
}
