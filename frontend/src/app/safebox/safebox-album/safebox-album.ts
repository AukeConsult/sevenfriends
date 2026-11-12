import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { tr } from '../../core/i18n';
import { SafeboxService } from '../../core/safebox.service';
import { TapBack } from '../../core/tap-back';
import { FriendContext } from '../../friend-page/friend-context';
import { SafeboxItem } from '../../models';
import { PageBar } from '../../page-bar/page-bar';

/** One picture of the album, as large as the screen allows: the small preview first, the whole picture only when it is the one shown or next to it. */
@Component({
  selector: 'app-safebox-slide',
  template: `@if (src(); as url) { <img [src]="url" [alt]="item().name" /> } @else if (item().kind !== 'image') { <span class="sf-box-icon sf-box-icon-big" aria-hidden="true">{{ item().kind === 'video' ? '▶' : '' }}</span> } @else { <span class="sf-box-wait" aria-hidden="true"></span> }`,
  host: { class: 'sf-pager-pic' },
})
export class SafeboxSlide {
  private readonly box = inject(SafeboxService);
  readonly friendId = input.required<string>();
  readonly item = input.required<SafeboxItem>();
  /** the whole picture is wanted (this slide is shown, or next to the one shown) */
  readonly near = input(false);
  private readonly thumb = signal<string | null>(null);
  private readonly whole = signal<string | null>(null);
  protected readonly src = computed(() => (this.near() ? this.whole() ?? this.thumb() : this.thumb() ?? this.whole()));

  constructor() {
    effect(() => {
      const item = this.item();
      if (item.kind !== 'image' || !item.hasThumb || this.thumb()) return;
      this.box.file(this.friendId(), item.id, true).then((f) => this.thumb.set(f.url)).catch(() => undefined);
    });
    effect(() => {
      const item = this.item();
      if (item.kind !== 'image' || (!this.near() && item.hasThumb) || this.whole()) return;
      this.box.file(this.friendId(), item.id).then((f) => this.whole.set(f.url)).catch(() => undefined);
    });
  }
}

/**
 * All the pictures and videos of one album on a page of their own (`/friends/:id/safebox/object/:itemId/pictures`, opened with "View all" on the album):
 * one picture at a time, a swipe to the left or right shows the next or the previous one; a tap opens the file, where the arrows go on from picture to picture.
 */
@Component({
  selector: 'app-safebox-album',
  imports: [TapBack, PageBar, RouterLink, SafeboxSlide, TranslocoDirective],
  templateUrl: './safebox-album.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxAlbum {
  private readonly router = inject(Router);
  protected readonly friendId = inject(FriendContext).friendId;
  private readonly albumId = inject(ActivatedRoute).snapshot.paramMap.get('itemId') ?? '';
  protected readonly list = ['/friends', this.friendId, 'safebox'];
  protected readonly pictures = signal<SafeboxItem[] | null>(null);
  protected readonly error = signal<string | null>(null);
  /** the picture in view (from how far the strip is scrolled) */
  protected readonly index = signal(0);
  protected readonly current = computed(() => this.pictures()?.[this.index()] ?? null);

  constructor() {
    inject(SafeboxService)
      .children(this.friendId, this.albumId)
      .then((items) => this.pictures.set(items))
      .catch((err) => this.error.set(err?.message ?? tr('safebox.attachments.couldNotRead', 'Could not read the attachments')));
  }

  /** how far one picture is from the next (a picture is a little narrower than the strip, so the next one peeks in at the side) */
  private stride(strip: HTMLElement): number {
    const [first, second] = [strip.children[0] as HTMLElement | undefined, strip.children[1] as HTMLElement | undefined];
    return first && second ? second.offsetLeft - first.offsetLeft : strip.clientWidth;
  }

  protected scrolled(strip: HTMLElement): void {
    const last = Math.max(0, strip.children.length - 1);
    const atEnd = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
    this.index.set(atEnd ? last : Math.min(last, Math.max(0, Math.round(strip.scrollLeft / Math.max(1, this.stride(strip))))));
  }

  /** The buttons under the pictures (for a mouse): one picture to the left or right. */
  protected step(strip: HTMLElement, direction: 1 | -1): void {
    strip.scrollBy({ left: direction * this.stride(strip), behavior: 'smooth' });
  }

  /** Back to the album. */
  protected back(event?: Event): void {
    event?.preventDefault();
    void this.router.navigate(['/friends', this.friendId, 'safebox', 'object', this.albumId], { replaceUrl: true });
  }
}
