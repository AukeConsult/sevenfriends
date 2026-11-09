import { Component, inject } from '@angular/core';
import { ActiveCircleService, circleLabel } from '../core/active-circle.service';
import { CircleActivityService } from '../core/circle-activity.service';
import { tr } from '../core/i18n';

/**
 * The note on Home for each OTHER circle where something is waiting: "Activity in Family". It says nothing more (no names, no counts); tapping it opens that circle,
 * where the things themselves are, and the note goes away.
 */
@Component({
  selector: 'app-circle-activity',
  host: { style: 'display: block' },
  template: `
    @for (id of activity.circles(); track id) {
      <button type="button" class="sf-activity" (click)="open(id)">
        <span class="sf-activity-dot" aria-hidden="true"></span>
        <span class="sf-activity-text">{{ tr('core.activityIn', 'Activity in ' + label(id), { circle: label(id) }) }}</span>
        <span class="sf-activity-go" aria-hidden="true">›</span>
      </button>
    }
  `,
})
export class CircleActivity {
  protected readonly tr = tr;
  protected readonly activity = inject(CircleActivityService);
  private readonly active = inject(ActiveCircleService);

  protected label(id: string): string {
    return circleLabel(id);
  }

  protected open(id: string): void {
    this.active.choose(id);
  }
}
