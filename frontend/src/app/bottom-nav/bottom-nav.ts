import { Component, HostListener, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ActiveCircleService, CIRCLE_CHOICES } from '../core/active-circle.service';
import { NotificationsService } from '../core/notifications.service';

/** Always-visible banner menu at the bottom of the screen (shown when signed in). */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.html',
})
export class BottomNav {
  protected readonly active = inject(ActiveCircleService);
  protected readonly circles = CIRCLE_CHOICES;
  /** the drop-up of the circles is open (a test menu: for demo and test an app can be put in another circle) */
  protected readonly circlesOpen = signal(false);

  private readonly notifications = inject(NotificationsService);
  /** the name of the circle this app is in: it is what the Home tab says */
  private readonly circle = CIRCLE_CHOICES.find((c) => c.id === inject(ActiveCircleService).id);
  protected readonly circleName = this.circle?.label ?? 'Home';
  /** the kind of circle: the tab has an icon for each (people, a chat bubble, a briefcase, a house with a heart) */
  protected readonly circleType = this.circle?.type ?? 'friends';

  /** Clicking Home runs the invite + message check (also when already on Home). */
  protected onHome(): void {
    this.notifications.refresh();
  }

  /** a tap anywhere else closes the drop-up */
  @HostListener('document:click', ['$event'])
  protected closeCircles(event: Event): void {
    if (this.circlesOpen() && !(event.target as HTMLElement).closest('.sf-circle-wrap')) this.circlesOpen.set(false);
  }

  /** Tick a circle: the app starts again in it (the live updates too), as on the test page. */
  protected pick(id: string): void {
    this.circlesOpen.set(false);
    if (id !== this.active.id) this.active.choose(id);
  }
}
