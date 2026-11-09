import { Component, input } from '@angular/core';
import { tr } from '../core/i18n';

/** The seven seats as dots: a colour for every seat that is taken (from seat 1 on), an empty ring for the rest. */
@Component({
  selector: 'app-seat-dots',
  template: `
    <div class="sf-hero-dots" [class.sf-blink]="blink()" role="img" [attr.aria-label]="blink() ? tr('core.sevenSeats', 'Seven seats') : tr('core.ofSeatsTaken', '{{ taken }} of 7 seats taken', { taken: taken() })">
      @for (seat of seats; track seat) {
        <i [class.sf-taken]="seat <= taken()" [style.--n]="seat - 1"></i>
      }
    </div>
  `,
})
export class SeatDots {
  protected readonly tr = tr;
  /** how many seats are taken (0 to 7) */
  readonly taken = input(0);
  /** the dots blink one after the other, each in its own colour (the sign-in and welcome pages) */
  readonly blink = input(false);
  protected readonly seats = [1, 2, 3, 4, 5, 6, 7];
}
