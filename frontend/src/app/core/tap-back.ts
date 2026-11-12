import { Directive, HostListener, input, output } from '@angular/core';

/**
 * "Go back" without a back arrow: a tap on an empty place of the page, or a quick swipe to the left, emits `tapBack`.
 * It is put on the page's `<main>` (`<main (tapBack)="back()" [tapBackOff]="…">`). A tap on a button, a link, a field, a frame that is open, the bars or the file / map itself
 * does what it says; a swipe is ignored in fields, players, maps and anything that scrolls sideways. While a field is being edited the first tap only leaves the field.
 * `tapBackOff` switches it off for a moment (a new item is being written, a question is open).
 */
@Directive({ selector: '[tapBack]' })
export class TapBack {
  readonly tapBackOff = input(false);
  readonly tapBack = output<void>();

  private swipeStart: { x: number; y: number; time: number } | null = null;

  @HostListener('document:click', ['$event'])
  protected onClick(event: Event): void {
    const target = event.target as Element | null;
    if (this.tapBackOff() || !target?.isConnected || window.getSelection()?.toString() || document.activeElement?.matches('input, textarea, select')) return;
    if (target.closest('a, button, input, textarea, select, label, summary, audio, video, iframe, img, [contenteditable], [role="button"], .leaflet-container, .sf-bar, .sf-expand, .sf-box-view, .alert, app-bottom-nav')) return;
    this.tapBack.emit();
  }

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
    if (!start || !touch || this.tapBackOff()) return;
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Date.now() - start.time <= 700 && dx <= -70 && Math.abs(dx) >= Math.abs(dy) * 1.8) this.tapBack.emit();
  }

  private usesSideways(element: Element | null): boolean {
    for (let e = element; e && e !== document.body; e = e.parentElement) {
      if (e.matches('input, textarea, select, audio, video, iframe, [contenteditable], [role="slider"], .leaflet-container')) return true;
      if (e.scrollWidth > e.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(e).overflowX)) return true;
    }
    return false;
  }
}
