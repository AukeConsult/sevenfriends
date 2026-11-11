import { Component, computed, input } from '@angular/core';
import { tr } from '../core/i18n';
import { circleWords } from '../core/active-circle.service';

/**
 * The three arguments that are the same on every welcome page of every circle (seven seats, quiet, private), in the words of the circle (no line of its own above them). One place to change them: all the welcome pages use this.
 */
@Component({
  selector: 'app-why',
  template: `
    <div class="sf-why">
      <div><b>{{ tr('core.sevenSeats', 'Seven seats') }}</b>{{ tr('core.yourSevenClosestNo', 'Your seven closest ' + (words().many) + '. No one gets lost.', { many: words().many }) }}</div>
      <div><b>{{ tr('core.quiet', 'Quiet') }}</b>{{ tr('core.onlyYourSevenGet', 'Only your seven get through. No feeds, no ads.') }}</div>
      <div><b>{{ tr('core.private', 'Private') }}</b>{{ tr('core.aLockedRoomFor', 'A locked room for each ' + (words().one) + ' and for small groups. Only the people in it.', { one: words().one }) }}</div>
    </div>
  `,
})
export class WhyTiles {
  protected readonly tr = tr;
  /** the id of the circle of the page */
  readonly circle = input.required<string>();
  protected readonly words = computed(() => circleWords(this.circle()));
}
