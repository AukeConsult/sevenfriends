import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, DestroyRef, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { MediaService } from '../core/media.service';
import { whenNearScreen } from '../core/near-screen';
import { MediaRef } from '../models';

/** An image of a message: read from the server (`getObject`), the small preview when there is one. It keeps its shape while it loads. */
@Component({
  imports: [TranslocoDirective],
  selector: 'app-media-image',
  templateUrl: './media-image.html',
  providers: [provideTranslocoScope('mediaImage')],
})
export class MediaImage {
  private readonly service = inject(MediaService);

  readonly media = input.required<MediaRef>();
  protected readonly src = signal<string | null>(null);
  protected readonly failed = signal(false);

  private readonly box = viewChild<ElementRef<HTMLElement>>('box');
  private gone = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.gone = true));
    effect((onCleanup) => {
      const media = this.media();
      const box = this.box()?.nativeElement;
      this.src.set(null);
      this.failed.set(false);
      if (!box) return;
      // the picture is read when it comes near the screen (and then one by one, see `objectLater`), not with the messages
      onCleanup(
        whenNearScreen(box, () =>
          this.service
            .objectLater(media.ownerId, media.hasThumb ? `${media.objectId}.thumb` : media.objectId, () => this.media() === media && !this.gone)
            .then((file) => this.media() === media && this.src.set(file.url))
            .catch(() => this.media() === media && this.failed.set(true)),
        ),
      );
    });
  }

  /** width divided by height (a number: the stylesheet needs it to fit the whole picture in the feed); null = not known */
  protected ratio(): number | null {
    const { width, height } = this.media();
    return width && height ? width / height : null;
  }
}
