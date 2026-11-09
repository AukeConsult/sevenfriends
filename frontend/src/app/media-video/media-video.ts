import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
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
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './media-video.html',
  providers: [provideTranslocoScope('mediaVideo')],
})
export class MediaVideo {
  private readonly service = inject(MediaService);

  readonly media = input.required<MediaRef>();
  protected readonly poster = signal<string | null>(null);
  protected readonly src = signal<string | null>(null);
  protected readonly loading = signal(false);
  protected readonly failed = signal(false);

  // the controls under the video (the same in every browser)
  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  protected readonly playing = signal(false);
  protected readonly muted = signal(false);
  protected readonly current = signal(0);
  protected readonly duration = signal(0);

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

  protected toggle(event: Event): void {
    event.stopPropagation(); // not a tap on my message
    const video = this.video()?.nativeElement;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  protected toggleMute(event: Event): void {
    event.stopPropagation();
    this.muted.update((muted) => !muted);
  }

  protected seek(seconds: string): void {
    const video = this.video()?.nativeElement;
    if (video) video.currentTime = Number(seconds);
  }

  protected tick(): void {
    const video = this.video()?.nativeElement;
    if (!video) return;
    this.current.set(video.currentTime);
    this.duration.set(Number.isFinite(video.duration) ? video.duration : 0);
  }

  protected clock(seconds: number): string {
    const whole = Math.floor(seconds || 0);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }

  protected stop(event: Event): void {
    event.stopPropagation();
  }
}
