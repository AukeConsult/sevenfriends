import { Component, input } from '@angular/core';

/** The seven seats as dots: a colour for every seat that is taken (from seat 1 on), an empty ring for the rest. */
@Component({
  selector: 'app-seat-dots',
  template: `
    <div class="sf-hero-dots" role="img" [attr.aria-label]="taken() + ' of 7 seats taken'">
      @for (seat of seats; track seat) {
        <i [class.sf-taken]="seat <= taken()"></i>
      }
    </div>
  `,
})
export class SeatDots {
  /** how many seats are taken (0 to 7) */
  readonly taken = input(0);
  protected readonly seats = [1, 2, 3, 4, 5, 6, 7];
}
