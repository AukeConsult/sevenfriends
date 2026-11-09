import { Injectable, computed, inject, signal } from '@angular/core';
import { ActiveCircleService, CIRCLE_CHOICES } from './active-circle.service';

/**
 * The OTHER circles where something is waiting that the person has not seen: a message, a friend request, an answer, a removal. The app hears
 * all its circles but shows only the circle in use in detail; the rest is one note per circle ("Activity in Family") that says nothing more.
 * The note goes away when the person opens that circle (the switch clears it), and at sign-out. Nothing of the other circle is kept here
 * but its id.
 */
@Injectable({ providedIn: 'root' })
export class CircleActivityService {
  private readonly active = inject(ActiveCircleService);
  private readonly marked = signal<ReadonlySet<string>>(new Set());

  /** the circles other than the one in use that have activity, in the order of the circles */
  readonly circles = computed(() => CIRCLE_CHOICES.map((c) => c.id).filter((id) => id !== this.active.id && this.marked().has(id)));

  constructor() {
    // opening a circle is how its note is read
    this.active.onSwitch((id) => this.clear(id));
  }

  /** Something happened in this circle. The circle in use needs no note: it shows the thing itself. */
  mark(circleId: string): void {
    if (circleId === this.active.id || this.marked().has(circleId)) return;
    this.marked.set(new Set([...this.marked(), circleId]));
  }

  clear(circleId: string): void {
    if (!this.marked().has(circleId)) return;
    this.marked.set(new Set([...this.marked()].filter((id) => id !== circleId)));
  }

  clearAll(): void {
    if (this.marked().size) this.marked.set(new Set());
  }
}
