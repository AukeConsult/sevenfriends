import { ActiveCircleService } from '../core/active-circle.service';
import { Component, inject } from '@angular/core';

/** The slim top of Home and Share: the small logo and the name of the app. */
@Component({
  selector: 'app-home-top',
  host: { style: 'display: block' },
  template: `
    <header class="sf-home-top">
      <span class="sf-logo sf-logo-sm" aria-hidden="true">7</span>
      <span class="sf-home-name">{{ w.app }}</span>
    </header>
  `,
})
export class HomeTop {
  protected readonly w = inject(ActiveCircleService).words;
}
