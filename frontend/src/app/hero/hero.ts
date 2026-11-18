import { TranslocoDirective } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { ActiveCircleService } from '../core/active-circle.service';
import { SeatDots } from '../seat-dots/seat-dots';

/** The top of the sign-in and welcome pages: the 7 logo, the name, the slogan (the poke pitch of the circle, texts: common.json `core.slogan_<circle>`) and the seven dots. */
@Component({
  selector: 'app-hero',
  imports: [SeatDots, TranslocoDirective],
  template: `
    <div class="sf-hero text-center" *transloco="let t">
      <div class="sf-logo sf-logo-lg">7</div>
      <h1 class="mt-3 mb-2">{{ words.app }}</h1>
      <p class="sf-hero-tag m-0">{{ t('core.slogan_' + circle.id) || words.slogan }}</p>
      <app-seat-dots [blink]="true" />
    </div>
  `,
})
export class Hero {
  protected readonly circle = inject(ActiveCircleService);
  protected readonly words = this.circle.words;
}
