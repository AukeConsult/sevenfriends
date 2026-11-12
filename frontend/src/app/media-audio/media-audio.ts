import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject, input, signal } from '@angular/core';
import { MediaService } from '../core/media.service';
import { MediaRef } from '../models';

/** An audio message: a play button (with the length and size); the audio is read from the server (`getObject`) only when it is played. */
@Component({
  selector: 'app-media-audio',
  imports: [TranslocoDirective],
  templateUrl: './media-audio.html',
  providers: [provideTranslocoScope('mediaAudio')],
})
export class MediaAudio {
  private readonly service = inject(MediaService);

  readonly media = input.required<MediaRef>();
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

  /** only the length of the message (nobody cares about its size) */
  protected info(): string {
    const { durationMs } = this.media();
    if (!durationMs) return '';
    const seconds = Math.round(durationMs / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  protected playbackFailed(): void {
    this.failed.set(true);
  }

  protected stop(event: Event): void {
    event.stopPropagation();
  }
}
