import { signal } from '@angular/core';

/** What a group of elements that can be picked up and dropped onto each other needs to say. */
export interface HoldDragOptions {
  /** the elements that can be dropped on: a CSS selector (for example `[data-item-id]`) and the name of the data attribute that holds the id (`itemId`) */
  selector: string;
  key: string;
  /** an element was dropped on another one */
  onDrop: (from: string, to: string) => void;
  /** false = nothing can be picked up now (for example while something is being saved) */
  canStart?: () => boolean;
}

/**
 * Click (or touch) and HOLD an element for a moment to pick it up, then drag it onto another element and let go (the page does the move in
 * `onDrop`). It works with a mouse and with touch: moving before the hold is long enough is a scroll, a plain click is a click, and the click that
 * ends a drag is swallowed. The elements stay where they are while dragging, so the pointer keeps being followed.
 *
 * In a template: `(pointerdown)="drag.down($event, id)"` and `(contextmenu)="drag.menu($event)"` on each element, `(touchmove)="drag.scroll($event)"` on
 * the list that holds them, `drag.pressId()`, `drag.dragId()` and `drag.dropId()` for the marks.
 */
export class HoldDrag {
  /** the element being pressed (before it is picked up), the one being dragged and the one it is over now */
  readonly pressId = signal<string | null>(null);
  readonly dragId = signal<string | null>(null);
  readonly dropId = signal<string | null>(null);
  private press: { x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly options: HoldDragOptions) {}

  /** Pointer down on an element: starts the hold . */
  down(event: PointerEvent, id: string): void {
    if ((event.pointerType === 'mouse' && event.button !== 0) || (event.target as HTMLElement).closest('button, input, textarea, select')) return; // a button or a field is not a place to pick up from
    this.release();
    this.pressId.set(id);
    this.press = { x: event.clientX, y: event.clientY, timer: setTimeout(() => { this.release(); navigator.vibrate?.(15); this.begin(id); }, 350) };
    document.addEventListener('pointermove', this.pressMove);
    document.addEventListener('pointerup', this.release);
    document.addEventListener('pointercancel', this.release);
  }

  /** A handle (⠿) picks the element up at once, without holding. */
  grab(event: PointerEvent, id: string): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    this.release();
    this.begin(id);
  }

  /** No menu on a long press while something is held. */
  menu(event: Event): void {
    if (this.press || this.dragId()) event.preventDefault();
  }

  /** A held element is moved without the page scrolling under the finger (the listener is on the list from the start, so the browser asks it before it scrolls). */
  scroll(event: TouchEvent): void {
    if (this.dragId() && event.cancelable) event.preventDefault();
  }

  /** The page is left: nothing stays held. */
  destroy(): void {
    this.stop();
    this.release();
  }

  private begin(id: string): void {
    if (this.dragId() || this.options.canStart?.() === false) return;
    this.dragId.set(id);
    this.dropId.set(null);
    document.addEventListener('pointermove', this.dragMove);
    document.addEventListener('pointerup', this.end);
    document.addEventListener('pointercancel', this.stop);
  }

  // moved before the hold was long enough: it is a scroll (or a click), not a pick-up
  private readonly pressMove = (event: PointerEvent): void => {
    if (this.press && Math.hypot(event.clientX - this.press.x, event.clientY - this.press.y) > 8) this.release();
  };

  private readonly release = (): void => {
    if (this.press) clearTimeout(this.press.timer);
    this.press = null;
    this.pressId.set(null);
    document.removeEventListener('pointermove', this.pressMove);
    document.removeEventListener('pointerup', this.release);
    document.removeEventListener('pointercancel', this.release);
  };

  private readonly dragMove = (event: PointerEvent): void => {
    const over = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>(this.options.selector)?.dataset[this.options.key] ?? null;
    this.dropId.set(over && over !== this.dragId() ? over : null);
    const edge = 80; // near the top or the bottom of the screen the page scrolls
    if (event.clientY < edge) window.scrollBy(0, -14);
    else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 14);
  };

  private readonly end = (): void => {
    const from = this.dragId();
    const to = this.dropId();
    this.stop();
    if (from && to) this.options.onDrop(from, to);
  };

  private readonly stop = (): void => {
    if (this.dragId()) {
      // the click that ends a drag must not open anything
      const swallow = (e: Event): void => { e.stopPropagation(); e.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, { capture: true }), 100);
    }
    document.removeEventListener('pointermove', this.dragMove);
    document.removeEventListener('pointerup', this.end);
    document.removeEventListener('pointercancel', this.stop);
    this.dragId.set(null);
    this.dropId.set(null);
  };
}
