import { Component, computed, input } from '@angular/core';
import { circleWords } from '../core/active-circle.service';

/** The one argument of each circle (its own line on every welcome page of that circle). */
const LEAD: Record<string, string> = {
  default: 'The friends who matter, in one calm place.',
  buddies: 'Your real buddies, away from the feed.',
  work: 'The few contacts your work depends on.',
  family: 'Your family, close even when far apart.',
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
      <div><b>Seven seats</b>Your seven closest {{ words().many }}. No one gets lost.</div>
      <div><b>Quiet</b>Only your seven get through. No feeds, no ads.</div>
      <div><b>Private</b>A locked room for each {{ words().one }}. Only you two.</div>
    </div>
  `,
})
export class WhyTiles {
  /** the id of the circle of the page */
  readonly circle = input.required<string>();
  protected readonly words = computed(() => circleWords(this.circle()));
  protected readonly lead = computed(() => LEAD[this.circle()] ?? LEAD['default']);
}
