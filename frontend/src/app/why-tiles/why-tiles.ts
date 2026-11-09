import { Component, computed, input } from '@angular/core';
import { tr } from '../core/i18n';
import { circleWords } from '../core/active-circle.service';

/** The one argument of each circle (its own line on every welcome page of that circle). */
const LEAD: Record<string, string> = {
  get default() { return tr('core.theFriendsWhoMatter', 'The friends who matter, in one calm place.'); },
  get buddies() { return tr('core.yourRealBuddiesAway', 'Your real buddies, away from the feed.'); },
  get work() { return tr('core.theFewContactsYour', 'The few contacts your work depends on.'); },
  get family() { return tr('core.yourFamilyCloseEven', 'Your family, close even when far apart.'); },
};

/**
 * The three arguments that are the same on every welcome page of every circle (seven seats, quiet, private), in the words of the circle, under the
 * circle's own argument. One place to change them: all the welcome pages use this.
 */
@Component({
  selector: 'app-why',
  template: `
    <p class="sf-why-lead">{{ lead() }}</p>
    <div class="sf-why">
      <div><b>{{ tr('core.sevenSeats', 'Seven seats') }}</b>{{ tr('core.yourSevenClosestNo', 'Your seven closest ' + (words().many) + '. No one gets lost.', { many: words().many }) }}</div>
      <div><b>{{ tr('core.quiet', 'Quiet') }}</b>{{ tr('core.onlyYourSevenGet', 'Only your seven get through. No feeds, no ads.') }}</div>
      <div><b>{{ tr('core.private', 'Private') }}</b>{{ tr('core.aLockedRoomFor', 'A locked room for each ' + (words().one) + '. Only you two.', { one: words().one }) }}</div>
    </div>
  `,
})
export class WhyTiles {
  protected readonly tr = tr;
  /** the id of the circle of the page */
  readonly circle = input.required<string>();
  protected readonly words = computed(() => circleWords(this.circle()));
  protected readonly lead = computed(() => LEAD[this.circle()] ?? LEAD['default']);
}
