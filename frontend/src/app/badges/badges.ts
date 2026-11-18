import { Component, input } from '@angular/core';
import { Medal } from '../medal/medal';

/** The medals a person has, in a row (on a profile page, which friends can see): the gold early adopter, and the silver premium inviter once they shared their link 10 times. Empty (and hidden) when there is none. */
@Component({
  selector: 'app-badges',
  imports: [Medal],
  host: { class: 'sf-badges' },
  template: `
    <app-medal kind="early" [show]="earlyAdopter()" />
    <app-medal kind="inviter" [show]="premiumInviter()" />
  `,
})
export class Badges {
  readonly earlyAdopter = input(false);
  readonly premiumInviter = input(false);
}
