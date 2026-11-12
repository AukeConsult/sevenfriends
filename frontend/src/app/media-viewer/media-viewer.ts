import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Location } from '@angular/common';
import { Component, HostListener, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { formatBytes } from '../core/image';
import { MediaService, StoredFile } from '../core/media.service';

/**
 * An image or a video in full: /media/:ownerId/:objectId. It is read from the server like the one in the conversation,
 * A tap on an empty place or a swipe left goes back.
 */
@Component({
  imports: [TranslocoDirective],
  selector: 'app-media-viewer',
  templateUrl: './media-viewer.html',
  providers: [provideTranslocoScope('mediaViewer')],
})
export class MediaViewer {
  private readonly location = inject(Location);

  protected readonly file = signal<StoredFile | null>(null);
  protected readonly error = signal<string | null>(null);
  /** an image at its full size (scroll to see all of it) or fitted to the screen */
  protected readonly full = signal(false);
  protected readonly formatBytes = formatBytes;

  private readonly media = inject(MediaService);

  constructor() {
    const params = inject(ActivatedRoute).snapshot.paramMap;
    this.media
      .object(params.get('ownerId') ?? '', params.get('objectId') ?? '')
      .then((file) => this.file.set(file))
      .catch((err) => this.error.set(err.message ?? tr('mediaViewer.couldNotLoadThe', 'Could not load the file')));
  }

  protected isVideo(file: StoredFile): boolean {
    return file.type.startsWith('video/');
  }

  /** A tap on an empty place, or a swipe to the left, goes back (a tap on the picture, a button, a link or a player does what it says). */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    const target = event.target as Element | null;
    if (!target?.isConnected || window.getSelection()?.toString()) return;
    if (target.closest('a, button, img, audio, video, input, .sf-bar, app-bottom-nav')) return;
    this.back();
  }

  private swipeStart: { x: number; y: number; time: number } | null = null;

  @HostListener('document:touchstart', ['$event'])
  protected onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    this.swipeStart = event.touches.length === 1 && touch && !this.usesSideways(event.target as Element | null) ? { x: touch.clientX, y: touch.clientY, time: Date.now() } : null;
  }

  @HostListener('document:touchend', ['$event'])
  protected onTouchEnd(event: TouchEvent): void {
    const start = this.swipeStart;
    this.swipeStart = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Date.now() - start.time <= 700 && dx <= -70 && Math.abs(dx) >= Math.abs(dy) * 1.8) this.back();
  }

  /** players, sliders and a full-size picture that scrolls sideways use the movement themselves */
  private usesSideways(element: Element | null): boolean {
    for (let e = element; e && e !== document.body; e = e.parentElement) {
      if (e.matches('audio, video, [role="slider"]')) return true;
      if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) return true;
    }
    return false;
  }

  protected back(): void {
    this.location.back();
  }
}
